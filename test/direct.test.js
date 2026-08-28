'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DirectBluetoothClient } = require('../src/direct');
const { MESH_SEQUENCE_SAFE_LIMIT } = require('../src/direct-protocol');

const credentials = {
  netKey: '0D8094267D3F4EA5B06B324C8C0AD926',
  appKey: 'AB1C91DC421149FF87694B05A236F214',
  fixtures: [{ address: 2, name: 'PB12', mac: 'A4:C1:38:00:00:01' }],
  sequence: 12000000
};

test('initializes the proxy and applies direct CCT and HSI events', async () => {
  const writes = [];
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    onStatus: (status) => statuses.push(status),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'cct', cct: 5600, intensity: 80 });
  await client.apply({ mode: 'hsi', hue: 240, saturation: 100, intensity: 75 });
  assert.equal(statuses.at(-1).state, 'connected');
  assert.equal(statuses.at(-1).capabilities.pixelEffects, true);
  // The second steady-mode update must not send another power-on command;
  // doing so makes a PB12 visibly flash its previous mode.
  assert.equal(writes.length, 11);
  assert.ok(writes.slice(2).every((packet) => packet.length > 20));
});

test('applies every physically validated full-bar Sidus color mode', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'global-hsi', hue: 120, saturation: 100, intensity: 5 });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 10, intensity: 5 });
  await client.apply({ mode: 'global-gel', gelId: 'lee-203', cct: 4300, origin: 0, type: 0, color: 4, intensity: 5 });
  await client.apply({ mode: 'global-rgbw', red: 100, green: 0, blue: 0, warmWhite: 0, coolWhite: 0, intensity: 5 });
  await client.apply({ mode: 'global-xy', x: 0.1442, y: 0.0566, intensity: 5 });
  assert.equal(writes.length, 20);
});

test('waits for the Mesh Proxy Filter Status before adding fixture addresses', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async (milliseconds) => milliseconds === 2000 ? new Promise(() => {}) : undefined
  });
  const attaching = client.attachTransport({ id: 'test', name: 'PB12' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  client.receive(Buffer.from([0x02]));
  await attaching;
  assert.equal(writes.length, 2);
  assert.equal(client.connected, true);
});

test('sends a hardware-derived Pixel FX recipe directly to the PB12', async () => {
  const writes = [];
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    onStatus: (status) => statuses.push(status),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'hsi', hue: 330, saturation: 80, intensity: 70 });
  await client.apply({ mode: 'pixelfx', recipe: { kind: 'rainbow', intensity: 60, speed: 100, direction: 1 } });
  assert.equal(writes.length, 9);
  assert.match(statuses.at(-1).detail, /Hardware-derived rainbow Pixel FX started/);
});

test('stops an onboard Pixel FX before restoring a static full-bar command', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'pixelfx', intensity: 5, recipe: { kind: 'rainbow', intensity: 5, speed: 100, direction: 1 } });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 0, intensity: 5 });
  assert.equal(writes.length, 10);
  assert.equal(client.activeNativeFx, null);
});

test('starts and safely disarms selected-zone Breath before returning to static color', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'partition-breath', partitionZones: 4, zones: [0, 3],
    hue: 260, saturation: 100, intensity: 35, minimum: 2.5, frequency: 0.1
  });
  assert.deepEqual(client.activePartitionFx, { partitionZones: 4, zones: [0, 3] });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 0, intensity: 5 });
  assert.equal(client.activePartitionFx, null);
  assert.equal(writes.length, 12);
});

test('starts and stops physically validated Pulsing III around a static command', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'pulsing3', cct: 4300, intensity: 35, rate: 20 });
  assert.deepEqual(client.activePulsing3, { cct: 4300, intensity: 35, rate: 20 });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 0, intensity: 5 });
  assert.equal(client.activePulsing3, null);
  assert.equal(writes.length, 10);
});

test('starts and cleanly stops the hardware-validated full-bar System engine', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'system-effect', kind: 'strobe', frequency: 10, colorType: 0, intensity: 5 });
  assert.deepEqual(client.activeSystemEffect, { kind: 'strobe', frequency: 10, colorType: 0 });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 0, intensity: 5 });
  assert.equal(client.activeSystemEffect, null);
  assert.equal(writes.length, 10);
});

