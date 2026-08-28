#import <CoreBluetooth/CoreBluetooth.h>
#import <Foundation/Foundation.h>

static CBUUID *ProvisioningService(void) { return [CBUUID UUIDWithString:@"1827"]; }
static CBUUID *ProvisioningDataIn(void) { return [CBUUID UUIDWithString:@"2ADB"]; }
static CBUUID *ProvisioningDataOut(void) { return [CBUUID UUIDWithString:@"2ADC"]; }
static CBUUID *ProxyService(void) { return [CBUUID UUIDWithString:@"1828"]; }
static CBUUID *ProxyDataIn(void) { return [CBUUID UUIDWithString:@"2ADD"]; }
static CBUUID *ProxyDataOut(void) { return [CBUUID UUIDWithString:@"2ADE"]; }

static NSString *Hex(NSData *data) {
    if (!data) return @"";
    const unsigned char *bytes = data.bytes;
    NSMutableString *result = [NSMutableString stringWithCapacity:data.length * 2];
    for (NSUInteger i = 0; i < data.length; i++) [result appendFormat:@"%02x", bytes[i]];
    return result;
}

static NSData *DataFromHex(NSString *hex) {
    if (![hex isKindOfClass:NSString.class] || hex.length == 0 || hex.length % 2) return nil;
    NSMutableData *data = [NSMutableData dataWithCapacity:hex.length / 2];
    for (NSUInteger i = 0; i < hex.length; i += 2) {
        unsigned int value = 0;
        NSString *pair = [hex substringWithRange:NSMakeRange(i, 2)];
        NSScanner *scanner = [NSScanner scannerWithString:pair];
        if (![scanner scanHexInt:&value] || !scanner.isAtEnd) return nil;
        unsigned char byte = (unsigned char)value;
        [data appendBytes:&byte length:1];
    }
    return data;
}

static void Emit(NSDictionary *message) {
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:message options:0 error:&error];
    if (!json || error) return;
    NSFileHandle *output = [NSFileHandle fileHandleWithStandardOutput];
    @synchronized(output) {
        [output writeData:json];
        [output writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    }
}

static NSString *CentralStateName(CBManagerState state) {
    switch (state) {
        case CBManagerStatePoweredOn: return @"poweredOn";
        case CBManagerStatePoweredOff: return @"poweredOff";
        case CBManagerStateUnauthorized: return @"unauthorized";
        case CBManagerStateUnsupported: return @"unsupported";
        case CBManagerStateResetting: return @"resetting";
        default: return @"unknown";
    }
}

@interface GrowBarBridge : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, copy) NSString *requestId;
@property(nonatomic, copy) NSString *role;
@property(nonatomic, copy) NSString *preferredId;
@property(nonatomic, copy) NSString *uid;
@property(nonatomic, copy) NSArray<NSString *> *expectedMacs;
@property(nonatomic, strong) CBUUID *targetService;
@property(nonatomic, strong) CBUUID *targetDataIn;
@property(nonatomic, strong) CBUUID *targetDataOut;
@property(nonatomic, strong) CBPeripheral *peripheral;
@property(nonatomic, strong) CBCharacteristic *dataIn;
@property(nonatomic, strong) CBCharacteristic *dataOut;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *candidates;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *candidatePeripherals;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *pendingWrites;
@property(nonatomic) NSInteger scanGeneration;
@property(nonatomic) BOOL broadScan;
@property(nonatomic) BOOL expectedDisconnect;
@end

@implementation GrowBarBridge

- (instancetype)init {
    self = [super init];
    if (self) {
        _candidates = [NSMutableDictionary dictionary];
        _candidatePeripherals = [NSMutableDictionary dictionary];
        _pendingWrites = [NSMutableDictionary dictionary];
        _central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
    }
    return self;
}

