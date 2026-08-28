'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  MeshSession, MESH_SEQUENCE_SAFE_LIMIT, PIXEL_EFFECT, PIXEL_EFFECT_STATE, aesCcmEncrypt, buildAccessPdus, k2, telinkCct,
  telinkGel, telinkGlobalCct, telinkGlobalHsi, telinkGlobalRgbw, telinkGlobalXy, telinkHsi, telinkOnOff,
  telinkPacked, telinkPartitionBreath, telinkPartitionCct, telinkPartitionHsi, telinkPartitionMode,
  telinkPartitionPulse, telinkPixelFx, telinkPixelFxStop, telinkPulsing3, telinkSystemEffect,
  telinkSystemEffectStop, telinkZoneFrame, zoneMask
} = require('../src/direct-protocol');
const { ANIMATION_PRESETS } = require('../src/defaults');
const { zoneAnimationFrame } = require('../src/zone-effects');

test('encrypts Bluetooth Mesh CCM without Electron\'s unavailable aes-128-ccm cipher', () => {
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const nonce = Buffer.from('000102030405060708090a0b0c', 'hex');
  const plaintext = Buffer.from('112233445566778899aabbccddeeff00a1a2a3', 'hex');
  assert.equal(aesCcmEncrypt(key, nonce, plaintext, 4).toString('hex'), '6355942b99d764fe21ef5c6f86c8964f976016a7b64715');

  const original = crypto.createCipheriv;
  crypto.createCipheriv = (algorithm, ...args) => {
    if (algorithm === 'aes-128-ccm') throw new Error('Unknown cipher');
    return original.call(crypto, algorithm, ...args);
  };
  try {
    const session = new MeshSession({
      netKey: '7dd7364cd842ad18c17c2b820c84c3d6',
      appKey: '63964771734fbd76e3b40519d1d94a48',
      fixtures: [{ address: 2 }],
      sequence: 1,
      ivIndex: 0x12345678
    });
    assert.ok(session.setFilterPdu().length > 10);
    assert.ok(session.onOffPdus(2, true)[0].length > 10);
  } finally {
    crypto.createCipheriv = original;
  }
});

test('derives the published Bluetooth Mesh network identity vector', () => {
  const derived = k2(Buffer.from('0D8094267D3F4EA5B06B324C8C0AD926', 'hex'));
  assert.equal(derived.nid, 0x3b);
  assert.equal(derived.encryptionKey.toString('hex'), 'ce1a0749c640a23be0bdf1c7c95fce93');
  assert.equal(derived.privacyKey.toString('hex'), '96b5a15d3b3d3fa366251132ba16491c');
});

test('builds valid Telink power, CCT, and HSI command packets', () => {
  assert.equal(telinkOnOff(true).toString('hex'), '8d00000000000000018c');
  assert.equal(telinkOnOff(false).toString('hex'), '8c00000000000000008c');
  for (const packet of [telinkCct(5600, 1000), telinkHsi(240, 100, 750)]) {
    assert.equal(packet.length, 10);
    assert.equal(packet[0], [...packet.subarray(1)].reduce((sum, value) => sum + value, 0) & 0xff);
  }
  assert.equal(telinkCct(5600, 1000)[9], 0x82);
  assert.equal(telinkHsi(240, 100, 750)[9], 0x81);
});

test('generic 64-bit Telink packer reproduces the established HSI layout', () => {
  const packed = telinkPacked(0x01, [
    ['intensity', 10, 750], ['hue', 9, 240], ['saturation', 7, 100], ['reserve', 38, 0]
  ]);
  assert.deepEqual(packed, telinkHsi(240, 100, 750));
});

test('reproduces the corrected physically verified Sidus global color packets', () => {
  assert.equal(telinkGlobalHsi(120, 100, 50).toString('hex'), '360100000000198f0c81');
  assert.equal(telinkGlobalCct(4300, 50).toString('hex'), '4a0100000040e19a0c82');
  assert.equal(telinkGlobalCct(4300, 50, 10).toString('hex'), '6a0100000060e19a0c82');
  assert.equal(telinkGel({ cct: 4300, origin: 0, type: 0, color: 4, intensity: 50 }).toString('hex'), '8a0100008000e09a0c83');
  assert.equal(telinkGel({ cct: 4300, origin: 1, type: 0, color: 4, intensity: 50 }).toString('hex'), '920100008000e89a0c83');
  assert.equal(telinkGlobalRgbw({
    red: 1000, green: 0, blue: 0, warmWhite: 0, coolWhite: 0, intensity: 50
  }).toString('hex'), 'a221030000000000fa84');
  assert.equal(telinkGlobalXy({ x: 0.1442, y: 0.0566, intensity: 50 }).toString('hex'), '99010000d808a2850c85');
});