test('runs validated sequential Partition Pulsing and recovers with explicit per-zone CCT', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'partition-pulse', kind: 'pulsing', partitionZones: 32,
    trigger: 'sequential', frequency: 0.1, intensity: 5
  });
  assert.deepEqual(client.activePartitionFx, {
    kind: 'pulsing', partitionZones: 32, zones: Array.from({ length: 32 }, (_, index) => index)
  });
  await client.apply({ mode: 'global-cct', cct: 4300, gm: 0, intensity: 5 });
  assert.equal(client.activePartitionFx, null);
  assert.equal(writes.length, 12);
});

test('starts eight-section Flash in the hardware-validated stop-enable-parameters order', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet).toString()),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  writes.length = 0;
  client.powered.set(2, true);
  client.session.partitionModePdus = () => [Buffer.from('layout-8')];
  client.session.partitionCctPdus = (_address, settings) => [Buffer.from(
    settings.fxEnabled ? `enable-${settings.zones.length}` : `stop-${settings.zones.length}`
  )];
  client.session.partitionPulsePdus = () => [Buffer.from('flash-parameters')];

  await client.apply({
    mode: 'partition-pulse', kind: 'flash', partitionZones: 8,
    trigger: 'sequential', frequency: 0.1, intensity: 35
  });

  assert.deepEqual(writes, ['layout-8', 'stop-32', 'enable-8', 'flash-parameters']);
  assert.deepEqual(client.activePartitionFx, {
    kind: 'flash', partitionZones: 8, zones: Array.from({ length: 8 }, (_, index) => index)
  });
});

test('partition cleanup explicitly neutralizes all 32 physical sections', async () => {
  const captured = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async () => {},
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  client.activePartitionFx = { kind: 'flash', partitionZones: 8, zones: Array.from({ length: 8 }, (_, index) => index) };
  client.session.partitionCctPdus = (_address, settings) => {
    captured.push(settings);
    return [Buffer.from('stop')];
  };
  await client.stopPartitionFx(client.devices);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].zones, Array.from({ length: 32 }, (_, index) => index));
  assert.equal(captured[0].fxEnabled, false);
});

test('stops an onboard Pixel FX before starting the independent 32-zone engine', async () => {
  const writes = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({ mode: 'pixelfx', intensity: 5, recipe: { kind: 'rainbow', intensity: 5, speed: 100, direction: 1 } });
  await client.apply({
    mode: 'zonefx', targetFps: 5,
    recipe: {
      kind: 'palette-chase', intensity: 20, durationMs: 1000, width: 2,
      colors: [{ hue: 0, saturation: 100, intensity: 20 }, { hue: 240, saturation: 100, intensity: 20 }]
    }
  });
  client.stopSequence();
  assert.equal(client.activeNativeFx, null);
  // Proxy handshake + three-packet wake + native start + native STOP + the
  // validated partition-mode command + two accumulating zone masks.
  assert.equal(writes.length, 10);
});

test('streams grouped 32-zone frames and stops cleanly', async () => {
  const writes = [];
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    onStatus: (status) => statuses.push(status),
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'zonefx',
    recipe: {
      kind: 'palette-chase', intensity: 60, durationMs: 1000, width: 2,
      colors: [{ hue: 0, saturation: 100, intensity: 60 }, { hue: 240, saturation: 100, intensity: 50 }]
    }
  });
  client.stopSequence();
  assert.equal(writes.length, 8);
  assert.match(statuses.at(-1).detail, /started at 1 FPS/);
  assert.match(statuses.at(-1).detail, /15 FPS UI setting is a maximum/);
});

test('honors an authored 140 ms tempo beneath a 30 FPS maximum without duplicating writes', async () => {
  const writes = [];
  const waits = [];
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    onStatus: (status) => statuses.push(status),
    wait: async (milliseconds) => { waits.push(milliseconds); },
    now: () => 1000
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'zonefx', targetFps: 30,
    recipe: {
      kind: 'zone-runner', intensity: 68, durationMs: 140, width: 3,
      colors: [{ hue: 185, saturation: 75, intensity: 68 }, { hue: 205, saturation: 100, intensity: 34 }],
      background: { hue: 235, saturation: 100, intensity: 3 }
    }
  });
  client.stopSequence();
  // Proxy setup + wake + one partition-layout command + exactly three grouped
  // zone commands. Zone frames themselves are never duplicated.
  assert.equal(writes.length, 9);
  assert.equal(waits.filter((milliseconds) => milliseconds === 0).length, 0);
  assert.match(statuses.at(-1).detail, /started at 7\.1 FPS/);
  assert.match(statuses.at(-1).detail, /7\.1 FPS authored pace/);
});

