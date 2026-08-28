'use strict';

// Bluetooth Mesh and Telink packet construction adapted from the MIT-licensed
// amaran-BLE-control project by Wes Bos. See THIRD_PARTY_NOTICES.md.

const crypto = require('node:crypto');

const LOCAL_ADDRESS = 0x0001;
const GROUP_ALL = 0xc000;
const DEFAULT_TTL = 10;
const TELINK_OPCODE = 0x26;
const TELINK_WRITE_FLAG = 0x80;
const TELINK_PIXEL_EFFECT = 0x21;
const TELINK_PARTITION_COLOR = 0x23;
const TELINK_PARTITION_EFFECT = 0x24;
const TELINK_PULSING_V3 = 0x22;
const PARTITION_MODE_CODES = Object.freeze({ 4: 0, 8: 2, 12: 3, 16: 4, 24: 5, 32: 1 });
// GrowBar does not yet implement the Bluetooth Mesh IV Update procedure. A
// sequence number must therefore never wrap: reusing an old 24-bit value makes
// a fixture reject otherwise valid commands as replayed traffic. Leave a small
// emergency margin below the wire maximum so ordinary power/schedule commands
// can fail safely before 0xFFFFFF is reached.
const MESH_SEQUENCE_SAFE_LIMIT = 0xfff000;

// Values used by the PB12's Telink Pixel FX menu. The packet layouts and
// enum values are reproduced from the current amaran Desktop
// mesh_sdk.telink_protocol implementation. Every recipe is handed to the
// fixture's own effect engine, so GrowBar sends a short configuration burst
// instead of trying to stream 96 pixels over Bluetooth Mesh.
const PIXEL_EFFECT = Object.freeze({
  COLOR_FADE: 0,
  COLOR_CYCLE: 1,
  ONE_COLOR_CHASE: 2,
  TWO_COLOR_CHASE: 3,
  THREE_COLOR_CHASE: 4,
  PIXEL_FIRE: 5,
  ON_OFF: 6,
  RAINBOW: 7
});

// Hardware captures from amaran Desktop on a PB12 establish the state split:
// palette/layer packages use RUN_LOOP while the final package-0 movement
// command uses RUN_ONCE. These names describe the vendor wire values; the
// fixture's onboard engine still loops the selected Pixel FX continuously.
const PIXEL_EFFECT_STATE = Object.freeze({ STOP: 0, RUN: 1, RUN_ONCE: 2, RUN_LOOP: 3 });

const PIXEL_LIGHT_MODE = Object.freeze({ CCT: 0, HSI: 1, BLACK: 2 });

function aesEcbBlock(key, data) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function shiftLeft(block, xorByte) {
  const output = Buffer.alloc(16);
  let carry = 0;
  for (let index = 15; index >= 0; index -= 1) {
    output[index] = ((block[index] << 1) | carry) & 0xff;
    carry = block[index] & 0x80 ? 1 : 0;
  }
  if (xorByte) output[15] ^= xorByte;
  return output;
}

function aesCmac(key, message) {
  const l = aesEcbBlock(key, Buffer.alloc(16));
  const k1 = shiftLeft(l, l[0] & 0x80 ? 0x87 : 0);
  const k2 = shiftLeft(k1, k1[0] & 0x80 ? 0x87 : 0);
  const blocks = Math.ceil(message.length / 16) || 1;
  const complete = message.length > 0 && message.length % 16 === 0;
  let x = Buffer.alloc(16);
  for (let index = 0; index < blocks - 1; index += 1) {
    const block = message.subarray(index * 16, index * 16 + 16);
    for (let byte = 0; byte < 16; byte += 1) x[byte] ^= block[byte];
    x = aesEcbBlock(key, x);
  }
  const last = Buffer.alloc(16);
  if (complete) {
    message.copy(last, 0, (blocks - 1) * 16, blocks * 16);
    for (let byte = 0; byte < 16; byte += 1) last[byte] ^= k1[byte];
  } else {
    const remainder = message.length % 16;
    if (remainder) message.copy(last, 0, (blocks - 1) * 16, (blocks - 1) * 16 + remainder);
    last[remainder] = 0x80;
    for (let byte = 0; byte < 16; byte += 1) last[byte] ^= k2[byte];
  }
  for (let byte = 0; byte < 16; byte += 1) x[byte] ^= last[byte];
  return aesEcbBlock(key, x);
}

function s1(message) { return aesCmac(Buffer.alloc(16), message); }

function k2(netKey) {
  const salt = s1(Buffer.from('smk2'));
  const t = aesCmac(salt, netKey);
  const p = Buffer.from([0]);
  const t1 = aesCmac(t, Buffer.concat([p, Buffer.from([1])]));
  const t2 = aesCmac(t, Buffer.concat([t1, p, Buffer.from([2])]));
  const t3 = aesCmac(t, Buffer.concat([t2, p, Buffer.from([3])]));
  return { nid: t1[15] & 0x7f, encryptionKey: t2, privacyKey: t3 };
}

function k4(appKey) {
  const salt = s1(Buffer.from('smk4'));
  const t = aesCmac(salt, appKey);
  return aesCmac(t, Buffer.from([0x69, 0x64, 0x36, 0x01]))[15] & 0x3f;
}