test('reproduces every physically verified partition layout and onboard effect packet', () => {
  const layouts = new Map([
    [4, 'a60000000000000000a6'], [8, 'c60000000000000020a6'],
    [12, 'd60000000000000030a6'], [16, 'e60000000000000040a6'],
    [24, 'f60000000000000050a6'], [32, 'b60000000000000010a6']
  ]);
  for (const [zones, expected] of layouts) assert.equal(telinkPartitionMode(zones).toString('hex'), expected);
  assert.equal(telinkPartitionBreath({ minimum: 2.5, frequency: 0.1 }).toString('hex'), '9c000019210000ffbfa4');
  assert.equal(telinkPulsing3({ enabled: true, cct: 4300, intensity: 5, rate: 20 }).toString('hex'), 'ac0000005640214310a2');
  assert.equal(telinkPulsing3({ enabled: false, cct: 4300, intensity: 5, rate: 20 }).toString('hex'), '6c0000005640210310a2');
});

test('reproduces the physically validated Partition Pulsing, Flash and explicit CCT recovery vectors', () => {
  const all32 = Array.from({ length: 32 }, (_, index) => index);
  assert.equal(telinkPartitionPulse({ kind: 'pulsing', frequency: 0.1, trigger: 'unified' }).toString('hex'), '43000000210000ff7fa4');
  assert.equal(telinkPartitionPulse({ kind: 'pulsing', frequency: 0.1, trigger: 'sequential' }).toString('hex'), 'c3000080210000ff7fa4');
  assert.equal(telinkPartitionPulse({ kind: 'pulsing', frequency: 20, trigger: 'unified' }).toString('hex'), 'e2000000bd0300ff7fa4');
  assert.equal(telinkPartitionPulse({ kind: 'flash', frequency: 0.1, trigger: 'unified' }).toString('hex'), '03000000210000ff3fa4');
  assert.equal(telinkPartitionPulse({ kind: 'flash', frequency: 0.1, trigger: 'sequential' }).toString('hex'), '83000080210000ff3fa4');
  assert.equal(telinkPartitionPulse({ kind: 'flash', frequency: 20, trigger: 'unified' }).toString('hex'), 'a2000000bd0300ff3fa4');
  assert.equal(telinkPartitionCct({ zones: all32, cct: 4300, duv: 100, intensity: 5, fxEnabled: false }).toString('hex'), '68642b3208ffffffffa3');
});

test('reproduces all physically validated PB12 System effect vectors and shared stop', () => {
  const vectors = [
    [{ kind: 'candle', frequency: 1, colorType: 0 }, '1c010000000000840c0487'],
    [{ kind: 'candle', frequency: 10, colorType: 0 }, '40010000000000a80c0487'],
    [{ kind: 'tv', frequency: 1, colorType: 0 }, '1b010000000000840c0387'],
    [{ kind: 'tv', frequency: 1, colorType: 2 }, '1d010000000200840c0387'],
    [{ kind: 'tv', frequency: 10, colorType: 2 }, '41010000000200a80c0387'],
    [{ kind: 'fire', frequency: 1, colorType: 0 }, '1d010000000000840c0587'],
    [{ kind: 'fire', frequency: 10, colorType: 2 }, '43010000000200a80c0587'],
    [{ kind: 'strobe', frequency: 1, colorType: 0 }, '66010050e19a0c010687'],
    [{ kind: 'strobe', frequency: 10, colorType: 0 }, '6f010050e19a0c0a0687'],
    [{ kind: 'lightning', frequency: 1, colorType: 0 }, '0601002815ae850c0287'],
    [{ kind: 'paparazzi', frequency: 1, colorType: 0 }, 'dc01000014ae850c0187'],
    [{ kind: 'paparazzi', frequency: 10, colorType: 0 }, '0001000014aea90c0187'],
    [{ kind: 'faulty-bulb', frequency: 1, colorType: 0 }, 'ea018052e19a0c010887'],
    [{ kind: 'faulty-bulb', frequency: 10, colorType: 0 }, 'f3018052e19a0c0a0887']
  ];
  for (const [input, expected] of vectors) assert.equal(telinkSystemEffect(input).toString('hex'), expected);
  assert.equal(telinkSystemEffectStop().toString('hex'), '96000000000000000f87');
});