test('keeps a 60 FPS UI maximum from accelerating an authored compact chase', async () => {
  const writes = [];
  const waits = [];
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async (packet) => writes.push(Buffer.from(packet)),
    onStatus: (status) => statuses.push(status),
    wait: async (milliseconds) => { waits.push(milliseconds); },
    now: () => 1000
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'zonefx', targetFps: 60,
    recipe: {
      kind: 'zone-runner', intensity: 68, durationMs: 140, width: 3,
      colors: [{ hue: 185, saturation: 75, intensity: 68 }, { hue: 205, saturation: 100, intensity: 34 }],
      background: { hue: 235, saturation: 100, intensity: 3 }
    }
  });
  client.stopSequence();
  assert.equal(writes.length, 9);
  assert.equal(waits.filter((milliseconds) => milliseconds === 0).length, 0);
  assert.match(statuses.at(-1).detail, /started at 7\.1 FPS/);
  assert.match(statuses.at(-1).detail, /60 FPS UI setting is a maximum/);
});

test('applies the authored frame duration even to a one-command full-bar animation', async () => {
  const statuses = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async () => {},
    onStatus: (status) => statuses.push(status),
    wait: async () => {},
    now: () => 1000
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'zonefx', targetFps: 60,
    recipe: { kind: 'chromatic-wander', intensity: 60, durationMs: 80, transitionFrames: 90, seed: 123 }
  });
  client.stopSequence();
  assert.match(statuses.at(-1).detail, /started at 12\.5 FPS/);
  assert.match(statuses.at(-1).detail, /12\.5 FPS authored pace/);
});

test('refuses a four-hour stream when safe sequence capacity is insufficient', async () => {
  const client = new DirectBluetoothClient({
    credentials: { ...credentials, sequence: MESH_SEQUENCE_SAFE_LIMIT - 5000 },
    write: async () => {},
    wait: async () => {}
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await assert.rejects(client.apply({
    mode: 'zonefx', targetFps: 5,
    recipe: {
      kind: 'zone-runner', intensity: 68, width: 3,
      colors: [{ hue: 185, saturation: 75, intensity: 68 }, { hue: 205, saturation: 100, intensity: 34 }],
      background: { hue: 235, saturation: 100, intensity: 3 }
    }
  }), /not enough safe Bluetooth Mesh sequence capacity/);
  assert.equal(client.animationTimer, null);
});

test('a connection loss stops a stream and asks the owner to discard its override', async () => {
  const stopped = [];
  const client = new DirectBluetoothClient({
    credentials,
    write: async () => {},
    onAnimationStopped: (reason) => stopped.push(reason),
    wait: async () => {},
    now: () => 1000
  });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await client.apply({
    mode: 'zonefx', targetFps: 5,
    recipe: { kind: 'chromatic-wander', intensity: 60, transitionFrames: 90, seed: 123 }
  });
  client.transportLost('test disconnect');
  assert.deepEqual(stopped, ['connection-lost']);
  assert.equal(client.animationTimer, null);
  assert.equal(client.connected, false);
});

test('rejects retired amaran preset events without silently reopening amaran', async () => {
  const client = new DirectBluetoothClient({ credentials, write: async () => {}, wait: async () => {} });
  await client.attachTransport({ id: 'test', name: 'PB12' });
  await assert.rejects(client.apply({ mode: 'effect', effectType: 'rainbow', intensity: 60 }), /retired amaran preset format/);
});

test('finishes AppKey and vendor-model setup after a fresh direct pairing', async () => {
  const writes = [];
  let configuredSequence = 0;
  const client = new DirectBluetoothClient({
    credentials: { ...credentials, deviceKey: '00112233445566778899AABBCCDDEEFF', configured: false, sequence: 100 },
    write: async (packet) => writes.push(Buffer.from(packet)),
    onConfigured: (sequence) => { configuredSequence = sequence; },
    wait: async () => {}
  });
  await client.attachTransport({ id: 'fresh', name: 'PB12' });
  assert.equal(writes.length, 5);
  assert.equal(configuredSequence, 105);
  assert.equal(client.connected, true);
});