- (void)handleCommand:(NSDictionary *)command {
    NSString *name = command[@"command"];
    NSString *requestId = command[@"requestId"];
    if ([name isEqualToString:@"connect"]) {
        [self connectRole:command requestId:requestId];
    } else if ([name isEqualToString:@"write"]) {
        [self writeHex:command[@"hex"] requestId:requestId];
    } else if ([name isEqualToString:@"disconnect"]) {
        [self disconnectWithRequestId:requestId];
    } else {
        Emit(@{ @"event": @"error", @"requestId": requestId ?: @"", @"message": @"Unknown native Bluetooth command." });
    }
}

- (void)connectRole:(NSDictionary *)command requestId:(NSString *)requestId {
    NSString *role = command[@"role"];
    if (!([role isEqualToString:@"provisioning"] || [role isEqualToString:@"proxy"])) {
        Emit(@{ @"event": @"error", @"requestId": requestId ?: @"", @"message": @"Unknown Bluetooth Mesh role." });
        return;
    }
    NSString *supersededRequest = self.requestId;
    [self.central stopScan];
    if (supersededRequest.length && ![supersededRequest isEqualToString:requestId]) {
        Emit(@{ @"event": @"error", @"requestId": supersededRequest, @"message": @"Bluetooth connection was replaced by a newer request." });
    }
    if (self.peripheral && self.peripheral.state != CBPeripheralStateDisconnected) {
        self.expectedDisconnect = YES;
        [self.central cancelPeripheralConnection:self.peripheral];
    }
    self.requestId = requestId ?: @"";
    self.role = role;
    self.preferredId = [command[@"preferredId"] isKindOfClass:NSString.class] ? [command[@"preferredId"] uppercaseString] : @"";
    self.uid = [command[@"uid"] isKindOfClass:NSString.class] ? [command[@"uid"] uppercaseString] : @"";
    NSMutableArray<NSString *> *expectedMacs = [NSMutableArray array];
    if ([command[@"expectedMacs"] isKindOfClass:NSArray.class]) {
        for (id value in command[@"expectedMacs"]) {
            if (![value isKindOfClass:NSString.class]) continue;
            NSString *normalized = [value uppercaseString];
            if (normalized.length) [expectedMacs addObject:normalized];
        }
    }
    self.expectedMacs = expectedMacs;
    self.targetService = [role isEqualToString:@"provisioning"] ? ProvisioningService() : ProxyService();
    self.targetDataIn = [role isEqualToString:@"provisioning"] ? ProvisioningDataIn() : ProxyDataIn();
    self.targetDataOut = [role isEqualToString:@"provisioning"] ? ProvisioningDataOut() : ProxyDataOut();
    self.peripheral = nil;
    self.dataIn = nil;
    self.dataOut = nil;
    self.broadScan = NO;
    [self.candidates removeAllObjects];
    [self.candidatePeripherals removeAllObjects];
    self.scanGeneration += 1;
    NSInteger generation = self.scanGeneration;
    if (self.central.state == CBManagerStatePoweredOn) [self beginFilteredScan:generation];
    else if (self.central.state == CBManagerStateUnauthorized) [self failConnect:@"macOS denied Bluetooth access. Enable GrowBar Bluetooth access in System Settings → Privacy & Security → Bluetooth."];
    else if (self.central.state == CBManagerStateUnsupported) [self failConnect:@"This Mac does not provide a supported Bluetooth controller."];
    else if (self.central.state == CBManagerStatePoweredOff) [self failConnect:@"Bluetooth is turned off on this Mac."];
}