test('segments the 11-byte Candle, TV and Fire payloads at the Bluetooth Mesh lower transport', () => {
  const session = new MeshSession({
    netKey: '0D8094267D3F4EA5B06B324C8C0AD926',
    appKey: 'AB1C91DC421149FF87694B05A236F214',
    fixtures: [{ address: 2 }], sequence: 12000000, ivIndex: 0
  });
  const before = session.sequence;
  const packets = session.systemEffectPdus(2, { kind: 'candle', frequency: 1, colorType: 0 });
  assert.equal(packets.length, 2);
  assert.equal(session.sequence, before + 2);
  assert.ok(packets.every((packet) => packet[0] === 0));
  assert.equal(typeof buildAccessPdus, 'function');
});

test('rejects the historical invalid global color scaling instead of silently clamping it', () => {
  assert.throws(() => telinkGlobalHsi(1200, 1000, 50), /Global hue/);
  assert.throws(() => telinkGlobalCct(43000, 50), /color temperature/);
  assert.throws(() => telinkGlobalRgbw({ red: 1001, green: 0, blue: 0, warmWhite: 0, coolWhite: 0, intensity: 50 }), /Red channel/);
  assert.throws(() => telinkGlobalXy({ x: 0.8, y: 0.4, intensity: 50 }), /x \+ y/);
});

test('builds checksum-valid onboard PB12 Pixel FX packets for every recipe family', () => {
  const recipes = [
    { kind: 'chase', speed: 145, direction: 2, group: 2, pixelLength: 1, colors: [{ hue: 0 }, { hue: 0, saturation: 0 }, { hue: 240 }] },
    { kind: 'fade', speed: 72, colors: [{ hue: 155 }, { hue: 220 }, { hue: 305 }] },
    { kind: 'cycle', speed: 170, changeStyle: 1, colors: [{ hue: 0 }, { hue: 120 }, { hue: 240 }] },
    { kind: 'rainbow', intensity: 62, speed: 105 },
    { kind: 'fire', intensity: 60, minimum: 10, speed: 135, baseColor: { hue: 8 }, sparkColor: { hue: 42 } }
  ];
  const packetSets = recipes.map(telinkPixelFx);
  assert.deepEqual(packetSets.map((packets) => packets.length), [5, 4, 4, 1, 3]);
  for (const packets of packetSets) {
    for (const packet of packets) {
      assert.equal(packet.length, 10);
      assert.equal(packet[9], 0xa1);
      assert.equal(packet[0], [...packet.subarray(1)].reduce((sum, value) => sum + value, 0) & 0xff);
    }
  }
  assert.equal(packetSets[0][0][8], PIXEL_EFFECT.THREE_COLOR_CHASE);
  assert.equal(packetSets[1][0][8], PIXEL_EFFECT.COLOR_FADE);
  assert.equal(packetSets[2][0][8], PIXEL_EFFECT.COLOR_CYCLE);
  assert.equal(packetSets[3][0][8], PIXEL_EFFECT.RAINBOW);
  assert.equal(packetSets[4][0][8], PIXEL_EFFECT.PIXEL_FIRE);
  assert.equal(PIXEL_EFFECT_STATE.STOP, 0);
  assert.equal(PIXEL_EFFECT_STATE.RUN_LOOP, 3);
  for (const packets of packetSets) {
    packets.slice(0, -1).forEach((packet) => assert.equal((packet[7] >> 6) & 0x03, PIXEL_EFFECT_STATE.RUN_LOOP));
    assert.equal((packets.at(-1)[7] >> 6) & 0x03, PIXEL_EFFECT_STATE.RUN_ONCE);
  }
  const packageTypes = (packets) => packets.map((packet) => (packet[7] >> 4) & 0x03);
  assert.deepEqual(packageTypes(packetSets[0]), [1, 1, 1, 1, 0]);
  assert.deepEqual(packageTypes(packetSets[1]), [1, 1, 1, 0]);
  assert.deepEqual(packageTypes(packetSets[2]), [1, 1, 1, 0]);
  assert.deepEqual(packageTypes(packetSets[4]), [1, 2, 0]);
});

