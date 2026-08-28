'use strict';

const ZONE_COUNT = 32;

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? Math.round(number) : minimum));
}

function normalizeColor(input = {}) {
  return Object.freeze({
    hue: clamp(input.hue ?? 0, 0, 360),
    saturation: clamp(input.saturation ?? 100, 0, 100),
    intensity: clamp(input.intensity ?? 60, 0, 100)
  });
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function paletteFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const width = clamp(recipe.width ?? 2, 1, 8);
  const direction = Number(recipe.direction) < 0 ? -1 : 1;
  const offset = frameIndex * direction;
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    const colorIndex = Math.floor(positiveModulo(zone - offset, palette.length * width) / width);
    return palette[colorIndex];
  });
}

function flagSparkleFrame(recipe, frameIndex) {
  const red = normalizeColor(recipe.colors?.[0] || { hue: 0, saturation: 100, intensity: 62 });
  const white = normalizeColor(recipe.colors?.[1] || { hue: 0, saturation: 0, intensity: 55 });
  const blue = normalizeColor(recipe.colors?.[2] || { hue: 225, saturation: 100, intensity: 50 });
  // A slow two-step displacement makes the red/white field read as cloth
  // rolling along the bar instead of a fast barcode. The canton remains
  // anchored while two restrained stars travel through it.
  const wave = [0, 0, 1, 1, 0, 0, -1, -1][positiveModulo(frameIndex, 8)];
  const zones = Array.from({ length: ZONE_COUNT }, (_, zone) => {
    if (zone < 8) return blue;
    return positiveModulo(Math.floor((zone - 8 + wave) / 2), 2) ? white : red;
  });
  // The authored frame pace holds each glint long enough to avoid a strobe.
  zones[positiveModulo(Math.floor(frameIndex / 2) * 3, 8)] = white;
  zones[positiveModulo(Math.floor(frameIndex / 3) * 5 + 4, 8)] = white;
  return zones;
}

function opposedCometsFrame(recipe, frameIndex) {
  const first = normalizeColor(recipe.colors?.[0]);
  const second = normalizeColor(recipe.colors?.[1] || recipe.colors?.[0]);
  const background = normalizeColor(recipe.background || { hue: 220, saturation: 90, intensity: 5 });
  const width = clamp(recipe.width ?? 2, 1, 5);
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  const forward = positiveModulo(frameIndex, ZONE_COUNT);
  const reverse = positiveModulo(ZONE_COUNT - 1 - frameIndex, ZONE_COUNT);
  for (let trail = 0; trail < width; trail += 1) {
    zones[positiveModulo(forward - trail, ZONE_COUNT)] = { ...first, intensity: clamp(first.intensity - trail * 10, 1, 100) };
    zones[positiveModulo(reverse + trail, ZONE_COUNT)] = { ...second, intensity: clamp(second.intensity - trail * 10, 1, 100) };
  }
  return zones;
}

function tidalFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const direction = Number(recipe.direction) < 0 ? -1 : 1;
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    // Two quantized waves moving at different spatial frequencies create
    // interference bands while keeping every frame to a small fixed palette.
    const primary = Math.sin((zone + frameIndex * direction) * Math.PI / 7);
    const undertow = 0.58 * Math.sin((zone * 0.43 - frameIndex * direction * 0.72) * Math.PI / 3);
    const normalized = Math.max(0, Math.min(0.9999, (primary + undertow + 1.58) / 3.16));
    return palette[Math.floor(normalized * palette.length)];
  });
}

function auroraRiverFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    // Two slow waves bend the bands without ever changing the authored color
    // identities. Quantizing to a five-color palette keeps each complete PB12
    // frame compact enough to survive ordinary Bluetooth Mesh congestion.
    const river = Math.sin((zone - frameIndex * 0.72) * Math.PI / 8);
    const curtain = 0.62 * Math.sin((zone * 0.37 + frameIndex * 0.41) * Math.PI / 3);
    const normalized = Math.max(0, Math.min(0.9999, (river + curtain + 1.62) / 3.24));
    return palette[Math.floor(normalized * palette.length)];
  });
}

