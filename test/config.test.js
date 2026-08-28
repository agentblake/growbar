'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, migrateConfig, validateConfig } = require('../src/config');
const { createManualOverride } = require('../src/scheduler');
const {
  DEFAULT_CONFIG,
  LEGACY_DEFAULT_SCHEDULE,
  PREVIOUS_DEFAULT_SCHEDULE,
  STEPPED_DEFAULT_SCHEDULE
} = require('../src/defaults');

test('default money-tree schedule is sleep-aligned and uses broad red-rich white plus darkness', () => {
  const config = validateConfig(DEFAULT_CONFIG);
  const redRich = config.schedule.find((event) => event.id === 'red-rich');
  assert.equal(redRich.mode, 'cct');
  assert.equal(redRich.cct, 3200);
  assert.equal(redRich.intensity, 100);
  assert.equal(config.schedule.some((event) => event.mode === 'hsi'), false);
  assert.ok(config.schedule.some((event) => event.mode === 'off'));
  assert.equal(config.schedule[0].time, '09:15');
  assert.equal(config.schedule[0].intensity, 0);
  assert.equal(config.schedule.at(-1).time, '23:15');
  assert.equal(config.version, 21);
  assert.equal(config.sunlightSimulationEnabled, true);
  assert.equal(config.animationFps, 15);
  assert.equal(config.partitionZones, 32);
  assert.equal(config.directBluetoothDeviceId, '');
  assert.equal('connectionMode' in config, false);
  assert.equal('sidusBtUid' in config, false);
  assert.equal('websocketUrl' in config, false);
  assert.equal(config.manualOverride, null);
});

test('older connection settings migrate to the import-only direct path', () => {
  const migrated = validateConfig(migrateConfig({
    ...DEFAULT_CONFIG,
    version: 9,
    connectionMode: 'amaran',
    websocketUrl: 'ws://127.0.0.1:1234',
    sidusBtUid: 'EDD8D6',
    directBluetoothDeviceId: undefined
  }));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.animationFps, 15);
  assert.equal(migrated.directBluetoothDeviceId, '');
  assert.equal('connectionMode' in migrated, false);
  assert.equal('websocketUrl' in migrated, false);
  assert.equal('sidusBtUid' in migrated, false);
  assert.deepEqual(migrated.schedule, validateConfig(DEFAULT_CONFIG).schedule);
});

test('untouched v0.1 and v0.2 defaults migrate without overwriting custom schedules', () => {
  const legacy = migrateConfig({ ...DEFAULT_CONFIG, version: 1, schedule: LEGACY_DEFAULT_SCHEDULE });
  assert.equal(legacy.schedule[0].time, '09:15');
  assert.equal(legacy.schedule.some((event) => event.id === 'red-rich'), true);

  const previous = migrateConfig({ ...DEFAULT_CONFIG, version: 2, schedule: PREVIOUS_DEFAULT_SCHEDULE });
  assert.equal(previous.schedule.some((event) => event.id === 'red-rich'), true);
  assert.equal(previous.version, 21);

  const stepped = migrateConfig({ ...DEFAULT_CONFIG, version: 20, schedule: STEPPED_DEFAULT_SCHEDULE });
  assert.equal(stepped.schedule[0].id, 'dawn-start');
  assert.equal(stepped.schedule[0].intensity, 0);
  assert.equal(stepped.sunlightSimulationEnabled, true);

  const customSchedule = PREVIOUS_DEFAULT_SCHEDULE.map((event) => ({ ...event }));
  customSchedule[0].time = '08:00';
  const custom = migrateConfig({ ...DEFAULT_CONFIG, version: 2, schedule: customSchedule });
  assert.equal(custom.schedule[0].time, '08:00');
});

test('manual color override is persisted but cannot exceed four hours', () => {
  const startedAt = new Date('2026-08-23T12:00:00.000Z');
  const manualOverride = {
    presetId: 'blue',
    event: { id: 'manual-blue', label: 'Room Blue', mode: 'hsi', hue: 240, saturation: 100, intensity: 75 },
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
  };
  const config = validateConfig({ ...DEFAULT_CONFIG, manualOverride });
  assert.equal(config.manualOverride.presetId, 'blue');
  assert.equal(config.manualOverride.event.hue, 240);
  const tooLong = { ...manualOverride, endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000 + 1).toISOString() };
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, manualOverride: tooLong }), /no more than four hours/);
});

