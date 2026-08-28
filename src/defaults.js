'use strict';

const LEGACY_DEFAULT_SCHEDULE = [
  { id: 'sunrise', time: '07:00', label: 'Gentle sunrise', mode: 'cct', cct: 3200, intensity: 35 },
  { id: 'morning', time: '07:30', label: 'Blue-rich morning', mode: 'cct', cct: 6500, intensity: 85 },
  { id: 'growth', time: '09:00', label: 'Full-spectrum growth', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'red', time: '14:00', label: 'Red-enriched growth', mode: 'hsi', hue: 0, saturation: 65, intensity: 100 },
  { id: 'afternoon', time: '16:00', label: 'Full-spectrum afternoon', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'sunset', time: '20:30', label: 'Gentle sunset', mode: 'cct', cct: 3000, intensity: 40 },
  { id: 'night', time: '21:00', label: 'Dark period', mode: 'off', intensity: 0 }
];

// v0.2 money-tree preset. Kept so untouched installs can migrate without
// replacing schedules that people have edited themselves.
const PREVIOUS_DEFAULT_SCHEDULE = [
  { id: 'wake', time: '09:15', label: 'Wake-up dawn', mode: 'cct', cct: 3200, intensity: 25 },
  { id: 'ramp', time: '09:30', label: 'Morning ramp', mode: 'cct', cct: 4500, intensity: 70 },
  { id: 'blue-morning', time: '09:45', label: 'Blue-balanced morning', mode: 'cct', cct: 6500, intensity: 100 },
  { id: 'growth', time: '10:15', label: 'Full-spectrum growth', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'red', time: '14:00', label: 'Red-enriched growth', mode: 'hsi', hue: 0, saturation: 35, intensity: 100 },
  { id: 'afternoon', time: '16:00', label: 'Full-spectrum afternoon', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'wind-down', time: '22:45', label: 'Warm wind-down', mode: 'cct', cct: 4000, intensity: 80 },
  { id: 'sunset', time: '23:00', label: 'Gentle sunset', mode: 'cct', cct: 3000, intensity: 40 },
  { id: 'night', time: '23:15', label: 'Dark period', mode: 'off', intensity: 0 }
];

// v0.17 stepped preset. Kept so an untouched schedule can migrate to the
// continuous sunlight curve without replacing a schedule the user edited.
const STEPPED_DEFAULT_SCHEDULE = [
  { id: 'wake', time: '09:15', label: 'Wake-up dawn', mode: 'cct', cct: 3200, intensity: 25 },
  { id: 'ramp', time: '09:30', label: 'Morning ramp', mode: 'cct', cct: 4500, intensity: 70 },
  { id: 'blue-morning', time: '09:45', label: 'Blue-balanced morning', mode: 'cct', cct: 6500, intensity: 100 },
  { id: 'growth', time: '10:15', label: 'Broad-spectrum growth', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'red-rich', time: '18:45', label: 'Red-rich broad spectrum', mode: 'cct', cct: 3200, intensity: 100 },
  { id: 'wind-down', time: '22:45', label: 'Warm wind-down', mode: 'cct', cct: 2700, intensity: 50 },
  { id: 'sunset', time: '23:00', label: 'Gentle sunset', mode: 'cct', cct: 2200, intensity: 25 },
  { id: 'night', time: '23:15', label: 'Dark period', mode: 'off', intensity: 0 }
];

// Money-tree (Pachira aquatica) preset aligned to a 02:15–09:15 sleep window.
// In smooth-sunlight mode these are control points rather than abrupt steps:
// GrowBar continuously interpolates brightness and CCT between them. The zero-
// intensity 09:15 anchor starts sunrise only after the complete ten-hour dark
// window; the 23:00–23:15 segment fades to darkness without shortening it.
const DEFAULT_SCHEDULE = [
  { id: 'dawn-start', time: '09:15', label: 'Dawn begins', mode: 'cct', cct: 2200, intensity: 0 },
  { id: 'wake', time: '09:30', label: 'Warm sunrise', mode: 'cct', cct: 3200, intensity: 25 },
  { id: 'ramp', time: '10:00', label: 'Morning lift', mode: 'cct', cct: 4500, intensity: 70 },
  { id: 'blue-morning', time: '10:30', label: 'Blue-balanced morning', mode: 'cct', cct: 6500, intensity: 100 },
  { id: 'growth', time: '11:00', label: 'Broad-spectrum growth', mode: 'cct', cct: 5600, intensity: 100 },
  { id: 'red-rich', time: '18:45', label: 'Red-rich broad spectrum', mode: 'cct', cct: 3200, intensity: 100 },
  { id: 'wind-down', time: '22:45', label: 'Warm wind-down', mode: 'cct', cct: 2700, intensity: 50 },
  { id: 'sunset', time: '23:00', label: 'Gentle sunset', mode: 'cct', cct: 2200, intensity: 25 },
  { id: 'night', time: '23:15', label: 'Dark period', mode: 'off', intensity: 0 }
];