function moonlitSakuraFrame(recipe, frameIndex) {
  const petals = recipe.colors.map(normalizeColor).slice(0, 4);
  const background = normalizeColor(recipe.background || { hue: 245, saturation: 95, intensity: 6 });
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  // Four petals travel at different unhurried rates. Each color is held as a
  // literal partition HSI value, avoiding the native Pixel FX CCT-reference
  // ambiguity that made the previous pale-pink recipe look red/orange.
  const positions = [
    positiveModulo(frameIndex, ZONE_COUNT),
    positiveModulo(ZONE_COUNT - 1 - Math.floor(frameIndex * 0.5), ZONE_COUNT),
    positiveModulo(Math.floor(frameIndex * 0.75) + 9, ZONE_COUNT),
    positiveModulo(Math.floor(frameIndex * 0.4) + 21, ZONE_COUNT)
  ];
  positions.forEach((position, index) => {
    zones[position] = petals[index] || petals[0];
  });
  return zones;
}

function hearthsideWhisperFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const seed = Number(recipe.seed) >>> 0;
  // Hold each deterministic ember field for two authored frames. That creates
  // a gentle firelight shimmer rather than rapid independent pixel flashing.
  const epoch = Math.floor(frameIndex / 2);
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    const noise = pseudoRandomUnit(seed ^ Math.imul(zone + 1, 0x45d9f3b), epoch);
    const glow = (Math.sin((zone + epoch * 0.55) * Math.PI / 6) + 1) / 2;
    const level = Math.min(0.9999, noise * 0.48 + glow * 0.52);
    return palette[Math.floor(level * palette.length)];
  });
}

function analogDreamFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    // Broad cool/warm reflections drift in opposing directions like light
    // from an old television, without relying on the PB12 System-TV engine.
    const scan = Math.sin((zone - frameIndex * 0.8) * Math.PI / 6);
    const reflection = 0.7 * Math.cos((zone + frameIndex * 0.35) * Math.PI / 11);
    const normalized = Math.max(0, Math.min(0.9999, (scan + reflection + 1.7) / 3.4));
    return palette[Math.floor(normalized * palette.length)];
  });
}

function cinderCathedralFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const span = Math.max(1, palette.length * 2 - 2);
  const cycle = positiveModulo(frameIndex, span * 2);
  const breathingPhase = cycle <= span ? cycle : span * 2 - cycle;
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    // Mirroring distance about the center turns the linear bar into repeating
    // ember arches. The folded phase makes them rise and settle with no seam.
    const distance = Math.floor(Math.abs(zone - (ZONE_COUNT - 1) / 2));
    return palette[positiveModulo(Math.floor(distance / 2) + breathingPhase, palette.length)];
  });
}

function neonProcessionFrame(recipe, frameIndex) {
  const colors = recipe.colors.map(normalizeColor).slice(0, 3);
  const background = normalizeColor(recipe.background || { hue: 255, saturation: 100, intensity: 3 });
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  const spacing = [0, 11, 22];
  colors.forEach((color, index) => {
    const position = positiveModulo(frameIndex + spacing[index], ZONE_COUNT);
    const trail = { ...color, intensity: clamp(Math.round(color.intensity * 0.28), 1, 100) };
    zones[positiveModulo(position - 2, ZONE_COUNT)] = trail;
    zones[positiveModulo(position - 1, ZONE_COUNT)] = trail;
    zones[position] = color;
  });
  return zones;
}

function radialBloomFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const width = clamp(recipe.width ?? 2, 1, 6);
  const direction = Number(recipe.direction) < 0 ? -1 : 1;
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    const distanceFromHeart = Math.abs(zone - (ZONE_COUNT - 1) / 2);
    const ring = Math.floor((distanceFromHeart - frameIndex * direction) / width);
    return palette[positiveModulo(ring, palette.length)];
  });
}