- (void)beginFilteredScan:(NSInteger)generation {
    if (generation != self.scanGeneration || self.requestId.length == 0 || self.peripheral) return;
    Emit(@{ @"event": @"status", @"requestId": self.requestId, @"state": @"scanning", @"detail": [NSString stringWithFormat:@"Scanning natively for Bluetooth Mesh %@ service %@…", self.role, self.targetService.UUIDString] });
    [self.central scanForPeripheralsWithServices:@[self.targetService]
                                         options:@{ CBCentralManagerScanOptionAllowDuplicatesKey: @YES }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (generation != self.scanGeneration || self.peripheral || self.requestId.length == 0) return;
        if ([self.role isEqualToString:@"proxy"] && self.candidatePeripherals.count) [self selectBestProxyCandidate];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(8 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (generation != self.scanGeneration || self.peripheral || self.requestId.length == 0) return;
        self.broadScan = YES;
        [self.central stopScan];
        Emit(@{ @"event": @"status", @"requestId": self.requestId, @"state": @"scanning", @"detail": @"The filtered scan found no fixture; widening to all nearby Bluetooth advertisements…" });
        [self.central scanForPeripheralsWithServices:nil options:@{ CBCentralManagerScanOptionAllowDuplicatesKey: @YES }];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (generation != self.scanGeneration || self.peripheral || self.requestId.length == 0) return;
        [self.central stopScan];
        [self failConnect:[NSString stringWithFormat:@"Native CoreBluetooth did not find a %@ fixture in 30 seconds. Reset Sidus BT on the PB12, quit amaran Desktop, and try again.", self.role]];
    });
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    Emit(@{ @"event": @"state", @"state": CentralStateName(central.state) });
    if (self.requestId.length == 0) return;
    if (central.state == CBManagerStatePoweredOn) [self beginFilteredScan:self.scanGeneration];
    else if (central.state == CBManagerStateUnauthorized) [self failConnect:@"macOS denied Bluetooth access. Enable GrowBar Bluetooth access in System Settings → Privacy & Security → Bluetooth."];
    else if (central.state == CBManagerStatePoweredOff) [self failConnect:@"Bluetooth is turned off on this Mac."];
    else if (central.state == CBManagerStateUnsupported) [self failConnect:@"This Mac does not provide a supported Bluetooth controller."];
}

- (BOOL)advertisement:(NSDictionary *)advertisement containsService:(CBUUID *)service {
    NSArray<CBUUID *> *services = advertisement[CBAdvertisementDataServiceUUIDsKey] ?: @[];
    if ([services containsObject:service]) return YES;
    NSDictionary<CBUUID *, NSData *> *serviceData = advertisement[CBAdvertisementDataServiceDataKey] ?: @{};
    return serviceData[service] != nil;
}

- (NSString *)searchableIdentityForPeripheral:(CBPeripheral *)peripheral advertisement:(NSDictionary *)advertisement {
    NSMutableString *value = [NSMutableString stringWithString:peripheral.identifier.UUIDString.uppercaseString];
    NSString *name = advertisement[CBAdvertisementDataLocalNameKey] ?: peripheral.name;
    if (name) [value appendString:name.uppercaseString];
    NSData *manufacturer = advertisement[CBAdvertisementDataManufacturerDataKey];
    if (manufacturer) [value appendString:Hex(manufacturer).uppercaseString];
    NSDictionary<CBUUID *, NSData *> *serviceData = advertisement[CBAdvertisementDataServiceDataKey] ?: @{};
    for (NSData *data in serviceData.allValues) [value appendString:Hex(data).uppercaseString];
    return value;
}

- (BOOL)searchableIdentity:(NSString *)searchable matchesExpectedMacs:(NSArray<NSString *> *)expectedMacs {
    for (NSString *mac in expectedMacs) {
        NSString *normalized = [[mac componentsSeparatedByCharactersInSet:[[NSCharacterSet alphanumericCharacterSet] invertedSet]] componentsJoinedByString:@""];
        if (normalized.length && [searchable containsString:normalized]) return YES;
        if (normalized.length >= 6 && [searchable containsString:[normalized substringFromIndex:normalized.length - 6]]) return YES;
    }
    return NO;
}