test('encodes every shipped Light Animation with a validated PB12 engine', () => {
  assert.equal(ANIMATION_PRESETS.length, 24);
  for (const preset of ANIMATION_PRESETS) {
    let packets;
    let commandType;
    if (preset.event.mode === 'pixelfx') {
      packets = telinkPixelFx(preset.event.recipe);
      commandType = 0xa1;
    } else if (preset.event.mode === 'zonefx') {
      packets = telinkZoneFrame(zoneAnimationFrame(preset.event.recipe, 0).zones);
      commandType = 0xa3;
    } else if (preset.event.mode === 'pulsing3') {
      packets = [telinkPulsing3({ ...preset.event, enabled: true })];
      commandType = 0xa2;
    } else if (preset.event.mode === 'system-effect') {
      packets = [telinkSystemEffect(preset.event)];
      commandType = 0x87;
    } else {
      assert.fail(`${preset.name} uses an untested animation engine`);
    }
    assert.ok(packets.length >= 1, `${preset.name} produced no packets`);
    for (const packet of packets) {
      const expectedLength = preset.event.mode === 'system-effect' ? 11 : 10;
      assert.equal(packet.length, expectedLength, `${preset.name} produced a malformed packet`);
      assert.equal(packet.at(-1), commandType, `${preset.name} used the wrong Telink command type`);
      assert.equal(packet[0], [...packet.subarray(1)].reduce((sum, value) => sum + value, 0) & 0xff, `${preset.name} checksum failed`);
    }
  }
});

test('audits every authored 32-section scene for tempo, determinism, and Mesh write cost', () => {
  const zonePresets = ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'zonefx');
  for (const preset of zonePresets) {
    let maximumWrites = 0;
    for (let index = 0; index < 64; index += 1) {
      const first = zoneAnimationFrame(preset.event.recipe, index);
      const second = zoneAnimationFrame(preset.event.recipe, index);
      assert.deepEqual(first, second, `${preset.name} frame ${index} is not restart-deterministic`);
      assert.equal(first.zones.length, 32, `${preset.name} lost physical PB12 sections`);
      assert.ok(first.durationMs >= 300, `${preset.name} is paced too quickly for a four-hour ambience preset`);
      assert.ok(first.zones.some((color) => color.intensity > 0), `${preset.name} generated an all-black frame`);
      maximumWrites = Math.max(maximumWrites, telinkZoneFrame(first.zones).length);
    }
    const ceiling = preset.id === 'prism-continuum' ? 32 : 10;
    assert.ok(maximumWrites <= ceiling, `${preset.name} needs ${maximumWrites} writes per frame (limit ${ceiling})`);
  }
  assert.equal(
    ANIMATION_PRESETS.some((preset) => preset.event.mode === 'system-effect'),
    false,
    'the friendly gallery must not depend on System FX that proved unreliable over the direct transport'
  );
});

