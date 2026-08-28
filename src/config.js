'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  DEFAULT_CONFIG,
  DEFAULT_SCHEDULE,
  LEGACY_DEFAULT_SCHEDULE,
  PREVIOUS_DEFAULT_SCHEDULE,
  STEPPED_DEFAULT_SCHEDULE,
  TIMED_OVERRIDE_PRESETS
} = require('./defaults');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEvent(event) {
  const normalized = {
    id: typeof event.id === 'string' && event.id ? event.id : randomUUID(),
    time: String(event.time || ''),
    label: String(event.label || 'Schedule step').trim().slice(0, 80),
    mode: String(event.mode || '').toLowerCase(),
    intensity: Number(event.intensity ?? 0)
  };
  if (normalized.mode === 'cct') normalized.cct = Number(event.cct);
  if (normalized.mode === 'hsi') {
    normalized.hue = Number(event.hue);
    normalized.saturation = Number(event.saturation);
  }
  if (normalized.mode === 'global-cct') {
    normalized.cct = Number(event.cct);
    normalized.gm = Number(event.gm ?? 0);
  }
  if (normalized.mode === 'global-hsi') {
    normalized.hue = Number(event.hue);
    normalized.saturation = Number(event.saturation);
  }
  if (normalized.mode === 'global-rgbw') {
    normalized.red = Number(event.red);
    normalized.green = Number(event.green);
    normalized.blue = Number(event.blue);
    normalized.warmWhite = Number(event.warmWhite);
    normalized.coolWhite = Number(event.coolWhite);
  }
  if (normalized.mode === 'global-xy') {
    normalized.x = Number(event.x);
    normalized.y = Number(event.y);
  }
  if (normalized.mode === 'global-gel') {
    normalized.gelId = String(event.gelId || '');
    normalized.cct = Number(event.cct);
    normalized.origin = Number(event.origin);
    normalized.type = Number(event.type);
    normalized.color = Number(event.color);
  }
  if (normalized.mode === 'effect') normalized.effectType = String(event.effectType || '');
  if (normalized.mode === 'effectpreset') normalized.presetName = String(event.presetName || '').trim();
  if (normalized.mode === 'pixelfx' && event.recipe && typeof event.recipe === 'object') normalized.recipe = clone(event.recipe);
  if (normalized.mode === 'zonefx' && event.recipe && typeof event.recipe === 'object') {
    normalized.recipe = clone(event.recipe);
    normalized.targetFps = Number(event.targetFps ?? 15);
    normalized.partitionZones = Number(event.partitionZones ?? 32);
  }
  if (normalized.mode === 'partition-breath') {
    normalized.partitionZones = Number(event.partitionZones ?? 4);
    normalized.zones = Array.isArray(event.zones) ? event.zones.map(Number) : [];
    normalized.hue = Number(event.hue);
    normalized.saturation = Number(event.saturation);
    normalized.minimum = Number(event.minimum);
    normalized.frequency = Number(event.frequency);
  }
  if (normalized.mode === 'partition-pulse') {
    normalized.kind = String(event.kind || '').toLowerCase();
    normalized.partitionZones = Number(event.partitionZones ?? 4);
    normalized.frequency = Number(event.frequency);
    normalized.trigger = String(event.trigger || '').toLowerCase();
  }
  if (normalized.mode === 'pulsing3') {
    normalized.cct = Number(event.cct);
    normalized.rate = Number(event.rate);
  }
  if (normalized.mode === 'system-effect') {
    normalized.kind = String(event.kind || '').toLowerCase();
    normalized.frequency = Number(event.frequency);
    normalized.colorType = Number(event.colorType ?? 0);
  }
  if (normalized.mode === 'sequence') {
    normalized.frames = Array.isArray(event.frames) ? event.frames.map((frame) => {
      const normalizedFrame = {
        mode: String(frame?.mode || '').toLowerCase(),
        intensity: Number(frame?.intensity ?? 0),
        durationMs: Number(frame?.durationMs)
      };
      if (normalizedFrame.mode === 'cct') normalizedFrame.cct = Number(frame.cct);
      if (normalizedFrame.mode === 'hsi') {
        normalizedFrame.hue = Number(frame.hue);
        normalizedFrame.saturation = Number(frame.saturation);
      }
      return normalizedFrame;
    }) : [];
  }
  return normalized;
}