function fireflyFrame(recipe, frameIndex) {
  const glow = normalizeColor(recipe.colors?.[0] || { hue: 50, saturation: 90, intensity: 58 });
  const leaf = normalizeColor(recipe.colors?.[1] || { hue: 120, saturation: 88, intensity: 24 });
  const background = normalizeColor(recipe.background || { hue: 135, saturation: 95, intensity: 4 });
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  // Independent sine walks avoid the old straight-line, synchronized chase.
  // Each point lingers at the ends of its path like a real drifting firefly.
  const positions = [
    Math.round((Math.sin(frameIndex * 0.31) + 1) * 15.5),
    Math.round((Math.sin(frameIndex * 0.19 + 2.1) + 1) * 15.5),
    Math.round((Math.sin(frameIndex * 0.13 + 4.4) + 1) * 15.5)
  ];
  positions.forEach((position, index) => {
    zones[position] = index === 1 ? leaf : glow;
    zones[positiveModulo(position - 1, ZONE_COUNT)] = { ...(index === 1 ? leaf : glow), intensity: 14 };
  });
  return zones;
}

function zoneRunnerFrame(recipe, frameIndex) {
  const head = normalizeColor(recipe.colors?.[0] || { hue: 185, saturation: 75, intensity: 68 });
  const trail = normalizeColor(recipe.colors?.[1] || { hue: 205, saturation: 100, intensity: 34 });
  const background = normalizeColor(recipe.background || { hue: 235, saturation: 100, intensity: 3 });
  const width = clamp(recipe.width ?? 3, 1, 6);
  const direction = Number(recipe.direction) < 0 ? -1 : 1;
  const headPosition = positiveModulo(frameIndex * direction, ZONE_COUNT);
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  zones[headPosition] = head;
  // One shared trail color keeps every frame to three grouped mask commands:
  // background, runner, and trail. This permits a genuinely quick chase
  // without flooding Bluetooth Mesh.
  for (let offset = 1; offset <= width; offset += 1) {
    zones[positiveModulo(headPosition - offset * direction, ZONE_COUNT)] = trail;
  }
  return zones;
}

function meteorGardenFrame(recipe, frameIndex) {
  const heads = recipe.colors.map(normalizeColor).slice(0, 3);
  const trail = normalizeColor(recipe.trail || { hue: 205, saturation: 18, intensity: 22 });
  const background = normalizeColor(recipe.background || { hue: 235, saturation: 100, intensity: 3 });
  const width = clamp(recipe.width ?? 3, 1, 5);
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  const positions = [
    positiveModulo(frameIndex, ZONE_COUNT),
    positiveModulo(ZONE_COUNT - 1 - frameIndex * 2, ZONE_COUNT),
    positiveModulo(frameIndex * 3 + 11, ZONE_COUNT)
  ];
  positions.forEach((position, meteor) => {
    const direction = meteor === 1 ? -1 : 1;
    for (let offset = width; offset >= 1; offset -= 1) {
      zones[positiveModulo(position - offset * direction, ZONE_COUNT)] = trail;
    }
    zones[position] = heads[meteor] || heads[0];
  });
  return zones;
}

function velvetKaleidoscopeFrame(recipe, frameIndex) {
  const palette = recipe.colors.map(normalizeColor);
  const width = clamp(recipe.width ?? 2, 1, 5);
  const span = Math.max(1, palette.length * width - 1);
  const cycle = positiveModulo(frameIndex, span * 2);
  const foldedTime = cycle <= span ? cycle : span * 2 - cycle;
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    const foldedSpace = Math.min(zone, ZONE_COUNT - 1 - zone);
    const slot = Math.floor((foldedSpace + foldedTime) / width);
    return palette[positiveModulo(slot, palette.length)];
  });
}