test('rebuilds the six hardware-reported weak scenes as distinct reliable 32-section animations', () => {
  const ids = [
    'aurora-river', 'neon-procession', 'prism-parade', 'moonlit-sakura',
    'hearthside-whisper', 'analog-dream', 'cinder-cathedral'
  ];
  for (const id of ids) {
    const preset = ANIMATION_PRESETS.find((candidate) => candidate.id === id);
    assert.equal(preset.event.mode, 'zonefx', `${preset.name} must use the proven partition transport`);
    const frames = Array.from({ length: 32 }, (_, index) => zoneAnimationFrame(preset.event.recipe, index));
    assert.ok(frames.some((frame, index) => index > 0 && JSON.stringify(frame.zones) !== JSON.stringify(frames[0].zones)), `${preset.name} must visibly move`);
    for (const frame of frames) {
      assert.equal(frame.zones.length, 32);
      assert.ok(frame.zones.some((color) => color.intensity >= 6), `${preset.name} must never become an all-dark frame`);
      assert.ok(telinkZoneFrame(frame.zones).length <= 7, `${preset.name} must remain within seven grouped Mesh writes`);
    }
  }

  const sakura = ANIMATION_PRESETS.find((preset) => preset.id === 'moonlit-sakura');
  const sakuraColors = zoneAnimationFrame(sakura.event.recipe, 0).zones;
  assert.ok(sakuraColors.some((color) => color.hue === 245 && color.saturation >= 90), 'Moonlit Sakura needs an indigo night field');
  assert.ok(sakuraColors.some((color) => color.saturation === 0), 'Moonlit Sakura needs a neutral pearl petal');
  assert.equal(
    sakuraColors.some((color) => color.saturation > 20 && color.hue > 0 && color.hue < 60),
    false,
    'Moonlit Sakura must not contain saturated red/orange hues'
  );

  const hearth = ANIMATION_PRESETS.find((preset) => preset.id === 'hearthside-whisper');
  assert.deepEqual(zoneAnimationFrame(hearth.event.recipe, 0), zoneAnimationFrame(hearth.event.recipe, 1), 'Hearthside shimmer must hold instead of flashing');
  assert.notDeepEqual(zoneAnimationFrame(hearth.event.recipe, 1), zoneAnimationFrame(hearth.event.recipe, 2), 'Hearthside shimmer must evolve');

  const cinder = ANIMATION_PRESETS.find((preset) => preset.id === 'cinder-cathedral');
  const cinderFrame = zoneAnimationFrame(cinder.event.recipe, 7).zones;
  assert.deepEqual(cinderFrame.slice(0, 16), cinderFrame.slice(16).reverse(), 'Cinder Cathedral must retain its mirrored arches');

  const neon = ANIMATION_PRESETS.find((preset) => preset.id === 'neon-procession');
  const neonFrame = zoneAnimationFrame(neon.event.recipe, 0).zones;
  for (const hue of [182, 102, 322]) assert.ok(neonFrame.some((color) => color.hue === hue && color.intensity >= 50), `Neon Procession must show ${hue}° simultaneously`);
});

test('builds Velvet Kaleidoscope as a mirrored five-color breathing pattern', () => {
  const preset = ANIMATION_PRESETS.find((candidate) => candidate.id === 'velvet-kaleidoscope');
  const frames = Array.from({ length: 20 }, (_, index) => zoneAnimationFrame(preset.event.recipe, index));
  for (const frame of frames) {
    assert.deepEqual(frame.zones.slice(0, 16), frame.zones.slice(16).reverse(), 'the folded pattern must remain bilaterally symmetric');
    assert.ok(telinkZoneFrame(frame.zones).length <= 5, 'the five-color scene must stay within five grouped mask writes');
  }
  assert.notDeepEqual(frames[0].zones, frames[5].zones, 'the stained-glass folds must move');
  assert.deepEqual(frames[0].zones, frames[18].zones, 'the breathing motion must return to its first fold without a seam');
});

test('builds Celestial Orchard as a deterministic low-flash constellation', () => {
  const preset = ANIMATION_PRESETS.find((candidate) => candidate.id === 'celestial-orchard');
  const recipe = { ...preset.event.recipe, seed: 0x12345678 };
  const first = zoneAnimationFrame(recipe, 0);
  const held = zoneAnimationFrame(recipe, 1);
  const later = zoneAnimationFrame(recipe, 21);
  assert.deepEqual(first, held, 'all stars must hold for multiple authored frames instead of one-frame flashing');
  assert.ok(telinkZoneFrame(first.zones).length <= 5, 'stars, halos, and background must fit in five grouped writes');
  assert.notDeepEqual(first.zones, later.zones, 'the constellation must evolve asynchronously');
  assert.deepEqual(zoneAnimationFrame(recipe, 21), later, 'the seeded constellation must be restart-safe');
  assert.notDeepEqual(zoneAnimationFrame({ ...recipe, seed: 0x87654321 }, 21), later, 'each activation seed must create a different sky');
});

test('builds Prism Continuum as 32 unique evenly distributed hues moving right to left', () => {
  const prism = ANIMATION_PRESETS.find((preset) => preset.id === 'prism-continuum');
  const first = zoneAnimationFrame(prism.event.recipe, 0);
  const second = zoneAnimationFrame(prism.event.recipe, 1);
  const hues = first.zones.map((color) => color.hue);

  assert.equal(first.zones.length, 32);
  assert.equal(new Set(hues).size, 32, 'every PB12 zone should have a distinct hue');
  assert.deepEqual(hues, Array.from({ length: 32 }, (_, index) => Math.round(index * 360 / 32)));
  assert.equal(Math.round(32 * 360 / 32) % 360, hues[0], 'the virtual zone 33 should wrap exactly to zone 1');
  assert.deepEqual(second.zones.slice(0, 31), first.zones.slice(1), 'the spectrum should travel from right to left');
  assert.deepEqual(second.zones[31], first.zones[0], 'the spectrum should wrap without a seam');
  assert.equal(telinkZoneFrame(first.zones).length, 32, '32 distinct hues require 32 independent color-mask writes');
});