const DEFAULT_CONFIG = {
  version: 21,
  scheduleEnabled: true,
  sunlightSimulationEnabled: true,
  launchAtLogin: true,
  animationFps: 15,
  partitionZones: 32,
  directBluetoothDeviceId: '',
  targetLightIds: [],
  manualOverride: null,
  schedule: DEFAULT_SCHEDULE
};

const GEL_PRESETS = Object.freeze([
  { id: 'lee-203', name: 'LEE 203 · ¼ CTB', note: 'Quarter color-temperature blue', cct: 4300, origin: 0, type: 0, color: 4 },
  { id: 'rosco-3208', name: 'Rosco 3208 · ¼ CTB', note: 'Quarter color-temperature blue', cct: 4300, origin: 1, type: 0, color: 4 }
]);

// These are deliberately moderate room-light settings, not horticultural claims.
// Mood colors run as four-hour manual overrides, including during scheduled
// darkness. `red` and `blue` retain their v0.4 IDs so active overrides migrate
// seamlessly when the app is upgraded.
const RAW_MOOD_COLOR_PRESETS = [
  { id: 'scarlet-noir', name: 'Scarlet Noir', note: 'Dark cinematic scarlet', image: '../../assets/moods/scarlet-noir.png', hue: 6, saturation: 100, intensity: 52 },
  { id: 'red', name: 'Crimson Canopy', note: 'Velvety red', image: '../../assets/moods/crimson-canopy.png', hue: 0, saturation: 100, intensity: 75 },
  { id: 'coral-dawn', name: 'Coral Dawn', note: 'Luminous coral', image: '../../assets/moods/coral-dawn.png', hue: 14, saturation: 72, intensity: 66 },
  { id: 'emberlight', name: 'Emberlight', note: 'Warm burnt orange', image: '../../assets/moods/emberlight.png', hue: 20, saturation: 94, intensity: 68 },
  { id: 'peach-glow', name: 'Peach Glow', note: 'Soft glowing peach', image: '../../assets/moods/peach-glow.png', hue: 18, saturation: 52, intensity: 68 },
  { id: 'tangerine-dream', name: 'Tangerine Dream', note: 'Juicy vivid orange', image: '../../assets/moods/tangerine-dream.png', hue: 28, saturation: 100, intensity: 72 },
  { id: 'sunlit-linen', name: 'Sunlit Linen', note: 'Quiet warm ivory', image: '../../assets/moods/sunlit-linen.png', hue: 38, saturation: 28, intensity: 62 },
  { id: 'honeyed-gold', name: 'Honeyed Gold', note: 'Mellow amber', image: '../../assets/moods/honeyed-gold.png', hue: 42, saturation: 85, intensity: 72 },
  { id: 'candlelight-grove', name: 'Candlelight Grove', note: 'Soft golden yellow', image: '../../assets/moods/candlelight-grove.png', hue: 52, saturation: 55, intensity: 65 },
  { id: 'firefly', name: 'Firefly', note: 'Enchanted citron', image: '../../assets/moods/firefly.png', hue: 64, saturation: 78, intensity: 62 },
  { id: 'lime-pulse', name: 'Lime Pulse', note: 'Electric chartreuse', image: '../../assets/moods/lime-pulse.png', hue: 82, saturation: 100, intensity: 60 },
  { id: 'moss-temple', name: 'Moss Temple', note: 'Deep muted moss', image: '../../assets/moods/moss-temple.png', hue: 92, saturation: 66, intensity: 54 },
  { id: 'forest-bath', name: 'Forest Bath', note: 'Restorative forest green', image: '../../assets/moods/forest-bath.png', hue: 118, saturation: 80, intensity: 60 },
  { id: 'emerald-cavern', name: 'Emerald Cavern', note: 'Jewel-green depths', image: '../../assets/moods/emerald-cavern.png', hue: 138, saturation: 96, intensity: 58 },
  { id: 'jade-rain', name: 'Jade Rain', note: 'Fresh green-teal', image: '../../assets/moods/jade-rain.png', hue: 155, saturation: 78, intensity: 62 },
  { id: 'mint-mirage', name: 'Mint Mirage', note: 'Airy seafoam mint', image: '../../assets/moods/mint-mirage.png', hue: 165, saturation: 55, intensity: 64 },
  { id: 'lagoon', name: 'Lagoon', note: 'Tropical turquoise', image: '../../assets/moods/lagoon.png', hue: 178, saturation: 88, intensity: 64 },
  { id: 'glacier', name: 'Glacier', note: 'Clear pale cyan', image: '../../assets/moods/glacier.png', hue: 190, saturation: 68, intensity: 64 },
  { id: 'arctic-glass', name: 'Arctic Glass', note: 'Soft icy sky blue', image: '../../assets/moods/arctic-glass.png', hue: 205, saturation: 45, intensity: 66 },
  { id: 'silver-moon', name: 'Silver Moon', note: 'Cool pearly white', image: '../../assets/moods/silver-moon.png', hue: 210, saturation: 8, intensity: 55 },
  { id: 'electric-tide', name: 'Electric Tide', note: 'Vivid cobalt', image: '../../assets/moods/electric-tide.png', hue: 220, saturation: 95, intensity: 72 },
  { id: 'sapphire-depths', name: 'Sapphire Depths', note: 'Royal deep blue', image: '../../assets/moods/sapphire-depths.png', hue: 225, saturation: 100, intensity: 58 },
  { id: 'blue', name: 'Midnight Blue', note: 'Deep nocturnal blue', image: '../../assets/moods/midnight-blue.png', hue: 238, saturation: 100, intensity: 66 },
  { id: 'indigo-eclipse', name: 'Indigo Eclipse', note: 'Shadowed blue-violet', image: '../../assets/moods/indigo-eclipse.png', hue: 245, saturation: 100, intensity: 52 },
  // The PB12's red emitter becomes perceptually dominant sooner than a generic
  // screen HSV preview suggests. Its blue-violet band therefore ends around
  // 255 degrees; recipes above that point are reserved for intentionally red-
  // purple, magenta and pink looks.
  { id: 'ultraviolet', name: 'Ultraviolet', note: 'Deep electric blue-violet', image: '../../assets/moods/ultraviolet.png', hue: 252, saturation: 100, intensity: 58 },
  { id: 'violet-hour', name: 'Violet Hour', note: 'True lavender twilight', image: '../../assets/moods/violet-hour.png', hue: 258, saturation: 82, intensity: 64 },
  { id: 'amethyst-smoke', name: 'Amethyst Smoke', note: 'Smoky lavender', image: '../../assets/moods/amethyst-smoke.png', hue: 280, saturation: 60, intensity: 62 },
  { id: 'plum-nocturne', name: 'Plum Nocturne', note: 'Velvety dark plum', image: '../../assets/moods/plum-nocturne.png', hue: 288, saturation: 82, intensity: 52 },
  { id: 'orchid-dream', name: 'Orchid Dream', note: 'Lush purple-pink', image: '../../assets/moods/orchid-dream.png', hue: 300, saturation: 76, intensity: 64 },
  { id: 'fuchsia-bloom', name: 'Fuchsia Bloom', note: 'Bold hot magenta', image: '../../assets/moods/fuchsia-bloom.png', hue: 315, saturation: 100, intensity: 72 },
  { id: 'pink-haze', name: 'Pink Haze', note: 'Soft raspberry', image: '../../assets/moods/pink-haze.png', hue: 328, saturation: 68, intensity: 64 },
  { id: 'rose-quartz', name: 'Rose Quartz', note: 'Warm rose', image: '../../assets/moods/rose-quartz.png', hue: 345, saturation: 70, intensity: 70 }
];