function celestialOrchardFrame(recipe, frameIndex) {
  const stars = recipe.colors.map(normalizeColor).slice(0, 3);
  const halo = normalizeColor(recipe.halo || { hue: 215, saturation: 25, intensity: 12 });
  const background = normalizeColor(recipe.background || { hue: 135, saturation: 90, intensity: 3 });
  const seed = Number(recipe.seed) >>> 0;
  const zones = Array.from({ length: ZONE_COUNT }, () => background);
  stars.forEach((star, slot) => {
    // Each star changes branch on its own long hold, so the scene evolves
    // asynchronously without one-frame blackouts or whole-bar flashes.
    const holdFrames = 5 + slot * 2;
    const epoch = Math.floor(frameIndex / holdFrames);
    const position = Math.floor(pseudoRandomUnit(seed ^ Math.imul(slot + 1, 0x45d9f3b), epoch) * ZONE_COUNT);
    zones[position] = star;
    zones[positiveModulo(position - 1, ZONE_COUNT)] = halo;
    zones[positiveModulo(position + 1, ZONE_COUNT)] = halo;
  });
  return zones;
}

function prismContinuumFrame(recipe, frameIndex) {
  const direction = Number(recipe.direction) < 0 ? -1 : 1;
  const saturation = clamp(recipe.saturation ?? 100, 0, 100);
  const intensity = clamp(recipe.intensity ?? 60, 0, 100);
  // A 32-zone circle divides the 360-degree HSI wheel into exact 11.25-degree
  // intervals. The PB12 stores integer hues, so rounding each ideal position
  // distributes the unavoidable quarter-degree error around the loop while
  // retaining 32 distinct colors. The virtual 33rd position wraps to hue 0.
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    const hueSlot = positiveModulo(zone - frameIndex * direction, ZONE_COUNT);
    return normalizeColor({
      hue: hueSlot * 360 / ZONE_COUNT,
      saturation,
      intensity
    });
  });
}