test('reproduces physically verified PB12 32-zone Sidus captures byte for byte', () => {
  const all = Array.from({ length: 32 }, (_, index) => index);
  assert.equal(zoneMask([0]), 0x80000000);
  assert.equal(zoneMask([1]), 0x40000000);
  assert.equal(zoneMask([31]), 0x00000001);
  assert.equal(zoneMask(all), 0xffffffff);
  assert.equal(telinkPartitionHsi({ zones: all, hue: 0, saturation: 100, intensity: 18 }).toString('hex'), 'c36400b40cffffffffa3');
  assert.equal(telinkPartitionHsi({ zones: [0], preserveColor: true, intensityUnits: 199 }).toString('hex'), 'f4ffffc70c00000080a3');
  assert.equal(telinkPartitionHsi({ zones: [1], preserveColor: true, intensityUnits: 147 }).toString('hex'), '80ffff930c00000040a3');
  assert.equal(telinkPartitionHsi({ zones: [31], preserveColor: true, intensityUnits: 147 }).toString('hex'), '41ffff930c01000000a3');
});

test('groups a full multicolor zone frame into accumulating color masks', () => {
  const frame = Array.from({ length: 32 }, (_, index) => index % 2
    ? { hue: 240, saturation: 100, intensity: 50 }
    : { hue: 0, saturation: 100, intensity: 50 });
  const packets = telinkZoneFrame(frame);
  assert.equal(packets.length, 2);
  assert.deepEqual(packets.map((packet) => packet.subarray(5, 9).toString('hex')).sort(), ['55555555', 'aaaaaaaa']);
});

test('writes every Star-Spangled frame as distinct red, white and blue masks with red first', () => {
  const flag = ANIMATION_PRESETS.find((preset) => preset.id === 'star-spangled-flow');
  for (let index = 0; index < 16; index += 1) {
    const frame = zoneAnimationFrame(flag.event.recipe, index);
    const packets = telinkZoneFrame(frame.zones, flag.event.recipe.colors);
    assert.equal(packets.length, 3, `flag frame ${index} must contain exactly three color writes`);
    const expectedRedZones = frame.zones
      .map((color, zone) => color.hue === 0 && color.saturation === 100 ? zone : -1)
      .filter((zone) => zone >= 0);
    assert.ok(expectedRedZones.length >= 10, `flag frame ${index} lost its red stripes`);
    assert.deepEqual(
      packets[0],
      telinkPartitionHsi({ zones: expectedRedZones, ...flag.event.recipe.colors[0] }),
      `flag frame ${index} must commit red before white and blue`
    );
  }
});

test('builds Meteor Garden as three asynchronous travelers in five grouped writes', () => {
  const meteor = ANIMATION_PRESETS.find((preset) => preset.id === 'meteor-garden');
  const first = zoneAnimationFrame(meteor.event.recipe, 0);
  const second = zoneAnimationFrame(meteor.event.recipe, 1);
  assert.equal(first.durationMs, 360);
  assert.ok(telinkZoneFrame(first.zones).length <= 5);
  assert.ok(telinkZoneFrame(second.zones).length <= 5);
  assert.notDeepEqual(first.zones, second.zones);
});