function scheduleSignature(schedule) {
  return JSON.stringify(schedule.map((event) => normalizeEvent(event)));
}

function migrateConfig(input) {
  const migrated = clone(input);
  const version = Number(migrated.version || 1);
  const signature = Array.isArray(migrated.schedule) ? scheduleSignature(migrated.schedule) : '';
  const isUntouchedDefault = (version < 2 && signature === scheduleSignature(LEGACY_DEFAULT_SCHEDULE))
    || (version < 3 && signature === scheduleSignature(PREVIOUS_DEFAULT_SCHEDULE))
    || (version < 21 && signature === scheduleSignature(STEPPED_DEFAULT_SCHEDULE));
  if (isUntouchedDefault) migrated.schedule = clone(DEFAULT_SCHEDULE);
  if (typeof migrated.sunlightSimulationEnabled !== 'boolean') migrated.sunlightSimulationEnabled = true;
  if (version < 5 && migrated.manualOverride?.color && !migrated.manualOverride.presetId) {
    migrated.manualOverride.presetId = migrated.manualOverride.color;
    delete migrated.manualOverride.color;
  }
  if (typeof migrated.directBluetoothDeviceId !== 'string') migrated.directBluetoothDeviceId = '';
  delete migrated.connectionMode;
  delete migrated.sidusBtUid;
  delete migrated.websocketUrl;
  if (![5, 10, 15, 24, 30, 60].includes(Number(migrated.animationFps))) {
    const legacyFps = { relaxed: 5, standard: 10, fast: 15, turbo: 24, warp: 30, hyper: 60 };
    migrated.animationFps = legacyFps[migrated.animationSpeed] || 15;
  }
  if (migrated.manualOverride?.event?.mode === 'zonefx' && !Number.isFinite(Number(migrated.manualOverride.event.targetFps))) {
    migrated.manualOverride.event.targetFps = migrated.animationFps;
  }
  if (migrated.manualOverride?.event) delete migrated.manualOverride.event.playbackRate;
  delete migrated.animationSpeed;
  if (![4, 8, 12, 16, 24, 32].includes(Number(migrated.partitionZones))) migrated.partitionZones = 32;
  migrated.version = 21;
  return migrated;
}