- (void)selectBestProxyCandidate {
    NSString *bestId = nil;
    NSInteger bestRSSI = NSIntegerMin;
    for (NSString *identifier in self.candidates) {
        NSDictionary *candidate = self.candidates[identifier];
        if (![candidate[@"hasTargetService"] boolValue]) continue;
        NSInteger rssi = [candidate[@"rssi"] integerValue];
        if (!bestId || rssi > bestRSSI) { bestId = identifier; bestRSSI = rssi; }
    }
    CBPeripheral *best = bestId ? self.candidatePeripherals[bestId] : nil;
    if (best) [self selectPeripheral:best name:self.candidates[bestId][@"name"] ?: @"Bluetooth Mesh fixture"];
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
    NSString *identifier = peripheral.identifier.UUIDString.uppercaseString;
    NSString *name = advertisementData[CBAdvertisementDataLocalNameKey] ?: peripheral.name ?: @"Unnamed Bluetooth device";
    NSArray<CBUUID *> *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey] ?: @[];
    NSDictionary<CBUUID *, NSData *> *serviceData = advertisementData[CBAdvertisementDataServiceDataKey] ?: @{};
    NSMutableArray *advertisedServices = [NSMutableArray array];
    for (CBUUID *uuid in serviceUUIDs) [advertisedServices addObject:uuid.UUIDString];
    for (CBUUID *uuid in serviceData.allKeys) if (![advertisedServices containsObject:uuid.UUIDString]) [advertisedServices addObject:uuid.UUIDString];
    NSData *targetData = serviceData[self.targetService];
    NSData *manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey];
    NSString *deviceUUID = targetData.length >= 16 ? [Hex([targetData subdataWithRange:NSMakeRange(0, 16)]) uppercaseString] : @"";
    BOOL hasTarget = [self advertisement:advertisementData containsService:self.targetService];
    NSString *searchable = [self searchableIdentityForPeripheral:peripheral advertisement:advertisementData];
    BOOL preferredMatch = self.preferredId.length && [identifier isEqualToString:self.preferredId];
    BOOL uidMatch = self.uid.length && [searchable containsString:self.uid];
    BOOL expectedIdentityMatch = [self searchableIdentity:searchable matchesExpectedMacs:self.expectedMacs ?: @[]];
    NSDictionary *candidate = @{
        @"event": @"scan", @"requestId": self.requestId ?: @"", @"role": self.role ?: @"",
        @"id": identifier, @"name": name, @"rssi": RSSI ?: @0,
        @"advertisedServices": advertisedServices, @"deviceUuid": deviceUUID,
        @"serviceData": targetData ? Hex(targetData) : @"", @"hasTargetService": @(hasTarget),
        @"manufacturerData": manufacturerData ? Hex(manufacturerData) : @"",
        @"uidMatch": @(uidMatch), @"preferredMatch": @(preferredMatch),
        @"expectedIdentityMatch": @(expectedIdentityMatch), @"broadScan": @(self.broadScan)
    };
    self.candidates[identifier] = candidate;
    self.candidatePeripherals[identifier] = peripheral;
    Emit(candidate);
    if (self.peripheral) return;
    BOOL verifiedProvisioning = [self.role isEqualToString:@"provisioning"] && hasTarget;
    BOOL verifiedProxy = [self.role isEqualToString:@"proxy"] && expectedIdentityMatch;
    if (preferredMatch || uidMatch || verifiedProvisioning || verifiedProxy) [self selectPeripheral:peripheral name:name];
}