test('physically validated full-bar color modes persist as safe four-hour overrides', () => {
  const startedAt = new Date('2026-08-26T12:00:00.000Z');
  const base = {
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
  };
  const events = [
    { presetId: 'custom-global-hsi', event: { mode: 'global-hsi', hue: 120, saturation: 100, intensity: 5 } },
    { presetId: 'custom-global-cct', event: { mode: 'global-cct', cct: 4300, gm: 10, intensity: 5 } },
    { presetId: 'custom-global-gel', event: { mode: 'global-gel', gelId: 'lee-203', cct: 4300, origin: 0, type: 0, color: 4, intensity: 5 } },
    { presetId: 'custom-global-rgbw', event: { mode: 'global-rgbw', red: 100, green: 0, blue: 0, warmWhite: 0, coolWhite: 0, intensity: 5 } },
    { presetId: 'custom-global-xy', event: { mode: 'global-xy', x: 0.1442, y: 0.0566, intensity: 5 } }
  ];
  for (const manualOverride of events) {
    const config = validateConfig({ ...DEFAULT_CONFIG, manualOverride: { ...base, ...manualOverride } });
    assert.equal(config.manualOverride.event.mode, manualOverride.event.mode);
  }
  assert.throws(() => validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: { ...base, presetId: 'custom-global-xy', event: { mode: 'global-xy', x: 0.8, y: 0.4, intensity: 5 } }
  }), /Invalid manual light override/);
});

test('v0.4 red and blue overrides migrate to gallery preset IDs', () => {
  const startedAt = new Date('2026-08-23T12:00:00.000Z');
  const migrated = migrateConfig({
    ...DEFAULT_CONFIG,
    version: 4,
    manualOverride: {
      color: 'red',
      event: { id: 'manual-red', label: 'Room Red', mode: 'hsi', hue: 0, saturation: 100, intensity: 75 },
      startedAt: startedAt.toISOString(),
      endsAt: new Date(startedAt.getTime() + 60 * 60 * 1000).toISOString()
    }
  });
  const config = validateConfig(migrated);
  assert.equal(config.version, 21);
  assert.equal(config.manualOverride.presetId, 'red');
  assert.equal('color' in config.manualOverride, false);
});

test('custom native Pixel FX persists only when its validated recipe shape is safe', () => {
  const startedAt = new Date('2026-08-26T12:00:00.000Z');
  const base = { startedAt: startedAt.toISOString(), endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000).toISOString() };
  const event = {
    mode: 'pixelfx', intensity: 40,
    recipe: { kind: 'cycle', speed: 160, direction: 1, changeStyle: 0, colors: [
      { hue: 0, saturation: 100, intensity: 40 }, { hue: 240, saturation: 100, intensity: 40 }
    ] }
  };
  const config = validateConfig({ ...DEFAULT_CONFIG, manualOverride: { ...base, presetId: 'custom-pixelfx', event } });
  assert.equal(config.manualOverride.event.recipe.kind, 'cycle');
  assert.throws(() => validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: { ...base, presetId: 'custom-pixelfx', event: { ...event, recipe: { kind: 'system-strobe', speed: 100, direction: 0 } } }
  }), /Invalid manual light override/);
});

test('validated partition Breath and Pulsing III persist as four-hour overrides', () => {
  const startedAt = new Date('2026-08-26T12:00:00.000Z');
  const base = { startedAt: startedAt.toISOString(), endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000).toISOString() };
  const breath = {
    mode: 'partition-breath', partitionZones: 24, zones: [0, 23], hue: 260,
    saturation: 100, intensity: 35, minimum: 2.5, frequency: 2
  };
  const breathConfig = validateConfig({ ...DEFAULT_CONFIG, partitionZones: 24, manualOverride: { ...base, presetId: 'custom-partition-breath', event: breath } });
  assert.equal(breathConfig.partitionZones, 24);
  assert.deepEqual(breathConfig.manualOverride.event.zones, [0, 23]);
  const pulsing = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: { ...base, presetId: 'custom-pulsing3', event: { mode: 'pulsing3', cct: 4300, intensity: 35, rate: 20 } }
  });
  assert.equal(pulsing.manualOverride.event.rate, 20);
  assert.throws(() => validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: { ...base, presetId: 'custom-partition-breath', event: { ...breath, zones: [24] } }
  }), /Invalid manual light override/);
});