// Saturated moods use the corrected, physically validated Sidus global-HSI
// encoder. Near-whites and pastels use the PB12's white emitters or RGBW mixer
// where that produces a cleaner result than desaturating HSI. LEE 203 is the
// native Gel identities physically validated on the PB12. In particular,
// Violet Hour uses the fixture's calibrated 90 Lavender Gel instead of HSI
// 270 degrees, which the PB12 renders as magenta.
const MOOD_MODE_OVERRIDES = Object.freeze({
  'peach-glow': { mode: 'global-rgbw', red: 100, green: 48, blue: 14, warmWhite: 34, coolWhite: 0, intensity: 58 },
  'sunlit-linen': { mode: 'global-cct', cct: 3200, gm: 0, intensity: 56 },
  'honeyed-gold': { mode: 'global-gel', gelId: 'lee-778', gelName: 'LEE 778 · Millennium Gold', cct: 5600, origin: 0, type: 4, color: 34, intensity: 62 },
  'candlelight-grove': { mode: 'global-cct', cct: 2200, gm: 0, intensity: 54 },
  'mint-mirage': { mode: 'global-rgbw', red: 8, green: 100, blue: 58, warmWhite: 20, coolWhite: 10, intensity: 55 },
  'arctic-glass': { mode: 'global-gel', gelId: 'lee-203', gelName: 'LEE 203 · ¼ CTB', cct: 4300, origin: 0, type: 0, color: 4, intensity: 52 },
  'silver-moon': { mode: 'global-cct', cct: 7000, gm: -10, intensity: 52 },
  'electric-tide': { mode: 'global-gel', gelId: 'lee-195', gelName: 'LEE 195 · Zenith Blue', cct: 5600, origin: 0, type: 1, color: 84, intensity: 60 },
  'violet-hour': { mode: 'global-gel', gelId: 'rosco-4990', gelName: 'Rosco 4990 · 90 Lavender', cct: 5600, origin: 1, type: 1, color: 32, intensity: 60 },
  'amethyst-smoke': { mode: 'global-rgbw', red: 32, green: 8, blue: 100, warmWhite: 12, coolWhite: 6, intensity: 52 },
  'fuchsia-bloom': { mode: 'global-gel', gelId: 'rosco-2010', gelName: 'Rosco 2010 · VS Magenta', cct: 5600, origin: 1, type: 2, color: 9, intensity: 62 },
  'rose-quartz': { mode: 'global-rgbw', red: 100, green: 28, blue: 38, warmWhite: 24, coolWhite: 0, intensity: 55 }
});