function normalizeManualOverride(input) {
  if (input == null) return null;
  if (!input || typeof input !== 'object') throw new Error('Invalid timed light override.');
  const startedAt = new Date(input.startedAt);
  const endsAt = new Date(input.endsAt);
  const duration = endsAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endsAt.getTime()) || duration <= 0 || duration > 4 * 60 * 60 * 1000) {
    throw new Error('Timed light overrides must last no more than four hours.');
  }
  let event = normalizeEvent(input.event || {});
  const presetId = String(input.presetId || input.color || '').trim();
  if (!/^[a-z0-9-]{1,64}$/.test(presetId)) throw new Error('Invalid timed light preset.');
  const validIntensity = Number.isFinite(event.intensity) && event.intensity >= 0 && event.intensity <= 100;
  const validHsi = event.mode === 'hsi' && Number.isFinite(event.hue) && event.hue >= 0 && event.hue <= 360
    && Number.isFinite(event.saturation) && event.saturation >= 0 && event.saturation <= 100 && validIntensity;
  const validGlobalIntensity = Number.isInteger(event.intensity) && event.intensity >= 0 && event.intensity <= 100;
  const validGlobalCct = event.mode === 'global-cct' && Number.isInteger(event.cct)
    && event.cct >= 2000 && event.cct <= 10000 && Number.isInteger(event.gm)
    && event.gm >= -100 && event.gm <= 100 && event.gm % 10 === 0 && validGlobalIntensity;
  const validGlobalHsi = event.mode === 'global-hsi' && Number.isInteger(event.hue) && event.hue >= 0 && event.hue <= 360
    && Number.isInteger(event.saturation) && event.saturation >= 0 && event.saturation <= 100 && validGlobalIntensity;
  const validRgbwChannel = (value) => Number.isInteger(value) && value >= 0 && value <= 100;
  const validGlobalRgbw = event.mode === 'global-rgbw'
    && [event.red, event.green, event.blue, event.warmWhite, event.coolWhite].every(validRgbwChannel) && validGlobalIntensity;
  const validGlobalXy = event.mode === 'global-xy' && Number.isFinite(event.x) && event.x >= 0 && event.x <= 1
    && Number.isFinite(event.y) && event.y >= 0 && event.y <= 1 && event.x + event.y <= 1.0001 && validGlobalIntensity;
  const validGlobalGel = event.mode === 'global-gel' && /^[a-z0-9-]{1,64}$/.test(event.gelId)
    && Number.isInteger(event.cct) && event.cct >= 2000 && event.cct <= 10000
    && Number.isInteger(event.origin) && event.origin >= 0 && event.origin <= 1
    && Number.isInteger(event.type) && event.type >= 0 && event.type <= 15
    && Number.isInteger(event.color) && event.color >= 0 && event.color <= 1023 && validGlobalIntensity;
  const validEffect = event.mode === 'effect' && /^[a-z0-9_]{1,64}$/.test(event.effectType) && validIntensity;
  const validEffectPreset = event.mode === 'effectpreset' && /^[^\u0000-\u001f\u007f]{1,80}$/.test(event.presetName) && validIntensity;
  const knownPreset = TIMED_OVERRIDE_PRESETS[presetId];
  // Named animation overrides always migrate to the current canonical recipe
  // by preset ID. This prevents an older guessed or streamed packet shape from
  // surviving after its preset moves to a hardware-validated engine.
  const pixelColorValid = (color) => color && Number.isFinite(Number(color.hue)) && Number(color.hue) >= 0 && Number(color.hue) <= 360
    && Number.isFinite(Number(color.saturation ?? 100)) && Number(color.saturation ?? 100) >= 0 && Number(color.saturation ?? 100) <= 100
    && Number.isFinite(Number(color.intensity ?? event.intensity)) && Number(color.intensity ?? event.intensity) >= 0 && Number(color.intensity ?? event.intensity) <= 100
    && (color.cct == null || (Number.isInteger(Number(color.cct)) && Number(color.cct) >= 0 && Number(color.cct) <= 511));
  const recipe = event.recipe;
  const validCustomRecipe = presetId === 'custom-pixelfx' && recipe && ['fade', 'cycle', 'chase', 'rainbow', 'fire'].includes(recipe.kind)
    && Number.isInteger(Number(recipe.speed)) && Number(recipe.speed) >= 0 && Number(recipe.speed) <= 1000
    && Number.isInteger(Number(recipe.direction)) && Number(recipe.direction) >= 0 && Number(recipe.direction) <= 1
    && (recipe.kind === 'rainbow'
      || (recipe.kind === 'fire' && pixelColorValid(recipe.sparkColor) && pixelColorValid(recipe.baseColor)
        && Number.isInteger(Number(recipe.minimum)) && Number(recipe.minimum) >= 0
        && Number(recipe.minimum) <= Number(recipe.sparkColor.intensity ?? event.intensity))
      || (recipe.kind === 'chase' && Array.isArray(recipe.colors) && recipe.colors.length >= 1 && recipe.colors.length <= 3
        && recipe.colors.every(pixelColorValid) && pixelColorValid(recipe.baseColor)
        && Number.isInteger(Number(recipe.group)) && Number(recipe.group) >= 0 && Number(recipe.group) <= 3
        && Number.isInteger(Number(recipe.pixelLength)) && Number(recipe.pixelLength) >= 0 && Number(recipe.pixelLength) <= 7)
      || (['fade', 'cycle'].includes(recipe.kind) && Array.isArray(recipe.colors)
        && recipe.colors.length >= 2 && recipe.colors.length <= 15 && recipe.colors.every(pixelColorValid)
        && (recipe.kind !== 'cycle' || (Number.isInteger(Number(recipe.changeStyle)) && Number(recipe.changeStyle) >= 0 && Number(recipe.changeStyle) <= 1))));
  const knownPixelFx = event.mode === 'pixelfx' && ['pixelfx', 'zonefx'].includes(knownPreset?.mode) && validIntensity;
  const validPixelFx = knownPixelFx || (event.mode === 'pixelfx' && validCustomRecipe && validIntensity);
  if (knownPixelFx) event = clone(knownPreset);
  const validZoneFx = event.mode === 'zonefx' && knownPreset?.mode === 'zonefx' && validIntensity;
  if (validZoneFx) {
    const runtimeSeed = knownPreset.recipe?.kind === 'celestial-orchard' && Number.isInteger(Number(event.recipe?.seed))
      ? Number(event.recipe.seed) >>> 0
      : null;
    event = { ...clone(knownPreset), targetFps: Math.max(1, Math.min(60, Math.round(Number(event.targetFps) || 15))) };
    if (runtimeSeed !== null) event.recipe.seed = runtimeSeed;
  }
  const validPartitionBreath = event.mode === 'partition-breath'
    && [4, 8, 12, 16, 24, 32].includes(event.partitionZones)
    && Array.isArray(event.zones) && event.zones.length > 0
    && event.zones.every((zone) => Number.isInteger(zone) && zone >= 0 && zone < event.partitionZones)
    && Number.isInteger(event.hue) && event.hue >= 0 && event.hue <= 360
    && Number.isInteger(event.saturation) && event.saturation >= 0 && event.saturation <= 100
    && Number.isFinite(event.minimum) && event.minimum >= 0 && event.minimum <= 12.7
    && Number.isFinite(event.frequency) && event.frequency >= 0.1 && event.frequency <= 22
    && validGlobalIntensity;
  const validPulsing3 = event.mode === 'pulsing3' && Number.isInteger(event.cct) && event.cct >= 2000 && event.cct <= 10000
    && Number.isInteger(event.rate) && event.rate >= 20 && event.rate <= 200 && validGlobalIntensity;
  const validPartitionPulse = event.mode === 'partition-pulse'
    && ['flash', 'pulsing'].includes(event.kind)
    && [4, 8, 12, 16, 24, 32].includes(event.partitionZones)
    && (event.kind !== 'flash' || [4, 8].includes(event.partitionZones))
    && ['unified', 'sequential'].includes(event.trigger)
    && Number.isFinite(event.frequency) && event.frequency >= 0.1 && event.frequency <= 20
    && validGlobalIntensity;
  const validSystemEffect = event.mode === 'system-effect'
    && ['candle', 'tv', 'fire', 'strobe', 'lightning', 'paparazzi', 'faulty-bulb'].includes(event.kind)
    && Number.isInteger(event.frequency) && event.frequency >= 1 && event.frequency <= 10
    && (event.kind !== 'lightning' || event.frequency === 1)
    && Number.isInteger(event.colorType) && event.colorType >= 0 && event.colorType <= 2
    && (event.kind !== 'candle' || event.colorType === 0)
    && event.intensity === 5;
  const validFrame = (frame) => frame && ['hsi', 'cct'].includes(frame.mode)
    && Number.isFinite(frame.durationMs) && frame.durationMs >= 1000 && frame.durationMs <= 60000
    && Number.isFinite(frame.intensity) && frame.intensity >= 0 && frame.intensity <= 100
    && (frame.mode !== 'hsi' || (Number.isFinite(frame.hue) && frame.hue >= 0 && frame.hue <= 360
      && Number.isFinite(frame.saturation) && frame.saturation >= 0 && frame.saturation <= 100))
    && (frame.mode !== 'cct' || (Number.isFinite(frame.cct) && frame.cct >= 2000 && frame.cct <= 10000));
  const validSequence = event.mode === 'sequence' && Array.isArray(event.frames) && event.frames.length >= 2
    && event.frames.length <= 16 && event.frames.every(validFrame);
  if (!validHsi && !validGlobalCct && !validGlobalHsi && !validGlobalRgbw && !validGlobalXy && !validGlobalGel
    && !validEffect && !validEffectPreset && !validPixelFx && !validZoneFx && !validPartitionBreath
    && !validPartitionPulse && !validPulsing3 && !validSystemEffect && !validSequence) {
    throw new Error('Invalid manual light override setting.');
  }
  return {
    presetId,
    event,
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString()
  };
}