test('validated partition Flash/Pulsing and System effects persist as four-hour overrides', () => {
  const startedAt = new Date('2026-08-27T12:00:00Z');
  for (const event of [
    { id: 'custom-partition-pulse', label: 'Partition Pulsing', mode: 'partition-pulse', kind: 'pulsing', partitionZones: 32, trigger: 'sequential', frequency: 20, intensity: 100 },
    { id: 'custom-partition-flash', label: 'Partition Flash', mode: 'partition-pulse', kind: 'flash', partitionZones: 8, trigger: 'sequential', frequency: 0.1, intensity: 50 },
    { id: 'custom-system-effect', label: 'System Strobe', mode: 'system-effect', kind: 'strobe', frequency: 10, colorType: 0, intensity: 5 },
    { id: 'custom-system-effect', label: 'System TV', mode: 'system-effect', kind: 'tv', frequency: 10, colorType: 2, intensity: 5 }
  ]) {
    const override = createManualOverride(event.id.replace('custom-', ''), event, startedAt);
    const config = validateConfig({ ...DEFAULT_CONFIG, manualOverride: override });
    assert.equal(config.manualOverride.event.mode, event.mode);
  }
  assert.throws(() => validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: createManualOverride('partition-flash', {
      id: 'custom-partition-flash', label: 'Unsupported Flash', mode: 'partition-pulse',
      kind: 'flash', partitionZones: 12, trigger: 'sequential', frequency: 1, intensity: 50
    }, startedAt)
  }), /Invalid manual light override/);
});

test('schedule validation rejects unsafe or ambiguous values', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, schedule: DEFAULT_CONFIG.schedule.map((event) => ({ ...event, time: '25:00' })) }), /Invalid time/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, schedule: DEFAULT_CONFIG.schedule.filter((event) => event.mode !== 'off') }), /Off step/);
});

test('persists a 30 FPS animation target', () => {
  const config = validateConfig({ ...DEFAULT_CONFIG, animationFps: 30 });
  assert.equal(config.animationFps, 30);
});

test('persists the experimental 60 FPS animation target', () => {
  const config = validateConfig({ ...DEFAULT_CONFIG, animationFps: 60 });
  assert.equal(config.animationFps, 60);
});

test('migrates legacy named speed settings to target FPS', () => {
  const migrated = validateConfig(migrateConfig({ ...DEFAULT_CONFIG, version: 13, animationFps: undefined, animationSpeed: 'hyper' }));
  assert.equal(migrated.animationFps, 60);
  assert.equal('animationSpeed' in migrated, false);
});