function moodSummary(event) {
  if (event.mode === 'global-hsi') return `HSI ${event.hue}° · ${event.saturation}% · ${event.intensity}%`;
  if (event.mode === 'global-cct') return `${event.cct}K · ${event.gm > 0 ? '+' : ''}${event.gm || 0}% G · ${event.intensity}%`;
  if (event.mode === 'global-gel') return `${event.gelName || event.gelId} · ${event.cct}K · ${event.intensity}%`;
  return `RGBW emitter mix · ${event.intensity}%`;
}

const MOOD_COLOR_PRESETS = RAW_MOOD_COLOR_PRESETS.map((preset) => {
  const event = MOOD_MODE_OVERRIDES[preset.id] || {
    mode: 'global-hsi', hue: preset.hue, saturation: preset.saturation, intensity: preset.intensity
  };
  return { ...preset, event, detail: moodSummary(event) };
});

const MANUAL_COLOR_PRESETS = Object.fromEntries(MOOD_COLOR_PRESETS.map((preset) => [
  preset.id,
  {
    id: `manual-${preset.id}`,
    label: preset.name,
    ...preset.event
  }
]));

// The animation collection combines the fixture's physically validated native
// Pixel FX state machines with software-authored 32-section PartitionColorProtocol
// frames. Fast full-bar flash, lightning, strobe and cop-car effects remain
// deliberately excluded from four-hour bedroom overrides.
const pixelFx = (id, label, recipe) => ({
  id: `animation-${id}`, label, mode: 'pixelfx', intensity: recipe.intensity, recipe
});

// Sidus Link captures from a physical PB12 prove that command 0x23 can update
// arbitrary masks across 32 independently addressable sections. These recipes
// generate complete frames and group sections by color, typically requiring only
// two to seven accumulating writes per frame instead of 32 individual writes.
const zoneFx = (id, label, recipe) => ({
  id: `animation-${id}`, label, mode: 'zonefx', intensity: recipe.intensity, recipe
});

// Pulsing III was captured and physically validated against this PB12. It makes
// the proven low-bandwidth fixture engine available as a friendly one-click
// scene instead of requiring the Advanced Studio controls.
const pulsingFx = (id, label, { cct, intensity, rate }) => ({
  id: `animation-${id}`, label, mode: 'pulsing3', cct, intensity, rate
});