- (void)selectPeripheral:(CBPeripheral *)peripheral name:(NSString *)name {
    self.peripheral = peripheral;
    self.peripheral.delegate = self;
    [self.central stopScan];
    Emit(@{ @"event": @"status", @"requestId": self.requestId, @"state": @"connecting", @"detail": [NSString stringWithFormat:@"Connecting natively to %@ (%@)…", name, peripheral.identifier.UUIDString] });
    [self.central connectPeripheral:peripheral options:nil];
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    [peripheral discoverServices:@[self.targetService]];
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self failConnect:[NSString stringWithFormat:@"CoreBluetooth could not connect to %@: %@", peripheral.name ?: @"the fixture", error.localizedDescription ?: @"unknown error"]];
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    BOOL expected = self.expectedDisconnect;
    self.expectedDisconnect = NO;
    self.dataIn = nil;
    self.dataOut = nil;
    if (!expected) {
        Emit(@{ @"event": @"disconnected", @"expected": @NO, @"detail": error.localizedDescription ?: @"The PB12 disconnected from native Bluetooth." });
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (error) { [self failConnect:[NSString stringWithFormat:@"Mesh service discovery failed: %@", error.localizedDescription]]; return; }
    CBService *target = nil;
    for (CBService *service in peripheral.services) if ([service.UUID isEqual:self.targetService]) target = service;
    if (!target) { [self failConnect:[NSString stringWithFormat:@"The selected fixture did not expose Mesh %@ service %@ after connection.", self.role, self.targetService.UUIDString]]; return; }
    [peripheral discoverCharacteristics:@[self.targetDataIn, self.targetDataOut] forService:target];
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (error) { [self failConnect:[NSString stringWithFormat:@"Mesh characteristic discovery failed: %@", error.localizedDescription]]; return; }
    for (CBCharacteristic *characteristic in service.characteristics) {
        if ([characteristic.UUID isEqual:self.targetDataIn]) self.dataIn = characteristic;
        if ([characteristic.UUID isEqual:self.targetDataOut]) self.dataOut = characteristic;
    }
    if (!self.dataIn || !self.dataOut) { [self failConnect:@"The PB12 Mesh service is missing its required Data In or Data Out characteristic."]; return; }
    [peripheral setNotifyValue:YES forCharacteristic:self.dataOut];
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (![characteristic.UUID isEqual:self.targetDataOut]) return;
    if (error || !characteristic.isNotifying) { [self failConnect:[NSString stringWithFormat:@"Mesh notification setup failed: %@", error.localizedDescription ?: @"notifications unavailable"]]; return; }
    NSString *requestId = self.requestId ?: @"";
    NSString *identifier = peripheral.identifier.UUIDString.uppercaseString;
    NSDictionary *candidate = self.candidates[identifier] ?: @{};
    self.requestId = @"";
    Emit(@{
        @"event": @"ready", @"requestId": requestId, @"role": self.role ?: @"",
        @"id": identifier, @"name": peripheral.name ?: candidate[@"name"] ?: @"INFINIBAR PB12",
        @"deviceUuid": candidate[@"deviceUuid"] ?: @"", @"serviceData": candidate[@"serviceData"] ?: @""
    });
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (![characteristic.UUID isEqual:self.targetDataOut]) return;
    if (error) { Emit(@{ @"event": @"diagnostic", @"message": [NSString stringWithFormat:@"Bluetooth notification error: %@", error.localizedDescription] }); return; }
    if (characteristic.value.length) Emit(@{ @"event": @"notification", @"hex": Hex(characteristic.value) });
}