function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Settings must be an object.');
  if (!Array.isArray(input.schedule) || input.schedule.length < 2) {
    throw new Error('Add at least two schedule steps.');
  }

  const schedule = input.schedule.map(normalizeEvent);
  const ids = new Set();
  for (const event of schedule) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) throw new Error(`Invalid time: ${event.time}`);
    if (!['cct', 'hsi', 'off'].includes(event.mode)) throw new Error(`Invalid mode at ${event.time}.`);
    if (!Number.isFinite(event.intensity) || event.intensity < 0 || event.intensity > 100) {
      throw new Error(`Intensity at ${event.time} must be 0–100%.`);
    }
    if (event.mode === 'cct' && (!Number.isFinite(event.cct) || event.cct < 2000 || event.cct > 10000)) {
      throw new Error(`Color temperature at ${event.time} must be 2000–10000K.`);
    }
    if (event.mode === 'hsi') {
      if (!Number.isFinite(event.hue) || event.hue < 0 || event.hue > 360) throw new Error(`Hue at ${event.time} must be 0–360°.`);
      if (!Number.isFinite(event.saturation) || event.saturation < 0 || event.saturation > 100) throw new Error(`Saturation at ${event.time} must be 0–100%.`);
    }
    if (ids.has(event.id)) event.id = randomUUID();
    ids.add(event.id);
  }

  schedule.sort((a, b) => a.time.localeCompare(b.time));
  const uniqueTimes = new Set(schedule.map((event) => event.time));
  if (uniqueTimes.size !== schedule.length) throw new Error('Each schedule step needs a unique time.');
  if (!schedule.some((event) => event.mode === 'off')) throw new Error('Add an Off step so plants receive a dark period.');

  return {
    version: 21,
    scheduleEnabled: input.scheduleEnabled !== false,
    sunlightSimulationEnabled: input.sunlightSimulationEnabled !== false,
    launchAtLogin: input.launchAtLogin !== false,
    animationFps: [5, 10, 15, 24, 30, 60].includes(Number(input.animationFps)) ? Number(input.animationFps) : 15,
    partitionZones: [4, 8, 12, 16, 24, 32].includes(Number(input.partitionZones)) ? Number(input.partitionZones) : 32,
    directBluetoothDeviceId: typeof input.directBluetoothDeviceId === 'string' ? input.directBluetoothDeviceId.slice(0, 200) : '',
    targetLightIds: Array.isArray(input.targetLightIds) ? input.targetLightIds.filter((id) => typeof id === 'string') : [],
    manualOverride: normalizeManualOverride(input.manualOverride),
    schedule
  };
}

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.value = clone(DEFAULT_CONFIG);
  }

  load() {
    try {
      const input = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const migrated = migrateConfig(input);
      this.value = validateConfig(migrated);
      // Streamed zone animations are never armed across process restarts. A
      // crash or ordinary relaunch reconnects automatically, then resumes the
      // plant schedule instead of restarting a potentially high-rate stream.
      if (this.value.manualOverride?.event?.mode === 'zonefx') this.value.manualOverride = null;
      if (JSON.stringify(input) !== JSON.stringify(this.value)) this.write(this.value);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load settings; using defaults:', error.message);
      this.value = clone(DEFAULT_CONFIG);
    }
    return this.get();
  }

  save(value) {
    const validated = validateConfig(value);
    this.write(validated);
    this.value = validated;
    return this.get();
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  get() { return clone(this.value); }
}

module.exports = { ConfigStore, migrateConfig, normalizeEvent, normalizeManualOverride, validateConfig };