function writeCounter(buffer, offset, length, value) {
  let remaining = BigInt(value);
  for (let index = length - 1; index >= 0; index -= 1) {
    buffer[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('Bluetooth Mesh CCM value is too large.');
}

function xor16(left, right) {
  const output = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) output[index] = left[index] ^ right[index];
  return output;
}

// Electron links Node's crypto API against BoringSSL, which deliberately omits
// aes-128-ccm even though regular Node/OpenSSL provides it. Bluetooth Mesh needs
// CCM with a 13-byte nonce and a 4-byte MIC, so implement the small no-AAD CCM
// operation from its AES-ECB building block. ECB is used only as the primitive;
// this function still provides standard authenticated CCM encryption.
function aesCcmEncrypt(key, nonce, plaintext, micLength) {
  const secret = Buffer.from(key);
  const nonceBytes = Buffer.from(nonce);
  const message = Buffer.from(plaintext);
  const lengthBytes = 15 - nonceBytes.length;
  if (secret.length !== 16) throw new Error('Bluetooth Mesh CCM requires a 128-bit key.');
  if (lengthBytes < 2 || lengthBytes > 8) throw new Error('Bluetooth Mesh CCM nonce must be 7–13 bytes.');
  if (!Number.isInteger(micLength) || micLength < 4 || micLength > 16 || micLength % 2 !== 0) {
    throw new Error('Bluetooth Mesh CCM authentication tag length is invalid.');
  }
  if (BigInt(message.length) >= (1n << BigInt(8 * lengthBytes))) {
    throw new Error('Bluetooth Mesh CCM message is too large.');
  }

  const first = Buffer.alloc(16);
  first[0] = (((micLength - 2) / 2) << 3) | (lengthBytes - 1);
  nonceBytes.copy(first, 1);
  writeCounter(first, 16 - lengthBytes, lengthBytes, message.length);
  let mac = aesEcbBlock(secret, first);
  for (let offset = 0; offset < message.length; offset += 16) {
    const block = Buffer.alloc(16);
    message.copy(block, 0, offset, Math.min(offset + 16, message.length));
    mac = aesEcbBlock(secret, xor16(mac, block));
  }

  const counterBlock = (counter) => {
    const block = Buffer.alloc(16);
    block[0] = lengthBytes - 1;
    nonceBytes.copy(block, 1);
    writeCounter(block, 16 - lengthBytes, lengthBytes, counter);
    return block;
  };
  const encrypted = Buffer.alloc(message.length);
  for (let offset = 0, counter = 1; offset < message.length; offset += 16, counter += 1) {
    const stream = aesEcbBlock(secret, counterBlock(counter));
    const count = Math.min(16, message.length - offset);
    for (let index = 0; index < count; index += 1) encrypted[offset + index] = message[offset + index] ^ stream[index];
  }
  const tagMask = aesEcbBlock(secret, counterBlock(0));
  const tag = Buffer.alloc(micLength);
  for (let index = 0; index < micLength; index += 1) tag[index] = mac[index] ^ tagMask[index];
  return Buffer.concat([encrypted, tag]);
}

function aesCcmDecrypt(key, nonce, ciphertextAndTag, micLength) {
  const secret = Buffer.from(key);
  const nonceBytes = Buffer.from(nonce);
  const combined = Buffer.from(ciphertextAndTag);
  const lengthBytes = 15 - nonceBytes.length;
  if (secret.length !== 16) throw new Error('Bluetooth Mesh CCM requires a 128-bit key.');
  if (lengthBytes < 2 || lengthBytes > 8) throw new Error('Bluetooth Mesh CCM nonce must be 7–13 bytes.');
  if (!Number.isInteger(micLength) || micLength < 4 || micLength > 16 || micLength % 2 !== 0) {
    throw new Error('Bluetooth Mesh CCM authentication tag length is invalid.');
  }
  if (combined.length < micLength) throw new Error('Bluetooth Mesh CCM packet is shorter than its authentication tag.');

  const encrypted = combined.subarray(0, combined.length - micLength);
  const receivedTag = combined.subarray(combined.length - micLength);
  const counterBlock = (counter) => {
    const block = Buffer.alloc(16);
    block[0] = lengthBytes - 1;
    nonceBytes.copy(block, 1);
    writeCounter(block, 16 - lengthBytes, lengthBytes, counter);
    return block;
  };
  const plaintext = Buffer.alloc(encrypted.length);
  for (let offset = 0, counter = 1; offset < encrypted.length; offset += 16, counter += 1) {
    const stream = aesEcbBlock(secret, counterBlock(counter));
    const count = Math.min(16, encrypted.length - offset);
    for (let index = 0; index < count; index += 1) plaintext[offset + index] = encrypted[offset + index] ^ stream[index];
  }

  const first = Buffer.alloc(16);
  first[0] = (((micLength - 2) / 2) << 3) | (lengthBytes - 1);
  nonceBytes.copy(first, 1);
  writeCounter(first, 16 - lengthBytes, lengthBytes, plaintext.length);
  let mac = aesEcbBlock(secret, first);
  for (let offset = 0; offset < plaintext.length; offset += 16) {
    const block = Buffer.alloc(16);
    plaintext.copy(block, 0, offset, Math.min(offset + 16, plaintext.length));
    mac = aesEcbBlock(secret, xor16(mac, block));
  }
  const tagMask = aesEcbBlock(secret, counterBlock(0));
  const expectedTag = Buffer.alloc(micLength);
  for (let index = 0; index < micLength; index += 1) expectedTag[index] = mac[index] ^ tagMask[index];
  if (!crypto.timingSafeEqual(receivedTag, expectedTag)) throw new Error('Bluetooth Mesh CCM authentication failed.');
  return plaintext;
}

function deviceNonce(sequence, source, destination, ivIndex, szmic = 0) {
  return Buffer.from([0x02, szmic << 7, sequence >> 16, sequence >> 8, sequence, source >> 8, source,
    destination >> 8, destination, ivIndex >> 24, ivIndex >> 16, ivIndex >> 8, ivIndex].map((value) => value & 0xff));
}

function applicationNonce(sequence, source, destination, ivIndex) {
  return Buffer.from([0x01, 0x00, sequence >> 16, sequence >> 8, sequence, source >> 8, source,
    destination >> 8, destination, ivIndex >> 24, ivIndex >> 16, ivIndex >> 8, ivIndex].map((value) => value & 0xff));
}

function networkNonce(control, ttl, sequence, source, ivIndex) {
  return Buffer.from([0x00, (control << 7) | ttl, sequence >> 16, sequence >> 8, sequence,
    source >> 8, source, 0, 0, ivIndex >> 24, ivIndex >> 16, ivIndex >> 8, ivIndex].map((value) => value & 0xff));
}

function proxyNonce(sequence, source, ivIndex) {
  return Buffer.from([0x03, 0, sequence >> 16, sequence >> 8, sequence, source >> 8, source,
    0, 0, ivIndex >> 24, ivIndex >> 16, ivIndex >> 8, ivIndex].map((value) => value & 0xff));
}

function privacyBlock(privacyKey, ivIndex, encryptedPayload) {
  const input = Buffer.alloc(16);
  input.writeUInt32BE(ivIndex >>> 0, 5);
  encryptedPayload.copy(input, 9, 0, 7);
  return aesEcbBlock(privacyKey, input);
}

function obfuscateHeader(privacyKey, ivIndex, encryptedPayload, control, ttl, sequence, source) {
  const pecb = privacyBlock(privacyKey, ivIndex, encryptedPayload);
  const header = Buffer.from([(control << 7) | ttl, sequence >> 16, sequence >> 8, sequence, source >> 8, source]);
  return Buffer.from(header.map((value, index) => value ^ pecb[index]));
}

function deobfuscateHeader(privacyKey, ivIndex, encryptedPayload, obfuscatedHeader) {
  const pecb = privacyBlock(privacyKey, ivIndex, encryptedPayload);
  return Buffer.from(obfuscatedHeader.map((value, index) => value ^ pecb[index]));
}

function accessOpcodeLength(firstByte) {
  if ((firstByte & 0x80) === 0) return 1;
  if ((firstByte & 0xc0) === 0x80) return 2;
  return 3;
}

function decodeProxyAccessPdu({ netKey, appKey, proxyPdu, ivIndexes = [0] } = {}) {
  const proxy = Buffer.from(proxyPdu || []);
  if (!/^[0-9a-f]{32}$/i.test(netKey || '') || !/^[0-9a-f]{32}$/i.test(appKey || '')) {
    throw new Error('Valid mesh network and application keys are required for local capture analysis.');
  }
  if (proxy.length < 15) throw new Error('Proxy PDU is too short to contain a Bluetooth Mesh message.');
  const sar = proxy[0] >> 6;
  const proxyType = proxy[0] & 0x3f;
  if (sar !== 0) throw new Error('Proxy PDU must be reassembled before decryption.');
  if (proxyType !== 0) throw new Error(`Proxy PDU type ${proxyType} is not a Mesh Network PDU.`);

  const networkPdu = proxy.subarray(1);
  const network = k2(Buffer.from(netKey, 'hex'));
  const appKeyBytes = Buffer.from(appKey, 'hex');
  const aid = k4(appKeyBytes);
  if ((networkPdu[0] & 0x7f) !== network.nid) throw new Error('Network identifier does not match the imported amaran mesh.');
  const indexes = [...new Set((ivIndexes || []).filter(Number.isInteger).map((value) => value >>> 0))];
  if (!indexes.length) indexes.push(0);
  let lastError = null;

  for (const ivIndex of indexes) {
    try {
      if (((networkPdu[0] >> 7) & 1) !== (ivIndex & 1)) continue;
      const encryptedPayload = networkPdu.subarray(7);
      const clearHeader = deobfuscateHeader(network.privacyKey, ivIndex, encryptedPayload, networkPdu.subarray(1, 7));
      const control = clearHeader[0] >> 7;
      const ttl = clearHeader[0] & 0x7f;
      const sequence = clearHeader.readUIntBE(1, 3);
      const source = clearHeader.readUInt16BE(4);
      const netMicLength = control ? 8 : 4;
      const networkPlaintext = aesCcmDecrypt(
        network.encryptionKey,
        networkNonce(control, ttl, sequence, source, ivIndex),
        encryptedPayload,
        netMicLength
      );
      if (networkPlaintext.length < 4) throw new Error('Decrypted Network PDU is incomplete.');
      const destination = networkPlaintext.readUInt16BE(0);
      const lower = networkPlaintext.subarray(2);
      if (control) return { control: true, ttl, sequence, source, destination, ivIndex, lowerTransport: lower };
      if (lower[0] & 0x80) {
        return { segmented: true, ttl, sequence, source, destination, ivIndex, lowerTransport: lower };
      }
      const akf = (lower[0] >> 6) & 1;
      const packetAid = lower[0] & 0x3f;
      if (!akf || packetAid !== aid) throw new Error('Access PDU does not use the imported application key.');
      const access = aesCcmDecrypt(
        appKeyBytes,
        applicationNonce(sequence, source, destination, ivIndex),
        lower.subarray(1),
        4
      );
      if (!access.length) throw new Error('Decrypted Access PDU is empty.');
      const opcodeLength = accessOpcodeLength(access[0]);
      if (access.length < opcodeLength) throw new Error('Decrypted Access opcode is incomplete.');
      return {
        control: false,
        segmented: false,
        ttl,
        sequence,
        source,
        destination,
        ivIndex,
        opcode: access.subarray(0, opcodeLength),
        parameters: access.subarray(opcodeLength)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No candidate IV Index could decrypt the Mesh packet.');
}

function buildAccessPdu(keys, sequence, destination, opcode, parameters, ivIndex) {
  const access = Buffer.concat([Buffer.from([opcode]), parameters]);
  const upper = aesCcmEncrypt(keys.appKey, applicationNonce(sequence, LOCAL_ADDRESS, destination, ivIndex), access, 4);
  const lower = Buffer.concat([Buffer.from([0x40 | keys.aid]), upper]);
  const plaintext = Buffer.concat([Buffer.from([destination >> 8, destination & 0xff]), lower]);
  const encrypted = aesCcmEncrypt(keys.encryptionKey, networkNonce(0, DEFAULT_TTL, sequence, LOCAL_ADDRESS, ivIndex), plaintext, 4);
  const header = obfuscateHeader(keys.privacyKey, ivIndex, encrypted, 0, DEFAULT_TTL, sequence, LOCAL_ADDRESS);
  return Buffer.concat([Buffer.from([(ivIndex & 1) << 7 | keys.nid]), header, encrypted]);
}

function buildAccessPdus(keys, sequenceStart, destination, opcode, parameters, ivIndex) {
  const access = Buffer.concat([Buffer.from([opcode]), parameters]);
  const upper = aesCcmEncrypt(keys.appKey, applicationNonce(sequenceStart, LOCAL_ADDRESS, destination, ivIndex), access, 4);
  if (upper.length <= 15) return [buildAccessPdu(keys, sequenceStart, destination, opcode, parameters, ivIndex)];
  const segmentCount = Math.ceil(upper.length / 12);
  const seqZero = sequenceStart & 0x1fff;
  return Array.from({ length: segmentCount }, (_, segmentOffset) => {
    const sequence = sequenceStart + segmentOffset;
    const lowerHeader = Buffer.from([
      0xc0 | keys.aid,
      (seqZero >> 6) & 0x7f,
      ((seqZero & 0x3f) << 2) | ((segmentOffset >> 3) & 0x03),
      ((segmentOffset & 0x07) << 5) | ((segmentCount - 1) & 0x1f)
    ]);
    const lower = Buffer.concat([lowerHeader, upper.subarray(segmentOffset * 12, segmentOffset * 12 + 12)]);
    const plaintext = Buffer.concat([Buffer.from([destination >> 8, destination & 0xff]), lower]);
    const encrypted = aesCcmEncrypt(keys.encryptionKey, networkNonce(0, DEFAULT_TTL, sequence, LOCAL_ADDRESS, ivIndex), plaintext, 4);
    const header = obfuscateHeader(keys.privacyKey, ivIndex, encrypted, 0, DEFAULT_TTL, sequence, LOCAL_ADDRESS);
    return Buffer.concat([Buffer.from([(ivIndex & 1) << 7 | keys.nid]), header, encrypted]);
  });
}

function buildDeviceAccessPdus(keys, sequenceStart, destination, access, ivIndex) {
  const source = LOCAL_ADDRESS;
  const upper = aesCcmEncrypt(keys.deviceKey, deviceNonce(sequenceStart, source, destination, ivIndex), Buffer.from(access), 4);
  if (upper.length <= 15) {
    const lower = Buffer.concat([Buffer.from([0x00]), upper]);
    const plaintext = Buffer.concat([Buffer.from([destination >> 8, destination & 0xff]), lower]);
    const encrypted = aesCcmEncrypt(keys.encryptionKey, networkNonce(0, DEFAULT_TTL, sequenceStart, source, ivIndex), plaintext, 4);
    const header = obfuscateHeader(keys.privacyKey, ivIndex, encrypted, 0, DEFAULT_TTL, sequenceStart, source);
    return [Buffer.concat([Buffer.from([0x00, (ivIndex & 1) << 7 | keys.nid]), header, encrypted])];
  }
  const segmentCount = Math.ceil(upper.length / 12);
  const seqZero = sequenceStart & 0x1fff;
  return Array.from({ length: segmentCount }, (_, segmentOffset) => {
    const sequence = sequenceStart + segmentOffset;
    const lowerHeader = Buffer.from([
      0x80,
      (seqZero >> 6) & 0x7f,
      ((seqZero & 0x3f) << 2) | ((segmentOffset >> 3) & 0x03),
      ((segmentOffset & 0x07) << 5) | ((segmentCount - 1) & 0x1f)
    ]);
    const lower = Buffer.concat([lowerHeader, upper.subarray(segmentOffset * 12, segmentOffset * 12 + 12)]);
    const plaintext = Buffer.concat([Buffer.from([destination >> 8, destination & 0xff]), lower]);
    const encrypted = aesCcmEncrypt(keys.encryptionKey, networkNonce(0, DEFAULT_TTL, sequence, source, ivIndex), plaintext, 4);
    const header = obfuscateHeader(keys.privacyKey, ivIndex, encrypted, 0, DEFAULT_TTL, sequence, source);
    return Buffer.concat([Buffer.from([0x00, (ivIndex & 1) << 7 | keys.nid]), header, encrypted]);
  });
}

function buildProxyConfigPdu(keys, sequence, opcode, parameters, ivIndex) {
  const destination = 0;
  const transport = Buffer.concat([Buffer.from([opcode & 0x7f]), parameters]);
  const plaintext = Buffer.concat([Buffer.from([0, destination]), transport]);
  const encrypted = aesCcmEncrypt(keys.encryptionKey, proxyNonce(sequence, LOCAL_ADDRESS, ivIndex), plaintext, 4);
  const header = obfuscateHeader(keys.privacyKey, ivIndex, encrypted, 1, 0, sequence, LOCAL_ADDRESS);
  return Buffer.concat([Buffer.from([0x02, (ivIndex & 1) << 7 | keys.nid]), header, encrypted]);
}

function finalizeTelink(packet) {
  let sum = 0;
  for (let index = 1; index < packet.length; index += 1) sum += packet[index];
  packet[0] = sum & 0xff;
  return packet;
}

function telinkBytes(hex) {
  const packet = Buffer.from(hex, 'hex');
  if (packet.length < 10 || packet.length > 11) throw new Error('A Sidus system packet must be 10 or 11 bytes.');
  return finalizeTelink(packet);
}

function clampInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function strictInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function telinkPacked(commandType, fields) {
  let packed = 0n;
  let totalBits = 0;
  for (const [label, width, rawValue] of fields) {
    if (!Number.isInteger(width) || width < 1 || width > 64) throw new Error(`Invalid ${label} field width.`);
    const value = clampInteger(rawValue, 0, Number((1n << BigInt(width)) - 1n), label);
    packed = (packed << BigInt(width)) | BigInt(value);
    totalBits += width;
  }
  if (totalBits !== 64) throw new Error(`Telink payload fields must total 64 bits, not ${totalBits}.`);
  const packet = Buffer.alloc(10);
  for (let index = 0; index < 8; index += 1) packet[1 + index] = Number((packed >> BigInt(index * 8)) & 0xffn);
  packet[9] = TELINK_WRITE_FLAG | commandType;
  return finalizeTelink(packet);
}

function pixelEffectType(colorCount) {
  const count = clampInteger(colorCount, 1, 3, 'Pixel chase color count');
  return [0, PIXEL_EFFECT.ONE_COLOR_CHASE, PIXEL_EFFECT.TWO_COLOR_CHASE, PIXEL_EFFECT.THREE_COLOR_CHASE][count];
}

function pixelHsiPacket(effectType, packageType, serial, color, state = PIXEL_EFFECT_STATE.RUN_LOOP) {
  return telinkPacked(TELINK_PIXEL_EFFECT, [
    ['effect type', 8, effectType], ['state', 2, state], ['package type', 2, packageType],
    ['serial', 4, serial], ['brightness', 10, pixelBrightness(color.intensity, 'Color brightness')],
    ['light mode', 2, PIXEL_LIGHT_MODE.HSI], ['hue', 9, color.hue], ['saturation', 7, color.saturation],
    ['CCT reference', 9, color.cct ?? 112], ['reserve', 11, 0]
  ]);
}

function normalizePixelColor(color, fallbackIntensity) {
  const brightness = Number(color?.intensity ?? fallbackIntensity);
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) throw new Error('Color brightness must be from 0 to 100%.');
  return {
    hue: clampInteger(color?.hue ?? 0, 0, 360, 'Hue'),
    saturation: clampInteger(color?.saturation ?? 100, 0, 100, 'Saturation'),
    intensity: brightness,
    // Captured amaran packets use 112 as the neutral HSI white reference.
    cct: clampInteger(color?.cct ?? 112, 0, 511, 'CCT reference')
  };
}

function pixelBrightness(percent, label = 'Pixel brightness') {
  // Sidus Link 2.0.42 and the PB12 use the ordinary 0..1000 intensity scale
  // for native Pixel FX. Hardware validation used 2.5% => 25 and 5% => 50.
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be from 0 to 100%.`);
  return Math.round(value * 10);
}

function telinkPixelFx(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new Error('This animation is missing its PB12 Pixel FX recipe.');
  const paletteState = PIXEL_EFFECT_STATE.RUN_LOOP;
  const startState = PIXEL_EFFECT_STATE.RUN_ONCE;
  const intensity = clampInteger(recipe.intensity ?? 65, 1, 100, 'Animation brightness');
  const speed = clampInteger(recipe.speed ?? 180, 0, 1000, 'Animation speed');
  const direction = clampInteger(recipe.direction ?? 0, 0, 15, 'Animation direction');
  const colors = (recipe.colors || []).map((color) => normalizePixelColor(color, intensity));

  if (recipe.kind === 'chase') {
    if (colors.length < 1 || colors.length > 3) throw new Error('A PB12 pixel chase needs one to three colors.');
    const effectType = pixelEffectType(colors.length);
    const base = telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, effectType], ['state', 2, startState], ['package type', 2, 0],
      ['group', 2, clampInteger(recipe.group ?? 1, 0, 3, 'Chase group')],
      ['direction', 2, direction], ['pixel length', 3, clampInteger(recipe.pixelLength ?? 2, 0, 7, 'Pixel length')],
      ['speed', 10, speed], ['reserve', 35, 0]
    ]);
    // The PB12 latches an onboard Pixel FX recipe when it receives package 0.
    // amaran Desktop therefore sends every palette package first and the
    // movement package last. Sending package 0 first makes the later palette
    // writes leave the bar on a single static color instead of starting the
    // configured chase.
    const baseColor = normalizePixelColor(recipe.baseColor || colors[0], intensity);
    const background = recipe.blackBackground
      ? telinkPacked(TELINK_PIXEL_EFFECT, [
        ['effect type', 8, effectType], ['state', 2, paletteState], ['package type', 2, 1],
        ['serial', 4, 0], ['brightness', 10, 0],
        ['light mode', 2, PIXEL_LIGHT_MODE.BLACK], ['reserve', 36, 0]
      ])
      : pixelHsiPacket(effectType, 1, 0, baseColor, paletteState);
    return [background, ...colors.map((color, serial) => pixelHsiPacket(effectType, 1, serial + 1, color, paletteState)), base];
  }

  if (recipe.kind === 'fade' || recipe.kind === 'cycle') {
    if (colors.length < 2 || colors.length > 15) throw new Error('A PB12 color flow needs two to fifteen colors.');
    const effectType = recipe.kind === 'fade' ? PIXEL_EFFECT.COLOR_FADE : PIXEL_EFFECT.COLOR_CYCLE;
    const baseFields = [
      ['effect type', 8, effectType], ['state', 2, startState], ['package type', 2, 0],
      ['color count', 4, colors.length], ['direction', 4, direction], ['speed', 10, speed]
    ];
    if (recipe.kind === 'cycle') baseFields.push(['change style', 2, clampInteger(recipe.changeStyle ?? 0, 0, 3, 'Color change style')], ['reserve', 32, 0]);
    else baseFields.push(['reserve', 34, 0]);
    const base = telinkPacked(TELINK_PIXEL_EFFECT, baseFields);
    return [...colors.map((color, serial) => pixelHsiPacket(effectType, 1, serial, color, paletteState)), base];
  }

  if (recipe.kind === 'rainbow') {
    return [telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.RAINBOW], ['state', 2, startState], ['brightness', 10, pixelBrightness(intensity)],
      ['direction', 3, direction], ['speed', 10, speed], ['reserve', 31, 0]
    ])];
  }

  if (recipe.kind === 'fire') {
    const baseColor = normalizePixelColor(recipe.baseColor || { hue: 18, saturation: 95 }, intensity);
    const sparkColor = normalizePixelColor(recipe.sparkColor || { hue: 45, saturation: 80 }, intensity);
    const minimum = Number(recipe.minimum ?? Math.round(intensity * 0.18));
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('Minimum fire brightness must be from 0 to 100%.');
    if (minimum > sparkColor.intensity) throw new Error('Minimum fire brightness cannot exceed the flame brightness.');
    const base = telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, startState], ['package type', 2, 0],
      ['frequency', 10, speed], ['direction', 2, direction], ['reserve', 40, 0]
    ]);
    const range = (color) => telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, paletteState], ['package type', 2, 1],
      ['maximum brightness', 10, pixelBrightness(color.intensity)], ['minimum brightness', 10, pixelBrightness(minimum)],
      ['light mode', 2, PIXEL_LIGHT_MODE.HSI], ['hue', 9, color.hue], ['saturation', 7, color.saturation],
      ['CCT reference', 9, color.cct], ['reserve', 5, 0]
    ]);
    const fixed = (color) => telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, paletteState], ['package type', 2, 2],
      ['brightness', 10, pixelBrightness(color.intensity)], ['light mode', 2, PIXEL_LIGHT_MODE.HSI],
      ['hue', 9, color.hue], ['saturation', 7, color.saturation], ['CCT reference', 9, color.cct],
      ['reserve', 15, 0]
    ]);
    // Physical PB12 validation established this exact order: fire layer,
    // base layer, then package-0 movement/state.
    return [range(sparkColor), fixed(baseColor), base];
  }

  throw new Error(`Unsupported PB12 Pixel FX recipe: ${recipe.kind || 'unknown'}.`);
}

function telinkPixelFxStop(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new Error('The active PB12 Pixel FX recipe is missing.');
  const intensity = clampInteger(recipe.intensity ?? 5, 0, 100, 'Animation brightness');
  const speed = clampInteger(recipe.speed ?? 100, 0, 1000, 'Animation speed');
  const direction = clampInteger(recipe.direction ?? 0, 0, 15, 'Animation direction');
  const colors = (recipe.colors || []).map((color) => normalizePixelColor(color, intensity));
  if (recipe.kind === 'rainbow') {
    return [telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.RAINBOW], ['state', 2, PIXEL_EFFECT_STATE.STOP],
      ['brightness', 10, 0], ['direction', 3, 0], ['speed', 10, 0], ['reserve', 31, 0]
    ])];
  }
  if (recipe.kind === 'fade' || recipe.kind === 'cycle') {
    const effectType = recipe.kind === 'fade' ? PIXEL_EFFECT.COLOR_FADE : PIXEL_EFFECT.COLOR_CYCLE;
    const fields = [
      ['effect type', 8, effectType], ['state', 2, PIXEL_EFFECT_STATE.STOP], ['package type', 2, 0],
      ['color count', 4, clampInteger(colors.length || 2, 1, 15, 'Color count')],
      ['direction', 4, direction], ['speed', 10, speed]
    ];
    if (recipe.kind === 'cycle') fields.push(['change style', 2, clampInteger(recipe.changeStyle ?? 0, 0, 3, 'Color change style')], ['reserve', 32, 0]);
    else fields.push(['reserve', 34, 0]);
    return [telinkPacked(TELINK_PIXEL_EFFECT, fields)];
  }
  if (recipe.kind === 'chase') {
    const effectType = pixelEffectType(colors.length || 1);
    return [telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, effectType], ['state', 2, PIXEL_EFFECT_STATE.STOP], ['package type', 2, 0],
      ['group', 2, clampInteger(recipe.group ?? 0, 0, 3, 'Chase group')],
      ['direction', 2, direction], ['pixel length', 3, clampInteger(recipe.pixelLength ?? 0, 0, 7, 'Pixel length')],
      ['speed', 10, speed], ['reserve', 35, 0]
    ])];
  }
  if (recipe.kind === 'fire') {
    const baseColor = normalizePixelColor(recipe.baseColor || { hue: 20, saturation: 20, cct: 86 }, intensity);
    const sparkColor = normalizePixelColor(recipe.sparkColor || { hue: 30, saturation: 30, cct: 86 }, intensity);
    const minimum = Number(recipe.minimum ?? intensity);
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('Minimum fire brightness must be from 0 to 100%.');
    if (minimum > sparkColor.intensity) throw new Error('Minimum fire brightness cannot exceed the flame brightness.');
    const range = telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, PIXEL_EFFECT_STATE.RUN_LOOP], ['package type', 2, 1],
      ['maximum brightness', 10, pixelBrightness(sparkColor.intensity)], ['minimum brightness', 10, pixelBrightness(minimum)],
      ['light mode', 2, PIXEL_LIGHT_MODE.HSI], ['hue', 9, sparkColor.hue], ['saturation', 7, sparkColor.saturation],
      ['CCT reference', 9, sparkColor.cct], ['reserve', 5, 0]
    ]);
    const fixed = telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, PIXEL_EFFECT_STATE.RUN_LOOP], ['package type', 2, 2],
      ['brightness', 10, pixelBrightness(baseColor.intensity)], ['light mode', 2, PIXEL_LIGHT_MODE.HSI],
      ['hue', 9, baseColor.hue], ['saturation', 7, baseColor.saturation], ['CCT reference', 9, baseColor.cct],
      ['reserve', 15, 0]
    ]);
    const stop = telinkPacked(TELINK_PIXEL_EFFECT, [
      ['effect type', 8, PIXEL_EFFECT.PIXEL_FIRE], ['state', 2, PIXEL_EFFECT_STATE.STOP], ['package type', 2, 0],
      ['frequency', 10, speed], ['direction', 2, direction], ['reserve', 40, 0]
    ]);
    return [range, fixed, stop];
  }
  throw new Error(`Unsupported PB12 Pixel FX recipe: ${recipe.kind || 'unknown'}.`);
}

function zoneMask(indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0) throw new Error('Select at least one PB12 zone.');
  let mask = 0;
  for (const rawIndex of indexes) {
    const index = clampInteger(rawIndex, 0, 31, 'PB12 zone index');
    mask = (mask | (1 << (31 - index))) >>> 0;
  }
  return mask;
}

function telinkPartitionHsi({ zones, hue = 0, saturation = 100, intensity = 60, intensityUnits, preserveColor = false, fxEnabled = false } = {}) {
  // Captured Sidus Link traffic establishes a 32-bit MSB-first zone mask and
  // the following low-word layout: saturation:7, hue:9, intensity:10,
  // fxState:1, lightMode:1, reserve:4. The intensity field uses 0..1000 just
  // like normal HSI. hue=511/saturation=127 is Sidus's "preserve color"
  // sentinel, used for brightness-only updates and safe clearing.
  const h = preserveColor ? 0x1ff : clampInteger(hue, 0, 360, 'Zone hue');
  const s = preserveColor ? 0x7f : clampInteger(saturation, 0, 100, 'Zone saturation');
  const value = intensityUnits == null
    ? clampInteger(intensity, 0, 100, 'Zone brightness') * 10
    : clampInteger(intensityUnits, 0, 1000, 'Zone brightness units');
  return telinkPacked(TELINK_PARTITION_COLOR, [
    ['zone mask', 32, zoneMask(zones)], ['reserve', 4, 0],
    ['light mode', 1, 1], ['FX state', 1, fxEnabled ? 0 : 1], ['intensity', 10, value],
    ['hue', 9, h], ['saturation', 7, s]
  ]);
}

function telinkPartitionMode(zones) {
  const count = strictInteger(zones, 4, 32, 'Partition zone count');
  const code = PARTITION_MODE_CODES[count];
  if (code == null) throw new Error('PB12 partition mode must be 4, 8, 12, 16, 24, or 32 zones.');
  // Command 38. These six codes and the write/readback behavior were
  // physically validated on the PB12 with Sidus Link 2.0.42.
  return telinkPacked(0x26, [
    ['partition mode', 4, code], ['reserve', 60, 0]
  ]);
}

function partitionTimeRaw(seconds, label) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0.1 || value > 22) throw new Error(`${label} must be from 0.1 to 22 seconds.`);
  if (value < 1) return clampInteger(value * 10, 1, 9, label);
  return clampInteger(value + 9, 10, 31, label);
}

function telinkPartitionBreath({ minimum = 0, frequency = 0.1 } = {}) {
  // Command 36. Sidus names the 0.1..22 second field "frequency" even though
  // it behaves as the Breath period. The PB12-safe unified trigger uses the
  // inverted wire value zero.
  const minimumUnits = clampInteger(Number(minimum) * 10, 0, 127, 'Minimum Breath brightness');
  const frequencyRaw = partitionTimeRaw(frequency, 'Breath period');
  return telinkPacked(TELINK_PARTITION_EFFECT, [
    ['FX mode', 2, 2], ['lasting minimum', 7, 127], ['lasting maximum', 7, 127],
    ['interval minimum', 7, 0], ['interval maximum', 7, 0],
    ['frequency minimum', 5, frequencyRaw], ['frequency maximum', 5, frequencyRaw],
    ['trigger', 1, 0], ['minimum intensity', 7, minimumUnits], ['reserve', 16, 0]
  ]);
}

function telinkPartitionPulse({ kind = 'pulsing', frequency = 0.1, trigger = 'unified' } = {}) {
  const mode = { flash: 0, pulsing: 1 }[kind];
  if (mode == null) throw new Error('Partition effect must be Flash or Pulsing.');
  const frequencyRaw = partitionTimeRaw(frequency, `${kind} frequency`);
  const triggerBit = trigger === 'sequential' ? 1 : trigger === 'unified' ? 0 : null;
  if (triggerBit == null) throw new Error('Partition trigger must be unified or sequential.');
  // The PB12 ignores the command-35 selection mask for these two engines:
  // unified affects the whole bar together and sequential walks every logical
  // zone in the selected layout. Minimum intensity was physically validated at
  // zero for the full 0.1–20 Hz UI range.
  return telinkPacked(TELINK_PARTITION_EFFECT, [
    ['FX mode', 2, mode], ['lasting minimum', 7, 127], ['lasting maximum', 7, 127],
    ['interval minimum', 7, 0], ['interval maximum', 7, 0],
    ['frequency minimum', 5, frequencyRaw], ['frequency maximum', 5, frequencyRaw],
    ['trigger', 1, triggerBit], ['minimum intensity', 7, 0], ['reserve', 16, 0]
  ]);
}

function telinkPartitionCct({ zones, cct = 4300, duv = 100, intensity = 5, fxEnabled = false } = {}) {
  const temperature = clampInteger(Number(cct) / 100, 20, 100, 'Partition CCT');
  const correction = strictInteger(Number(duv), 0, 255, 'Partition DUV');
  const value = clampInteger(Number(intensity) * 10, 0, 1000, 'Partition brightness');
  // Physical readback established the wire order as FX-state then light-mode.
  // An explicit CCT/DUV stop is required: 255/255 preserve-color sentinels can
  // leave stale red zones visible after an effect is disarmed.
  return telinkPacked(TELINK_PARTITION_COLOR, [
    ['zone mask', 32, zoneMask(zones)], ['reserve', 4, 0],
    ['FX state', 1, fxEnabled ? 0 : 1], ['light mode', 1, 0], ['intensity', 10, value],
    ['CCT', 8, temperature], ['DUV', 8, correction]
  ]);
}

const SYSTEM_EFFECT_KINDS = Object.freeze({
  candle: { id: 4, family: 'ambient' },
  tv: { id: 3, family: 'ambient' },
  fire: { id: 5, family: 'ambient' },
  strobe: { id: 6, family: 'strobe' },
  lightning: { id: 2, family: 'lightning' },
  paparazzi: { id: 1, family: 'paparazzi' },
  'faulty-bulb': { id: 8, family: 'faulty-bulb' }
});

function telinkSystemEffect({ kind, frequency = 1, colorType = 0 } = {}) {
  const definition = SYSTEM_EFFECT_KINDS[kind];
  if (!definition) throw new Error('Choose a captured PB12 System effect.');
  const rate = strictInteger(Number(frequency), 1, 10, 'System effect frequency');
  const color = strictInteger(Number(colorType), 0, 2, 'System effect color type');
  let packet;
  if (definition.family === 'ambient') {
    if (kind === 'candle' && color !== 0) throw new Error('Candle was validated with its warm native palette.');
    packet = Buffer.from('00010000000000840c0487', 'hex');
    packet[5] = color;
    packet[7] = 0x80 | (rate << 2);
    packet[9] = definition.id;
  } else if (definition.family === 'strobe') {
    packet = Buffer.from('00010050e19a0c010687', 'hex');
    packet[7] = rate;
  } else if (definition.family === 'lightning') {
    if (rate !== 1) throw new Error('Lightning frequency is fixed to the physically validated setting.');
    packet = Buffer.from('0001002815ae850c0287', 'hex');
  } else if (definition.family === 'paparazzi') {
    packet = Buffer.from('0001000014ae850c0187', 'hex');
    packet[6] = 0x81 | (rate << 2);
  } else {
    packet = Buffer.from('00018052e19a0c010887', 'hex');
    packet[7] = rate;
  }
  return finalizeTelink(packet);
}

function telinkSystemEffectStop() {
  // Shared Sidus System-effect STOP, physically validated before a 500 ms
  // delay and explicit static CCT restoration.
  return telinkBytes('00000000000000000f87');
}

function telinkPulsing3({ enabled = true, cct = 4300, intensity = 5, rate = 20 } = {}) {
  const temperature = clampInteger(Number(cct) / 50, 40, 200, 'Pulsing III CCT');
  const brightness = clampInteger(Number(intensity) * 10, 0, 1000, 'Pulsing III brightness');
  const pulses = strictInteger(Number(rate), 20, 200, 'Pulsing III rate');
  // Command 34, effect 16. Neutral GM is deliberately fixed to zero because
  // that is the hardware-validated PB12 path.
  return telinkPacked(TELINK_PULSING_V3, [
    ['effect', 8, 16], ['state', 2, enabled ? 1 : 0], ['intensity', 10, brightness],
    ['frequency', 8, pulses], ['light mode', 3, 0], ['CCT', 9, temperature],
    ['green/magenta', 8, 0], ['reserve', 16, 0]
  ]);
}

function telinkZoneFrame(zones, preferredColors = []) {
  if (!Array.isArray(zones) || !Object.prototype.hasOwnProperty.call(PARTITION_MODE_CODES, zones.length)) {
    throw new Error('A PB12 zone frame must contain 4, 8, 12, 16, 24, or 32 colors.');
  }
  const colorKey = (color) => `${color.hue}:${color.saturation}:${color.intensity}`;
  const groups = new Map();
  zones.forEach((rawColor, index) => {
    const color = {
      hue: clampInteger(rawColor?.hue ?? 0, 0, 360, 'Zone hue'),
      saturation: clampInteger(rawColor?.saturation ?? 0, 0, 100, 'Zone saturation'),
      intensity: clampInteger(rawColor?.intensity ?? 0, 0, 100, 'Zone brightness')
    };
    const key = colorKey(color);
    if (!groups.has(key)) groups.set(key, { color, zones: [] });
    groups.get(key).zones.push(index);
  });
  const priority = new Map(preferredColors.map((rawColor, index) => [colorKey({
    hue: clampInteger(rawColor?.hue ?? 0, 0, 360, 'Zone hue'),
    saturation: clampInteger(rawColor?.saturation ?? 0, 0, 100, 'Zone saturation'),
    intensity: clampInteger(rawColor?.intensity ?? 0, 0, 100, 'Zone brightness')
  }), index]));
  const orderedGroups = [...groups.values()].sort((first, second) => {
    const firstPriority = priority.get(colorKey(first.color)) ?? Number.MAX_SAFE_INTEGER;
    const secondPriority = priority.get(colorKey(second.color)) ?? Number.MAX_SAFE_INTEGER;
    return firstPriority - secondPriority;
  });
  return orderedGroups.map(({ color, zones: indexes }) => telinkPartitionHsi({ zones: indexes, ...color }));
}

function telinkOnOff(on) {
  const packet = Buffer.alloc(10);
  packet[8] = on ? 1 : 0;
  packet[9] = 0x8c;
  return finalizeTelink(packet);
}

function telinkCct(kelvin, intensity, greenMagenta = 0) {
  const value = Math.max(0, Math.min(1000, Math.round(intensity)));
  const temperature = Math.max(80, Math.min(2000, Math.trunc((kelvin + 5) / 10)));
  let low = BigInt(value & 3) << 62n;
  let high = 0x8200 | ((value >> 2) & 0xff);
  if (temperature < 1001) {
    low |= BigInt(temperature) << 52n;
    high |= (temperature >> 12) & 0xff;
  } else {
    low |= BigInt((temperature + 0x18) & 0x3ff) << 52n;
    low |= 0x0000040000000000n;
  }
  const correction = strictInteger(greenMagenta, -100, 100, 'Green/magenta correction');
  if (correction % 10 !== 0) throw new Error('Green/magenta correction must use 10% steps.');
  // Sidus stores neutral as 100 and its encoder writes that field in tenths:
  // -10% => 9, neutral => 10, +10% => 11.
  low |= BigInt((100 + correction) / 10) << 45n;
  const packet = Buffer.alloc(10);
  for (let index = 0; index < 8; index += 1) packet[index] = Number((low >> BigInt(index * 8)) & 0xffn);
  packet[8] = high & 0xff;
  packet[9] = high >> 8;
  return finalizeTelink(packet);
}

function telinkHsi(hue, saturation, intensity) {
  const value = Math.max(0, Math.min(1000, Math.round(intensity)));
  const h = Math.max(0, Math.min(360, Math.round(hue))) & 0x1ff;
  const s = Math.max(0, Math.min(100, Math.round(saturation))) & 0x7f;
  const packet = Buffer.alloc(10);
  packet[5] = (s & 3) << 6;
  packet[6] = ((h & 7) << 5) | ((s >> 2) & 0x1f);
  packet[7] = ((h >> 3) & 0x3f) | ((value & 3) << 6);
  packet[8] = (value >> 2) & 0xff;
  packet[9] = 0x81;
  return finalizeTelink(packet);
}

// These four full-bar commands were recovered from Sidus Link 2.0.42 and
// physically validated on a PB12. They differ from the older amaran Desktop
// HSI/CCT packets by carrying the Sidus operation bit in payload bit 0.
function telinkGlobalHsi(hue, saturation, intensity) {
  const h = strictInteger(hue, 0, 360, 'Global hue');
  const s = strictInteger(saturation, 0, 100, 'Global saturation');
  const value = strictInteger(intensity, 0, 1000, 'Global intensity');
  return telinkPacked(0x01, [
    ['intensity', 10, value], ['hue', 9, h], ['saturation', 7, s],
    ['reserve', 37, 0], ['operation', 1, 1]
  ]);
}

function telinkGlobalCct(kelvin, intensity, greenMagenta = 0) {
  const temperature = strictInteger(kelvin, 2000, 10000, 'Global color temperature');
  const value = strictInteger(intensity, 0, 1000, 'Global intensity');
  const packet = telinkCct(temperature, value, greenMagenta);
  packet[1] |= 0x01;
  return finalizeTelink(packet);
}

function telinkGel({ cct, origin, type, color, intensity } = {}) {
  const temperature = strictInteger(cct, 2000, 10000, 'Gel base color temperature');
  const value = strictInteger(intensity, 0, 1000, 'Gel intensity');
  return telinkPacked(0x03, [
    ['intensity', 10, value], ['CCT', 10, Math.round(temperature / 10)],
    ['origin', 1, strictInteger(origin, 0, 1, 'Gel origin')],
    ['type', 4, strictInteger(type, 0, 15, 'Gel type')],
    ['color', 10, strictInteger(color, 0, 1023, 'Gel color identity')],
    ['reserve', 28, 0], ['operation', 1, 1]
  ]);
}

function telinkGlobalRgbw({ red, green, blue, warmWhite, coolWhite, intensity } = {}) {
  const channels = [
    ['red', strictInteger(red, 0, 1000, 'Red channel')],
    ['green', strictInteger(green, 0, 1000, 'Green channel')],
    ['blue', strictInteger(blue, 0, 1000, 'Blue channel')],
    ['warm white', strictInteger(warmWhite, 0, 1000, 'Warm-white channel')],
    ['cool white', strictInteger(coolWhite, 0, 1000, 'Cool-white channel')]
  ];
  const value = strictInteger(intensity, 0, 1000, 'Global intensity');
  return telinkPacked(0x04, [
    ...channels.map(([label, channel]) => [label, 10, channel]),
    ['intensity', 10, value], ['reserve', 3, 0], ['operation', 1, 1]
  ]);
}

function telinkGlobalXy({ x, y, intensity } = {}) {
  const normalizedX = Number(x);
  const normalizedY = Number(y);
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)
    || normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1
    || normalizedX + normalizedY > 1.0001) {
    throw new Error('xy coordinates must be from 0 to 1 and x + y must not exceed 1.');
  }
  const coordinateX = Math.round(normalizedX * 10000);
  const coordinateY = Math.round(normalizedY * 10000);
  const value = strictInteger(intensity, 0, 1000, 'Global intensity');
  return telinkPacked(0x05, [
    ['intensity', 10, value], ['x coordinate', 14, coordinateX], ['y coordinate', 14, coordinateY],
    ['reserve', 25, 0], ['operation', 1, 1]
  ]);
}

function parseIvIndex(data) {
  if (!Buffer.isBuffer(data) || data.length < 15 || (data[0] & 0x3f) !== 0x01 || data[1] !== 0x01) return null;
  return data.readUInt32BE(11);
}

class MeshSession {
  constructor({ netKey, appKey, deviceKey, fixtures = [], sequence, ivIndex } = {}) {
    if (!/^[0-9a-f]{32}$/i.test(netKey || '') || !/^[0-9a-f]{32}$/i.test(appKey || '')) throw new Error('Invalid direct Bluetooth mesh credentials.');
    const network = k2(Buffer.from(netKey, 'hex'));
    this.keys = { ...network, appKey: Buffer.from(appKey, 'hex'), aid: k4(Buffer.from(appKey, 'hex')) };
    if (/^[0-9a-f]{32}$/i.test(deviceKey || '')) this.keys.deviceKey = Buffer.from(deviceKey, 'hex');
    this.fixtures = fixtures;
    this.ivIndex = Number.isInteger(ivIndex) ? ivIndex >>> 0 : 0;
    this.beaconReceived = false;
    this.sequence = Number.isInteger(sequence) ? sequence : 12000000 + crypto.randomInt(4000000);
  }

  nextSequence() {
    if (this.sequence >= MESH_SEQUENCE_SAFE_LIMIT - 1) {
      throw new Error('GrowBar stopped before the Bluetooth Mesh sequence could wrap. Re-pair the PB12 in amaran and re-import its database to establish fresh mesh state.');
    }
    this.sequence += 1;
    return this.sequence;
  }

  sequenceHeadroom(reserve = 0) {
    const reserved = Math.max(0, Math.trunc(Number(reserve) || 0));
    return Math.max(0, MESH_SEQUENCE_SAFE_LIMIT - 1 - this.sequence - reserved);
  }

  receive(data) {
    const ivIndex = parseIvIndex(Buffer.from(data));
    if (ivIndex !== null) { this.ivIndex = ivIndex; this.beaconReceived = true; }
    return { ivIndex, proxyConfigStatus: (data[0] & 0x3f) === 0x02 };
  }

  setFilterPdu() {
    return buildProxyConfigPdu(this.keys, this.nextSequence(), 0x00, Buffer.from([0x00]), this.ivIndex);
  }

  addAddressesPdu() {
    const addresses = [...new Set([LOCAL_ADDRESS, 0xffff, GROUP_ALL, ...this.fixtures.map((fixture) => fixture.address)])];
    const payload = Buffer.alloc(addresses.length * 2);
    addresses.forEach((address, index) => payload.writeUInt16BE(address & 0xffff, index * 2));
    return buildProxyConfigPdu(this.keys, this.nextSequence(), 0x01, payload, this.ivIndex);
  }

  commandPdus(destination, parameters, retries = 3) {
    const packets = [];
    for (let retry = 0; retry < retries; retry += 1) {
      const firstSequence = this.nextSequence();
      const networkPdus = buildAccessPdus(this.keys, firstSequence, destination, TELINK_OPCODE, parameters, this.ivIndex);
      for (let index = 1; index < networkPdus.length; index += 1) this.nextSequence();
      packets.push(...networkPdus.map((pdu) => Buffer.concat([Buffer.from([0x00]), pdu])));
    }
    return packets;
  }

  deviceAccessPdus(destination, access) {
    if (!this.keys.deviceKey) throw new Error('The provisioned PB12 DeviceKey is missing.');
    const firstSequence = this.nextSequence();
    const packets = buildDeviceAccessPdus(this.keys, firstSequence, destination, access, this.ivIndex);
    for (let index = 1; index < packets.length; index += 1) this.nextSequence();
    return packets;
  }

  configurePdus(destination) {
    const indexes = Buffer.from([0x00, 0x00, 0x00]);
    const appKeyAdd = Buffer.concat([Buffer.from([0x00]), indexes, this.keys.appKey]);
    // Aputure/amaran fixtures expose their Telink runtime model as the first
    // vendor model: Bluetooth company identifier 0x0211, model 0x0000.
    const modelBind = Buffer.from([0x80, 0x3d, destination & 0xff, destination >> 8,
      0x00, 0x00, 0x11, 0x02, 0x00, 0x00]);
    return { appKeyAdd: this.deviceAccessPdus(destination, appKeyAdd), modelBind: this.deviceAccessPdus(destination, modelBind) };
  }

  onOffPdus(destination, on) { return this.commandPdus(destination, telinkOnOff(on)); }
  cctPdus(destination, kelvin, intensity) { return this.commandPdus(destination, telinkCct(kelvin, intensity)); }
  hsiPdus(destination, hue, saturation, intensity) { return this.commandPdus(destination, telinkHsi(hue, saturation, intensity)); }
  globalCctPdus(destination, kelvin, intensity, greenMagenta = 0) { return this.commandPdus(destination, telinkGlobalCct(kelvin, intensity, greenMagenta)); }
  globalHsiPdus(destination, hue, saturation, intensity) { return this.commandPdus(destination, telinkGlobalHsi(hue, saturation, intensity)); }
  globalRgbwPdus(destination, channels) { return this.commandPdus(destination, telinkGlobalRgbw(channels)); }
  globalXyPdus(destination, color) { return this.commandPdus(destination, telinkGlobalXy(color)); }
  gelPdus(destination, gel) { return this.commandPdus(destination, telinkGel(gel)); }
  partitionModePdus(destination, zones) { return this.commandPdus(destination, telinkPartitionMode(zones), 1); }
  partitionBreathPdus(destination, settings) { return this.commandPdus(destination, telinkPartitionBreath(settings), 1); }
  partitionPulsePdus(destination, settings) { return this.commandPdus(destination, telinkPartitionPulse(settings), 1); }
  partitionMaskPdus(destination, settings) { return this.commandPdus(destination, telinkPartitionHsi(settings), 1); }
  partitionCctPdus(destination, settings) { return this.commandPdus(destination, telinkPartitionCct(settings), 1); }
  pulsing3Pdus(destination, settings) { return this.commandPdus(destination, telinkPulsing3(settings), 1); }
  systemEffectPdus(destination, settings) { return this.commandPdus(destination, telinkSystemEffect(settings), 1); }
  systemEffectStopPdus(destination) { return this.commandPdus(destination, telinkSystemEffectStop(), 1); }
  pixelFxPdus(destination, recipe) {
    // Pixel FX packets form one stateful recipe. Send each logical command
    // once, as amaran's CommandRunner does. Reissuing every palette/base
    // packet with new Mesh sequence numbers restarts or overwrites the PB12's
    // onboard state machine and can leave it on a single palette color.
    return telinkPixelFx(recipe).flatMap((parameters) => this.commandPdus(destination, parameters, 1));
  }
  pixelFxStopPdus(destination, recipe) {
    return telinkPixelFxStop(recipe).flatMap((parameters) => this.commandPdus(destination, parameters, 1));
  }
  zoneFramePdus(destination, zones, preferredColors = []) {
    // A frame is stateful and each grouped mask is an accumulating write.
    // Sending duplicates would waste Mesh bandwidth and create uneven motion.
    return telinkZoneFrame(zones, preferredColors).flatMap((parameters) => this.commandPdus(destination, parameters, 1));
  }
  zoneFrameCommandCount(zones) { return telinkZoneFrame(zones).length; }
}

module.exports = {
  MeshSession, MESH_SEQUENCE_SAFE_LIMIT, PIXEL_EFFECT, PIXEL_EFFECT_STATE, aesCcmDecrypt, aesCcmEncrypt, aesCmac,
  buildAccessPdus, buildDeviceAccessPdus,
  decodeProxyAccessPdu, k2, k4, parseIvIndex,
  telinkCct, telinkGel, telinkGlobalCct, telinkGlobalHsi, telinkGlobalRgbw, telinkGlobalXy, telinkHsi, telinkOnOff,
  PARTITION_MODE_CODES, SYSTEM_EFFECT_KINDS, telinkPacked, telinkPartitionBreath, telinkPartitionCct,
  telinkPartitionHsi, telinkPartitionMode, telinkPartitionPulse, telinkPixelFx, telinkPixelFxStop,
  telinkPulsing3, telinkSystemEffect, telinkSystemEffectStop, telinkZoneFrame, zoneMask
};