- (void)writeHex:(NSString *)hex requestId:(NSString *)requestId {
    NSData *data = DataFromHex(hex);
    if (!data) { Emit(@{ @"event": @"error", @"requestId": requestId ?: @"", @"message": @"Bluetooth write contained invalid hexadecimal data." }); return; }
    if (!self.peripheral || !self.dataIn || self.peripheral.state != CBPeripheralStateConnected) {
        Emit(@{ @"event": @"error", @"requestId": requestId ?: @"", @"message": @"Native Bluetooth transport is not connected." });
        return;
    }
    if (self.dataIn.properties & CBCharacteristicPropertyWriteWithoutResponse) {
        [self.peripheral writeValue:data forCharacteristic:self.dataIn type:CBCharacteristicWriteWithoutResponse];
        Emit(@{ @"event": @"writeResult", @"requestId": requestId ?: @"" });
    } else if (self.dataIn.properties & CBCharacteristicPropertyWrite) {
        self.pendingWrites[self.dataIn.UUID.UUIDString] = @{ @"requestId": requestId ?: @"" };
        [self.peripheral writeValue:data forCharacteristic:self.dataIn type:CBCharacteristicWriteWithResponse];
    } else {
        Emit(@{ @"event": @"error", @"requestId": requestId ?: @"", @"message": @"The PB12 Data In characteristic is not writable." });
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    NSDictionary *pending = self.pendingWrites[characteristic.UUID.UUIDString];
    if (!pending) return;
    [self.pendingWrites removeObjectForKey:characteristic.UUID.UUIDString];
    NSString *requestId = pending[@"requestId"] ?: @"";
    if (error) Emit(@{ @"event": @"error", @"requestId": requestId, @"message": [NSString stringWithFormat:@"PB12 Bluetooth write failed: %@", error.localizedDescription] });
    else Emit(@{ @"event": @"writeResult", @"requestId": requestId });
}

- (void)disconnectWithRequestId:(NSString *)requestId {
    NSString *cancelledRequest = self.requestId;
    self.scanGeneration += 1;
    [self.central stopScan];
    if (self.peripheral && self.peripheral.state != CBPeripheralStateDisconnected) {
        self.expectedDisconnect = YES;
        [self.central cancelPeripheralConnection:self.peripheral];
    }
    self.requestId = @"";
    self.peripheral = nil;
    self.dataIn = nil;
    self.dataOut = nil;
    if (cancelledRequest.length && ![cancelledRequest isEqualToString:requestId]) {
        Emit(@{ @"event": @"error", @"requestId": cancelledRequest, @"message": @"Bluetooth connection was cancelled." });
    }
    Emit(@{ @"event": @"disconnectResult", @"requestId": requestId ?: @"" });
}

- (void)failConnect:(NSString *)message {
    NSString *requestId = self.requestId ?: @"";
    self.scanGeneration += 1;
    [self.central stopScan];
    if (self.peripheral && self.peripheral.state != CBPeripheralStateDisconnected) {
        self.expectedDisconnect = YES;
        [self.central cancelPeripheralConnection:self.peripheral];
    }
    self.requestId = @"";
    self.peripheral = nil;
    self.dataIn = nil;
    self.dataOut = nil;
    Emit(@{ @"event": @"error", @"requestId": requestId, @"message": message ?: @"Native Bluetooth connection failed." });
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        GrowBarBridge *bridge = [[GrowBarBridge alloc] init];
        __block NSMutableData *inputBuffer = [NSMutableData data];
        NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
        input.readabilityHandler = ^(NSFileHandle *handle) {
            NSData *chunk = handle.availableData;
            if (chunk.length == 0) { dispatch_async(dispatch_get_main_queue(), ^{ exit(0); }); return; }
            @synchronized(inputBuffer) {
                [inputBuffer appendData:chunk];
                while (YES) {
                    const unsigned char *bytes = inputBuffer.bytes;
                    NSUInteger newline = NSNotFound;
                    for (NSUInteger i = 0; i < inputBuffer.length; i++) if (bytes[i] == '\n') { newline = i; break; }
                    if (newline == NSNotFound) break;
                    NSData *line = [inputBuffer subdataWithRange:NSMakeRange(0, newline)];
                    [inputBuffer replaceBytesInRange:NSMakeRange(0, newline + 1) withBytes:NULL length:0];
                    if (line.length == 0) continue;
                    NSError *error = nil;
                    NSDictionary *command = [NSJSONSerialization JSONObjectWithData:line options:0 error:&error];
                    if (![command isKindOfClass:NSDictionary.class] || error) {
                        Emit(@{ @"event": @"error", @"requestId": @"", @"message": @"Native Bluetooth helper received invalid JSON." });
                        continue;
                    }
                    dispatch_async(dispatch_get_main_queue(), ^{ [bridge handleCommand:command]; });
                }
            }
        };
        Emit(@{ @"event": @"started", @"version": @1 });
        [NSRunLoop.mainRunLoop run];
    }
    return 0;
}