function pseudoRandomUnit(seed, index) {
  // A small integer hash gives each activation a stable, random-looking path
  // without mutable animation state. That matters because a running four-hour
  // override must resume coherently after GrowBar restarts.
  let value = (Number(seed) >>> 0) + Math.imul(index + 1, 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}

function chromaticDestination(recipe, index) {
  const seed = Number(recipe.seed) >>> 0;
  const initialHue = pseudoRandomUnit(seed ^ 0xa53c9e17, 0) * 360;
  // A golden-angle walk spreads successive destinations around the full color
  // wheel. Bounded seeded jitter makes every activation distinct while keeping
  // neighboring destinations far enough apart to produce a meaningful journey.
  const jitter = (pseudoRandomUnit(seed, index) - 0.5) * 40;
  return positiveModulo(initialHue + index * 137.507764 + jitter, 360);
}

function chromaticWanderFrame(recipe, frameIndex) {
  const transitionFrames = clamp(recipe.transitionFrames ?? 90, 12, 600);
  const transitionIndex = Math.floor(frameIndex / transitionFrames);
  const step = frameIndex % transitionFrames;
  const startHue = chromaticDestination(recipe, transitionIndex);
  const targetHue = chromaticDestination(recipe, transitionIndex + 1);
  const progress = step / (transitionFrames - 1);
  // Ease to rest at each destination, then continue toward the next. Taking the
  // shortest signed arc makes the PB12 visibly pass through every intervening
  // hue without ever jumping across the wheel.
  const eased = (1 - Math.cos(Math.PI * progress)) / 2;
  const arc = positiveModulo(targetHue - startHue + 180, 360) - 180;
  const color = normalizeColor({
    hue: positiveModulo(startHue + arc * eased, 360),
    saturation: recipe.saturation ?? 100,
    intensity: recipe.intensity ?? 60
  });
  return Array.from({ length: ZONE_COUNT }, () => color);
}

function chromaticRaveFrame(recipe, frameIndex) {
  // Keep Chromatic Wander's smooth seeded journey as the base, then hold a
  // sparse random blackout mask for several frames. This creates independent
  // dark-zone pulses without turning the whole bar into a rapid strobe. Since
  // every lit zone shares one color, each frame remains compact: one mask for
  // the current hue and one mask for darkness.
  const zones = chromaticWanderFrame(recipe, frameIndex);
  const holdFrames = clamp(recipe.darkHoldFrames ?? 4, 2, 30);
  const pulseIndex = Math.floor(frameIndex / holdFrames);
  const seed = (Number(recipe.seed) >>> 0) ^ 0x72a6e5d3;
  const darkProbability = Math.max(0.04, Math.min(0.28, Number(recipe.darkProbability) || 0.14));
  const darkCandidates = [];
  let fallback = { zone: 0, value: 1 };

  for (let zone = 0; zone < ZONE_COUNT; zone += 1) {
    const value = pseudoRandomUnit(seed ^ Math.imul(zone + 1, 0x45d9f3b), pulseIndex);
    if (value < fallback.value) fallback = { zone, value };
    if (value < darkProbability) darkCandidates.push({ zone, value });
  }

  // Always produce a visible dark pulse, but cap the blackout to one quarter
  // of the bar so Chromatic Wander's current destination color stays dominant.
  if (!darkCandidates.length) darkCandidates.push(fallback);
  darkCandidates
    .sort((first, second) => first.value - second.value)
    .slice(0, 8)
    .forEach(({ zone }) => {
      zones[zone] = normalizeColor({ hue: 0, saturation: 0, intensity: 0 });
    });
  return zones;
}

function zoneAnimationFrame(recipe, frameIndex) {
  if (!recipe || typeof recipe !== 'object') throw new Error('This animation is missing its PB12 zone recipe.');
  const index = Math.max(0, Math.trunc(Number(frameIndex) || 0));
  let zones;
  if (recipe.kind === 'palette-chase') zones = paletteFrame(recipe, index);
  else if (recipe.kind === 'flag-sparkle') zones = flagSparkleFrame(recipe, index);
  else if (recipe.kind === 'opposed-comets') zones = opposedCometsFrame(recipe, index);
  else if (recipe.kind === 'tidal-interference') zones = tidalFrame(recipe, index);
  else if (recipe.kind === 'aurora-river') zones = auroraRiverFrame(recipe, index);
  else if (recipe.kind === 'moonlit-sakura') zones = moonlitSakuraFrame(recipe, index);
  else if (recipe.kind === 'hearthside-whisper') zones = hearthsideWhisperFrame(recipe, index);
  else if (recipe.kind === 'analog-dream') zones = analogDreamFrame(recipe, index);
  else if (recipe.kind === 'cinder-cathedral') zones = cinderCathedralFrame(recipe, index);
  else if (recipe.kind === 'neon-procession') zones = neonProcessionFrame(recipe, index);
  else if (recipe.kind === 'radial-bloom') zones = radialBloomFrame(recipe, index);
  else if (recipe.kind === 'fireflies') zones = fireflyFrame(recipe, index);
  else if (recipe.kind === 'zone-runner') zones = zoneRunnerFrame(recipe, index);
  else if (recipe.kind === 'meteor-garden') zones = meteorGardenFrame(recipe, index);
  else if (recipe.kind === 'velvet-kaleidoscope') zones = velvetKaleidoscopeFrame(recipe, index);
  else if (recipe.kind === 'celestial-orchard') zones = celestialOrchardFrame(recipe, index);
  else if (recipe.kind === 'prism-continuum') zones = prismContinuumFrame(recipe, index);
  else if (recipe.kind === 'chromatic-wander') zones = chromaticWanderFrame(recipe, index);
  else if (recipe.kind === 'chromatic-rave') zones = chromaticRaveFrame(recipe, index);
  else throw new Error(`Unsupported PB12 zone animation: ${recipe.kind || 'unknown'}.`);
  return {
    durationMs: clamp(recipe.durationMs ?? 650, 80, 5000),
    zones
  };
}

module.exports = { ZONE_COUNT, normalizeColor, zoneAnimationFrame };