const ANIMATION_PRESETS = [
  {
    id: 'hearthside-whisper',
    name: 'Hearthside Whisper',
    note: 'A quiet amber flicker for slow evenings',
    detail: 'Five-layer 32-section ember shimmer · no blackouts',
    image: '../../assets/animations/hearthside-whisper.png',
    event: zoneFx('hearthside-whisper', 'Hearthside Whisper', {
      kind: 'hearthside-whisper', intensity: 58, durationMs: 620, seed: 0x48454152,
      colors: [{ hue: 6, saturation: 100, intensity: 8 }, { hue: 15, saturation: 98, intensity: 18 }, { hue: 25, saturation: 94, intensity: 30 }, { hue: 37, saturation: 88, intensity: 44 }, { hue: 48, saturation: 72, intensity: 58 }]
    })
  },
  {
    id: 'analog-dream',
    name: 'Analog Dream',
    note: 'Cool and warm reflections drift like an old film',
    detail: 'Five-layer 32-section cinematic reflections · cool/warm drift',
    image: '../../assets/animations/analog-dream.png',
    event: zoneFx('analog-dream', 'Analog Dream', {
      kind: 'analog-dream', intensity: 52, durationMs: 700,
      colors: [{ hue: 225, saturation: 90, intensity: 7 }, { hue: 198, saturation: 72, intensity: 34 }, { hue: 268, saturation: 62, intensity: 38 }, { hue: 18, saturation: 58, intensity: 42 }, { hue: 205, saturation: 22, intensity: 52 }]
    })
  },
  {
    id: 'cinder-cathedral',
    name: 'Cinder Cathedral',
    note: 'Copper firelight moves through deep botanical shadow',
    detail: 'Five-layer mirrored ember arches · slow seamless rise',
    image: '../../assets/animations/cinder-cathedral.png',
    event: zoneFx('cinder-cathedral', 'Cinder Cathedral', {
      kind: 'cinder-cathedral', intensity: 60, durationMs: 680,
      colors: [{ hue: 352, saturation: 100, intensity: 7 }, { hue: 5, saturation: 100, intensity: 16 }, { hue: 16, saturation: 98, intensity: 29 }, { hue: 31, saturation: 92, intensity: 44 }, { hue: 46, saturation: 78, intensity: 60 }]
    })
  },
  {
    id: 'moonbreath',
    name: 'Moonbreath',
    note: 'Pearl-white light rises and falls in one unhurried breath',
    detail: 'Pulsing III · 4300K · 20 pulses/min · smooth full-bar fade',
    image: '../../assets/animations/moonbreath.png',
    event: pulsingFx('moonbreath', 'Moonbreath', { cct: 4300, intensity: 24, rate: 20 })
  },
  {
    id: 'star-spangled-flow',
    name: 'Star-Spangled Sparkle',
    note: 'Red, white and blue pixels cross like a living flag',
    detail: 'Red · white · blue · 32-section waving flag and star field',
    image: '../../assets/animations/star-spangled-flow.png',
    // Real PB12 testing showed the third masked write could be missed at the
    // general-purpose cadence, leaving only the blue canton and white areas.
    // Commit red first and give this three-write frame enough processing time.
    event: zoneFx('star-spangled-flow', 'Star-Spangled Sparkle', {
      kind: 'flag-sparkle', intensity: 72, durationMs: 700,
      packetIntervalMs: 45, preferredWriteOrder: true,
      colors: [
        { hue: 0, saturation: 100, intensity: 72 },
        { hue: 0, saturation: 0, intensity: 46 },
        { hue: 225, saturation: 100, intensity: 44 }
      ]
    })
  },
  {
    id: 'steel-city-spark',
    name: 'Steel City Spark',
    note: 'Steelers gold, red and blue race through Pittsburgh night',
    detail: 'Steelers gold · red · blue · true 32-section three-color chase',
    image: '../../assets/animations/steel-city-spark.png',
    // These targets preserve the hue, saturation and relative value of the
    // Steelers logo palette (#FFB612, #C60C30 and #00539B). Keeping Star-
    // Spangled Sparkle's movement settings makes all three colors moving chase
    // lanes; the lower red/blue values prevent the PB12 from rendering them as
    // a pink/blue wash around a pale gold lane.
    event: zoneFx('steel-city-spark', 'Steel City Spark', { kind: 'palette-chase', intensity: 68, durationMs: 520, width: 2, direction: 1, colors: [{ hue: 43, saturation: 93, intensity: 68 }, { hue: 348, saturation: 94, intensity: 53 }, { hue: 208, saturation: 100, intensity: 42 }] })
  },
  {
    id: 'moonlit-sakura',
    name: 'Moonlit Sakura',
    note: 'Blush, pearl and indigo breathe through a midnight garden',
    detail: 'Four drifting 32-section petals · blush, pearl, lavender and indigo',
    image: '../../assets/animations/moonlit-sakura.png',
    event: zoneFx('moonlit-sakura', 'Moonlit Sakura', {
      kind: 'moonlit-sakura', intensity: 54, durationMs: 780,
      background: { hue: 245, saturation: 96, intensity: 6 },
      colors: [{ hue: 338, saturation: 68, intensity: 52 }, { hue: 350, saturation: 34, intensity: 54 }, { hue: 0, saturation: 0, intensity: 48 }, { hue: 275, saturation: 58, intensity: 46 }]
    })
  },
  {
    id: 'tidal-cathedral',
    name: 'Tidal Cathedral',
    note: 'Ocean blue, turquoise and violet currents cross in deep water',
    detail: 'Four-layer 32-section interference tide · two crossing wave fields',
    image: '../../assets/animations/tidal-cathedral.png',
    event: zoneFx('tidal-cathedral', 'Tidal Cathedral', { kind: 'tidal-interference', intensity: 60, durationMs: 560, direction: -1, colors: [{ hue: 225, saturation: 100, intensity: 12 }, { hue: 215, saturation: 96, intensity: 42 }, { hue: 182, saturation: 92, intensity: 60 }, { hue: 275, saturation: 86, intensity: 46 }] })
  },
  {
    id: 'alchemy-ember',
    name: 'Alchemy Ember',
    note: 'Molten gold sparks rise through emerald fire',
    detail: 'Emerald-and-gold 32-section rising sparks',
    image: '../../assets/animations/alchemy-ember.png',
    event: pixelFx('alchemy-ember', 'Alchemy Ember', { kind: 'fire', intensity: 52, minimum: 8, speed: 16, direction: 0, sparkColor: { hue: 45, saturation: 90, intensity: 52, cct: 86 }, baseColor: { hue: 145, saturation: 94, intensity: 24, cct: 86 } })
  },
  {
    id: 'aurora-river', name: 'Aurora River', note: 'Teal, blue and violet melt into one another', detail: 'Five-layer 32-section aurora curtains · crossing wave fields', image: '../../assets/animations/aurora-river.png',
    event: zoneFx('aurora-river', 'Aurora River', { kind: 'aurora-river', intensity: 58, durationMs: 720, colors: [{ hue: 145, saturation: 92, intensity: 30 }, { hue: 165, saturation: 88, intensity: 48 }, { hue: 188, saturation: 94, intensity: 58 }, { hue: 225, saturation: 96, intensity: 46 }, { hue: 275, saturation: 82, intensity: 42 }] })
  },
  {
    id: 'prism-parade', name: 'Prism Parade', note: 'A jewel-toned spectrum procession', detail: 'Six-color 32-section jewel procession · paired marching bands', image: '../../assets/animations/prism-parade.png',
    event: zoneFx('prism-parade', 'Prism Parade', { kind: 'palette-chase', intensity: 60, durationMs: 560, width: 2, direction: 1, colors: [{ hue: 352, saturation: 96, intensity: 54 }, { hue: 30, saturation: 96, intensity: 60 }, { hue: 62, saturation: 92, intensity: 52 }, { hue: 155, saturation: 92, intensity: 48 }, { hue: 210, saturation: 98, intensity: 50 }, { hue: 282, saturation: 90, intensity: 52 }] })
  },
  {
    id: 'lone-comet', name: 'Lone Comet', note: 'One icy traveler crosses a dark sky', detail: 'Native One-color Chase · narrow comet', image: '../../assets/animations/lone-comet.png',
    event: pixelFx('lone-comet', 'Lone Comet', { kind: 'chase', intensity: 56, speed: 230, direction: 1, group: 0, pixelLength: 1, baseColor: { hue: 235, saturation: 100, intensity: 4, cct: 0 }, colors: [{ hue: 195, saturation: 62, intensity: 56, cct: 0 }] })
  },
  {
    id: 'twin-orbit', name: 'Twin Orbit', note: 'Cyan and magenta circle in tandem', detail: 'Native Two-color Chase · cyan and magenta', image: '../../assets/animations/twin-orbit.png',
    event: pixelFx('twin-orbit', 'Twin Orbit', { kind: 'chase', intensity: 58, speed: 220, direction: 1, group: 1, pixelLength: 1, baseColor: { hue: 260, saturation: 100, intensity: 4, cct: 0 }, colors: [{ hue: 185, saturation: 100, intensity: 58, cct: 0 }, { hue: 305, saturation: 96, intensity: 56, cct: 0 }] })
  },
  {
    id: 'triple-current', name: 'Triple Current', note: 'Amber, teal and violet currents weave together', detail: 'Native Three-color Chase · three moving palette slots', image: '../../assets/animations/triple-current.png',
    event: pixelFx('triple-current', 'Triple Current', { kind: 'chase', intensity: 58, speed: 190, direction: 0, group: 1, pixelLength: 1, baseColor: { hue: 220, saturation: 100, intensity: 4, cct: 0 }, colors: [{ hue: 38, saturation: 94, intensity: 58, cct: 0 }, { hue: 170, saturation: 92, intensity: 54, cct: 0 }, { hue: 275, saturation: 92, intensity: 54, cct: 0 }] })
  },
  {
    id: 'emberstream', name: 'Emberstream', note: 'Amber sparks breathe over deep red embers', detail: 'Native Pixel Fire · warm layered flame', image: '../../assets/animations/emberstream.png',
    event: pixelFx('emberstream', 'Emberstream', { kind: 'fire', intensity: 58, minimum: 12, speed: 18, direction: 0, sparkColor: { hue: 42, saturation: 88, intensity: 58, cct: 86 }, baseColor: { hue: 8, saturation: 100, intensity: 32, cct: 86 } })
  },
  {
    id: 'neon-procession', name: 'Neon Procession', note: 'Laser cyan, acid green and hot pink race together', detail: 'Three simultaneous 32-section neon travelers · persistent color trails', image: '../../assets/animations/neon-procession.png',
    event: zoneFx('neon-procession', 'Neon Procession', { kind: 'neon-procession', intensity: 62, durationMs: 420, background: { hue: 255, saturation: 100, intensity: 3 }, colors: [{ hue: 182, saturation: 100, intensity: 62 }, { hue: 102, saturation: 100, intensity: 54 }, { hue: 322, saturation: 100, intensity: 60 }] })
  },
  {
    id: 'spectrum-silk', name: 'Spectrum Silk', note: 'A seamless rainbow glides end to end', detail: 'Native Rainbow · onboard fixture motion', image: '../../assets/animations/spectrum-silk.png',
    event: pixelFx('spectrum-silk', 'Spectrum Silk', { kind: 'rainbow', intensity: 58, speed: 170, direction: 1 })
  },
  {
    id: 'prism-continuum', name: 'Prism Continuum', note: 'Every zone holds its own hue in one unbroken spectrum', detail: '32 unique hues · seamless right-to-left spectral loop', image: '../../assets/animations/prism-continuum.png',
    event: zoneFx('prism-continuum', 'Prism Continuum', { kind: 'prism-continuum', intensity: 60, durationMs: 640, direction: -1, saturation: 100 })
  },
  {
    id: 'velvet-kaleidoscope', name: 'Velvet Kaleidoscope', note: 'A mirrored stained-glass river folds inward, then opens again', detail: 'Five-color 32-section bilateral kaleidoscope · reversible breathing motion', image: '../../assets/animations/velvet-kaleidoscope.png',
    event: zoneFx('velvet-kaleidoscope', 'Velvet Kaleidoscope', { kind: 'velvet-kaleidoscope', intensity: 58, durationMs: 720, width: 2, colors: [{ hue: 345, saturation: 92, intensity: 52 }, { hue: 44, saturation: 92, intensity: 58 }, { hue: 145, saturation: 90, intensity: 46 }, { hue: 220, saturation: 94, intensity: 50 }, { hue: 282, saturation: 88, intensity: 52 }] })
  },
  {
    id: 'celestial-orchard', name: 'Celestial Orchard', note: 'Pearl, gold and lavender stars ripen among midnight leaves', detail: 'Seeded 32-section constellation · three asynchronous stars with soft halos', image: '../../assets/animations/celestial-orchard.png',
    event: zoneFx('celestial-orchard', 'Celestial Orchard', { kind: 'celestial-orchard', intensity: 52, durationMs: 900, seed: 0, colors: [{ hue: 44, saturation: 74, intensity: 52 }, { hue: 0, saturation: 4, intensity: 46 }, { hue: 278, saturation: 58, intensity: 44 }], halo: { hue: 215, saturation: 25, intensity: 12 }, background: { hue: 135, saturation: 92, intensity: 3 } })
  },
  {
    id: 'koi-current', name: 'Koi Current', note: 'Coral and pearl travelers cross a midnight stream', detail: 'Coral-and-pearl 32-section counter-current', image: '../../assets/animations/koi-current.png',
    event: zoneFx('koi-current', 'Koi Current', { kind: 'opposed-comets', intensity: 62, durationMs: 460, width: 4, colors: [{ hue: 20, saturation: 94, intensity: 60 }, { hue: 25, saturation: 12, intensity: 52 }], background: { hue: 220, saturation: 90, intensity: 5 } })
  },
  {
    id: 'firefly-grove', name: 'Firefly Grove', note: 'Gold and leaf-green sparks wander through a dim forest', detail: 'Independent 32-section woodland fireflies', image: '../../assets/animations/firefly-grove.png',
    event: zoneFx('firefly-grove', 'Firefly Grove', { kind: 'fireflies', intensity: 56, durationMs: 780, colors: [{ hue: 52, saturation: 92, intensity: 62 }, { hue: 105, saturation: 82, intensity: 42 }], background: { hue: 125, saturation: 95, intensity: 4 } })
  },
  {
    id: 'cosmic-bloom', name: 'Cosmic Bloom', note: 'Cyan, magenta and gold blossom from the bar’s center', detail: 'Mirrored 32-section radial bloom · four concentric color rings', image: '../../assets/animations/cosmic-bloom.png',
    event: zoneFx('cosmic-bloom', 'Cosmic Bloom', { kind: 'radial-bloom', intensity: 64, durationMs: 480, width: 2, direction: 1, colors: [{ hue: 265, saturation: 100, intensity: 6 }, { hue: 180, saturation: 100, intensity: 58 }, { hue: 305, saturation: 96, intensity: 60 }, { hue: 48, saturation: 92, intensity: 56 }] })
  },
  {
    id: 'meteor-garden', name: 'Meteor Garden', note: 'Cyan, rose and gold travelers cross at three different rhythms', detail: 'Three asynchronous 32-section meteors · shared pearl trails', image: '../../assets/animations/meteor-garden.png',
    event: zoneFx('meteor-garden', 'Meteor Garden', { kind: 'meteor-garden', intensity: 64, durationMs: 360, width: 3, colors: [{ hue: 188, saturation: 76, intensity: 64 }, { hue: 332, saturation: 78, intensity: 60 }, { hue: 44, saturation: 88, intensity: 62 }], trail: { hue: 205, saturation: 18, intensity: 22 }, background: { hue: 235, saturation: 100, intensity: 3 } })
  }
];