test('zone animations, ambient sequences and legacy overrides persist as four-hour timed overrides', () => {
  const startedAt = new Date('2026-08-23T12:00:00.000Z');
  const baseOverride = {
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
  };
  const effect = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      ...baseOverride,
      presetId: 'lone-comet',
      event: { id: 'animation-lone-comet', label: 'Lone Comet', mode: 'effect', effectType: 'one_pixel_chase', intensity: 65 }
    }
  });
  assert.equal(effect.manualOverride.event.effectType, 'one_pixel_chase');

  const effectPreset = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      ...baseOverride,
      presetId: 'star-spangled-flow',
      event: { id: 'animation-star-spangled-flow', label: 'Star-Spangled Sparkle', mode: 'effectpreset', presetName: 'GrowBar - Star-Spangled Sparkle', intensity: 68 }
    }
  });
  assert.equal(effectPreset.manualOverride.event.presetName, 'GrowBar - Star-Spangled Sparkle');

  const zoneFx = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      ...baseOverride,
      presetId: 'star-spangled-flow',
      event: {
        id: 'animation-star-spangled-flow', label: 'Untrusted edit', mode: 'pixelfx', intensity: 1,
        recipe: { kind: 'unknown' }
      }
    }
  });
  assert.equal(zoneFx.manualOverride.event.mode, 'zonefx');
  assert.equal(zoneFx.manualOverride.event.label, 'Star-Spangled Sparkle');
  assert.equal(zoneFx.manualOverride.event.recipe.kind, 'flag-sparkle');
  assert.equal(zoneFx.manualOverride.event.recipe.colors.length, 3);

  const sequence = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      ...baseOverride,
      presetId: 'star-spangled-flow',
      event: {
        id: 'animation-star-spangled-flow', label: 'Star-Spangled Flow', mode: 'sequence',
        frames: [
          { mode: 'hsi', hue: 0, saturation: 92, intensity: 70, durationMs: 5000 },
          { mode: 'cct', cct: 5000, intensity: 65, durationMs: 4000 }
        ]
      }
    }
  });
  assert.equal(sequence.manualOverride.event.frames.length, 2);
  assert.throws(() => validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      ...baseOverride,
      presetId: 'bad-sequence',
      event: { id: 'bad', label: 'Bad', mode: 'sequence', frames: [{ mode: 'hsi', hue: 0, saturation: 100, intensity: 100, durationMs: 500 }] }
    }
  }), /Invalid manual/);
});

test('migrates a retired Chromatic Wander override to Velvet Kaleidoscope', () => {
  const startedAt = new Date('2026-08-25T12:00:00.000Z');
  const endsAt = new Date(startedAt.getTime() + 4 * 60 * 60 * 1000);
  const config = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      presetId: 'chromatic-wander',
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      event: {
        id: 'animation-chromatic-wander',
        label: 'Chromatic Wander',
        mode: 'zonefx',
        intensity: 60,
        targetFps: 24,
        recipe: { kind: 'chromatic-wander', seed: 0xfedcba98 }
      }
    }
  });

  assert.equal(config.manualOverride.event.recipe.kind, 'velvet-kaleidoscope');
  assert.equal(config.manualOverride.event.label, 'Velvet Kaleidoscope');
  assert.equal(config.manualOverride.event.targetFps, 24);
});

test('preserves the active Celestial Orchard seed across config reloads', () => {
  const startedAt = new Date('2026-08-25T12:00:00.000Z');
  const endsAt = new Date(startedAt.getTime() + 4 * 60 * 60 * 1000);
  const config = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      presetId: 'celestial-orchard',
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      event: {
        id: 'animation-celestial-orchard',
        label: 'Celestial Orchard',
        mode: 'zonefx',
        intensity: 62,
        targetFps: 24,
        recipe: { kind: 'celestial-orchard', seed: 0x89abcdef }
      }
    }
  });

  assert.equal(config.manualOverride.event.recipe.seed, 0x89abcdef);
  assert.equal(config.manualOverride.event.targetFps, 24);
});

test('startup drops a persisted zone stream but preserves one-shot mood overrides', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growbar-config-'));
  const filePath = path.join(directory, 'settings.json');
  const startedAt = new Date('2026-08-25T12:00:00.000Z');
  const endsAt = new Date(startedAt.getTime() + 4 * 60 * 60 * 1000);
  const zoneOverride = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      presetId: 'meteor-garden',
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      event: { ...require('../src/defaults').TIMED_OVERRIDE_PRESETS['meteor-garden'], targetFps: 60 }
    }
  });
  fs.writeFileSync(filePath, JSON.stringify(zoneOverride));
  assert.equal(new ConfigStore(filePath).load().manualOverride, null);

  const moodOverride = validateConfig({
    ...DEFAULT_CONFIG,
    manualOverride: {
      presetId: 'blue',
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      event: { id: 'manual-blue', label: 'Midnight Blue', mode: 'hsi', hue: 240, saturation: 100, intensity: 75 }
    }
  });
  fs.writeFileSync(filePath, JSON.stringify(moodOverride));
  assert.equal(new ConfigStore(filePath).load().manualOverride.presetId, 'blue');
});