test('reproduces the final physically validated Sidus Pixel FX vectors byte for byte', () => {
  const color = (hue) => ({ hue, saturation: 100, intensity: 2.5, cct: 0 });
  const chase = (count) => telinkPixelFx({
    kind: 'chase', intensity: 2.5, speed: 100, direction: 1, group: 0, pixelLength: 0,
    baseColor: color(0), colors: [120, 240, 60].slice(0, count).map(color)
  });
  const fade = telinkPixelFx({ kind: 'fade', intensity: 2.5, speed: 100, direction: 1, colors: [color(0), color(120)] });
  const cycle = telinkPixelFx({ kind: 'cycle', intensity: 2.5, speed: 100, direction: 1, changeStyle: 0, colors: [color(0), color(120)] });
  const fire = telinkPixelFx({
    kind: 'fire', intensity: 2.5, minimum: 2.5, speed: 10, direction: 0,
    sparkColor: { hue: 30, saturation: 30, intensity: 2.5, cct: 86 },
    baseColor: { hue: 20, saturation: 20, intensity: 2.5, cct: 86 }
  });
  assert.equal(fade.at(-1).toString('hex'), 'c40000000090118200a1');
  assert.equal(cycle.at(-1).toString('hex'), 'c50000000090118201a1');
  assert.equal(chase(1).at(-1).toString('hex'), '470000000020038102a1');
  assert.equal(chase(2).at(-1).toString('hex'), '480000000020038103a1');
  assert.equal(chase(3).at(-1).toString('hex'), '490000000020038104a1');
  assert.deepEqual(telinkPixelFx({ kind: 'rainbow', intensity: 5, speed: 100, direction: 1 }).map((packet) => packet.toString('hex')), ['7f0000000032228307a1']);
  assert.deepEqual(fire.map((packet) => packet.toString('hex')), [
    '47c08ac7431964d005a1', '3400002b140a65e005a1', '4e0000000000288005a1'
  ]);
  assert.deepEqual(telinkPixelFxStop({ kind: 'rainbow', intensity: 5, speed: 100, direction: 1 }).map((packet) => packet.toString('hex')), ['a80000000000000007a1']);
});

test('rejects malformed Pixel FX recipes before sending Bluetooth data', () => {
  assert.throws(() => telinkPixelFx({ kind: 'chase', colors: [] }), /one to three colors/);
  assert.throws(() => telinkPixelFx({ kind: 'fade', colors: [{ hue: 0 }] }), /two to fifteen colors/);
  assert.throws(() => telinkPixelFx({ kind: 'unknown' }), /Unsupported PB12 Pixel FX recipe/);
});

test('builds proxy filter and encrypted fixture commands with monotonic sequence numbers', () => {
  const session = new MeshSession({
    netKey: '0D8094267D3F4EA5B06B324C8C0AD926',
    appKey: 'AB1C91DC421149FF87694B05A236F214',
    fixtures: [{ address: 2 }],
    sequence: 12000000
  });
  const filter = session.setFilterPdu();
  const addresses = session.addAddressesPdu();
  const commands = session.hsiPdus(2, 120, 80, 650);
  assert.equal(filter[0] & 0x3f, 0x02);
  assert.equal(addresses[0] & 0x3f, 0x02);
  assert.equal(commands.length, 3);
  assert.ok(commands.every((packet) => packet[0] === 0 && packet.length === 30));
  assert.equal(session.sequence, 12000005);
});

test('stops before the 24-bit Mesh sequence can wrap or repeat', () => {
  const session = new MeshSession({
    netKey: '0D8094267D3F4EA5B06B324C8C0AD926',
    appKey: 'AB1C91DC421149FF87694B05A236F214',
    fixtures: [{ address: 2 }],
    sequence: MESH_SEQUENCE_SAFE_LIMIT - 2
  });
  assert.equal(session.sequenceHeadroom(), 1);
  assert.equal(session.nextSequence(), MESH_SEQUENCE_SAFE_LIMIT - 1);
  assert.equal(session.sequenceHeadroom(), 0);
  assert.throws(() => session.nextSequence(), /stopped before.*sequence could wrap/i);
  assert.equal(session.sequence, MESH_SEQUENCE_SAFE_LIMIT - 1);
});

test('builds segmented AppKey Add and vendor-model bind after fresh provisioning', () => {
  const session = new MeshSession({
    netKey: '0D8094267D3F4EA5B06B324C8C0AD926',
    appKey: 'AB1C91DC421149FF87694B05A236F214',
    deviceKey: '00112233445566778899AABBCCDDEEFF',
    fixtures: [{ address: 2 }],
    sequence: 100
  });
  const configuration = session.configurePdus(2);
  assert.equal(configuration.appKeyAdd.length, 2);
  assert.equal(configuration.modelBind.length, 1);
  assert.ok([...configuration.appKeyAdd, ...configuration.modelBind].every((packet) => packet[0] === 0x00));
  assert.equal(session.sequence, 103);
});