// Retired gallery IDs remain as invisible aliases so an override already in
// progress during an upgrade migrates to its richer replacement instead of
// failing validation or replaying the old high-traffic recipe.
const LEGACY_ANIMATION_ALIASES = {
  'chromatic-wander': ANIMATION_PRESETS.find((preset) => preset.id === 'velvet-kaleidoscope')?.event,
  'rave-roulette': ANIMATION_PRESETS.find((preset) => preset.id === 'celestial-orchard')?.event,
  'photon-sprint': ANIMATION_PRESETS.find((preset) => preset.id === 'meteor-garden')?.event
};

const ANIMATION_OVERRIDE_PRESETS = Object.fromEntries(ANIMATION_PRESETS.map((preset) => [
  preset.id,
  preset.event
]));

const TIMED_OVERRIDE_PRESETS = {
  ...MANUAL_COLOR_PRESETS,
  ...ANIMATION_OVERRIDE_PRESETS,
  ...LEGACY_ANIMATION_ALIASES
};

module.exports = {
  ANIMATION_PRESETS,
  DEFAULT_CONFIG,
  DEFAULT_SCHEDULE,
  GEL_PRESETS,
  LEGACY_DEFAULT_SCHEDULE,
  MANUAL_COLOR_PRESETS,
  MOOD_COLOR_PRESETS,
  PREVIOUS_DEFAULT_SCHEDULE,
  STEPPED_DEFAULT_SCHEDULE,
  TIMED_OVERRIDE_PRESETS
};
