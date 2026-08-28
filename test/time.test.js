'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeTimeInput } = require('../src/renderer/time');

test('24-hour time input normalizes common shorthand without changing invalid input', () => {
  assert.equal(normalizeTimeInput('9:15'), '09:15');
  assert.equal(normalizeTimeInput('915'), '09:15');
  assert.equal(normalizeTimeInput('2100'), '21:00');
  assert.equal(normalizeTimeInput('23:15'), '23:15');
  assert.equal(normalizeTimeInput('24:00'), '24:00');
});

test('schedule editor does not use macOS-localized native time controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /class="event-time" type="text"/);
  assert.doesNotMatch(html, /class="event-time" type="time"/);
  assert.match(html, /24-hour time/);
  assert.match(html, /id="rhythm-visual"/);
  assert.match(html, /id="sunlight-simulation"/);
  assert.match(html, /DAILY RHYTHM · PRIMARY/);
});

test('mood card exposes a generated gallery, countdown status, and an early return control', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const defaults = require('../src/defaults');
  assert.equal(defaults.MOOD_COLOR_PRESETS.length, 32);
  assert.equal(defaults.MOOD_COLOR_PRESETS.some((preset) => preset.id === 'red'), true);
  assert.equal(defaults.MOOD_COLOR_PRESETS.some((preset) => preset.id === 'blue'), true);
  assert.equal(new Set(defaults.MOOD_COLOR_PRESETS.map((preset) => preset.image)).size, 32);
  assert.match(html, /id="mood-buttons"/);
  assert.match(html, /id="override-status"/);
  assert.match(html, /id="cancel-override"/);
  assert.match(html, /four hours.even during scheduled darkness/);
  assert.doesNotMatch(html, /never continue into the plant.s scheduled dark period/);
});

test('full-bar control exposes the physically validated global color models, native ±G and Gel', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  assert.match(html, /id="custom-mode"/);
  for (const mode of ['global-hsi', 'global-cct', 'global-gel', 'global-rgbw', 'global-xy']) assert.match(html, new RegExp(`value="${mode}"`));
  assert.match(html, /id="custom-gm"/);
  assert.match(html, /id="apply-custom"/);
  assert.match(html, /id="cancel-custom"/);
  assert.match(renderer, /startCustomOverride\(customEvent\(\)\)/);
  assert.match(preload, /override:start-custom/);
  assert.match(html, /id="custom-gel"/);
  assert.match(html, /id="custom-gel-search"/);
  assert.match(preload, /getGelLibrary:\s*\(\) => ipcRenderer\.invoke\('gel-library:get'\)/);
  assert.doesNotMatch(preload, /require\(['"]\.\//, 'sandboxed preload must not require local modules');
  assert.match(renderer, /getGelLibrary\(\)/);
});

test('sandboxed preload exposes database import and Gel catalog IPC without local requires', async () => {
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  let bridge;
  const invocations = [];
  vm.runInNewContext(preload, {
    require(specifier) {
      assert.equal(specifier, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: {
          invoke: (...args) => { invocations.push(args); return Promise.resolve(args[0]); },
          on() {},
          removeListener() {}
        }
      };
    }
  });
  assert.ok(bridge, 'preload bridge should initialize in the sandbox');
  assert.equal(await bridge.getGelLibrary(), 'gel-library:get');
  assert.equal(await bridge.adoptDirect(), 'direct:adopt');
  assert.deepEqual(invocations.map(([channel]) => channel), ['gel-library:get', 'direct:adopt']);
});

test('every mood preset has bundled artwork and a validated global color recipe', () => {
  const { MOOD_COLOR_PRESETS } = require('../src/defaults');
  assert.equal(new Set(MOOD_COLOR_PRESETS.map((preset) => preset.id)).size, MOOD_COLOR_PRESETS.length);
  for (const preset of MOOD_COLOR_PRESETS) {
    const assetPath = path.join(__dirname, '../src/renderer', preset.image);
    assert.equal(fs.existsSync(assetPath), true, `${preset.name} image is missing`);
    assert.ok(['global-hsi', 'global-cct', 'global-rgbw', 'global-gel'].includes(preset.event.mode));
    assert.ok(preset.event.intensity >= 0 && preset.event.intensity <= 100);
    assert.ok(preset.detail.length > 4);
  }
  assert.ok(Math.min(...MOOD_COLOR_PRESETS.map((preset) => preset.saturation)) <= 10, 'gallery should include a near-neutral mood');
  assert.ok(Math.max(...MOOD_COLOR_PRESETS.map((preset) => preset.saturation)) === 100, 'gallery should include fully saturated moods');
});

test('expanded mood gallery fills the color wheel without replacing legacy presets', () => {
  const { MOOD_COLOR_PRESETS } = require('../src/defaults');
  const ids = new Set(MOOD_COLOR_PRESETS.map((preset) => preset.id));
  for (const legacyId of ['red', 'emberlight', 'honeyed-gold', 'firefly', 'forest-bath', 'jade-rain', 'lagoon', 'glacier', 'electric-tide', 'blue', 'violet-hour', 'ultraviolet', 'orchid-dream', 'fuchsia-bloom', 'pink-haze', 'rose-quartz']) {
    assert.equal(ids.has(legacyId), true, `${legacyId} should remain available`);
  }
  for (const newId of ['coral-dawn', 'tangerine-dream', 'lime-pulse', 'mint-mirage', 'sapphire-depths', 'indigo-eclipse', 'amethyst-smoke', 'silver-moon']) {
    assert.equal(ids.has(newId), true, `${newId} should be part of the expanded spectrum`);
  }
});

test('violet-family moods stay blue-violet until the deliberately magenta presets begin', () => {
  const { MOOD_COLOR_PRESETS } = require('../src/defaults');
  const ultraviolet = MOOD_COLOR_PRESETS.find((preset) => preset.id === 'ultraviolet');
  const violet = MOOD_COLOR_PRESETS.find((preset) => preset.id === 'violet-hour');
  const amethyst = MOOD_COLOR_PRESETS.find((preset) => preset.id === 'amethyst-smoke');
  const fuchsia = MOOD_COLOR_PRESETS.find((preset) => preset.id === 'fuchsia-bloom');
  assert.deepEqual(
    { hue: ultraviolet.hue, saturation: ultraviolet.saturation, intensity: ultraviolet.intensity },
    { hue: 252, saturation: 100, intensity: 58 }
  );
  assert.equal(ultraviolet.event.mode, 'global-hsi');
  assert.deepEqual(
    { mode: violet.event.mode, gelId: violet.event.gelId, cct: violet.event.cct, color: violet.event.color },
    { mode: 'global-gel', gelId: 'rosco-4990', cct: 5600, color: 32 }
  );
  assert.deepEqual(
    { red: amethyst.event.red, green: amethyst.event.green, blue: amethyst.event.blue },
    { red: 32, green: 8, blue: 100 }
  );
  assert.equal(fuchsia.event.gelId, 'rosco-2010');
});

test('mood audit anchors gold, cobalt, lavender and magenta to physically checked native Gels', () => {
  const { MOOD_COLOR_PRESETS } = require('../src/defaults');
  const byId = Object.fromEntries(MOOD_COLOR_PRESETS.map((preset) => [preset.id, preset]));
  assert.deepEqual(
    ['honeyed-gold', 'electric-tide', 'violet-hour', 'fuchsia-bloom'].map((id) => byId[id].event.gelId),
    ['lee-778', 'lee-195', 'rosco-4990', 'rosco-2010']
  );
  for (const id of ['honeyed-gold', 'electric-tide', 'violet-hour', 'fuchsia-bloom']) {
    assert.match(byId[id].detail, /\d+ ·/);
    assert.equal(byId[id].event.mode, 'global-gel');
  }
});

test('mood hue ordering follows perceptual color names instead of a mechanically even wheel', () => {
  const { MOOD_COLOR_PRESETS } = require('../src/defaults');
  const byId = Object.fromEntries(MOOD_COLOR_PRESETS.map((preset) => [preset.id, preset]));
  const ordered = ['firefly', 'lime-pulse', 'moss-temple', 'forest-bath', 'emerald-cavern', 'jade-rain', 'lagoon', 'glacier'];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(byId[ordered[index]].hue > byId[ordered[index - 1]].hue, `${ordered[index]} should advance around the color wheel`);
  }
  assert.ok(byId['ultraviolet'].hue <= 255, 'PB12 blue-violet must stay below its magenta crossover');
  assert.ok(byId['plum-nocturne'].hue > byId['ultraviolet'].hue, 'plum should intentionally contain more red than ultraviolet');
});

test('animation card combines validated native, pulse, and reliable custom 32-section recipes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const { ANIMATION_PRESETS } = require('../src/defaults');
  assert.equal(ANIMATION_PRESETS.length, 24);
  assert.match(html, /id="animation-buttons"/);
  assert.match(html, /id="animation-status"/);
  assert.match(html, /id="cancel-animation"/);
  assert.match(html, /id="animation-fps"/);
  assert.match(html, /24 FPS · Smooth/);
  assert.match(html, /30 FPS · Fast/);
  assert.match(html, /60 FPS · When safe/);
  assert.doesNotMatch(html, /Turbo|Warp|Hyper/);
  assert.doesNotMatch(html, /32-ZONE PB12 ANIMATION READY/i);
  assert.match(html, /id="native-fx-kind"/);
  assert.match(html, /Native PB12 FX/);
  assert.match(html, /Section Studio/);
  assert.match(html, /id="partition-zones"/);
  assert.match(html, /id="apply-partition-breath"/);
  assert.match(html, /id="apply-partition-pulse"/);
  assert.match(html, /id="apply-pulsing3"/);
  assert.match(html, /id="apply-system-effect"/);
  for (const kind of ['candle', 'tv', 'fire', 'strobe', 'lightning', 'paparazzi', 'faulty-bulb']) {
    assert.match(html, new RegExp(`value="${kind}"`));
  }
  const flag = ANIMATION_PRESETS.find((preset) => preset.id === 'star-spangled-flow');
  assert.equal(flag.event.mode, 'zonefx');
  assert.equal(flag.event.recipe.kind, 'flag-sparkle');
  assert.deepEqual(flag.event.recipe.colors.map((color) => color.hue), [0, 0, 225]);
  assert.deepEqual(flag.event.recipe.colors.map((color) => color.intensity), [72, 46, 44]);
  assert.equal(flag.event.recipe.packetIntervalMs, 45);
  assert.equal(flag.event.recipe.preferredWriteOrder, true);
  const steelers = ANIMATION_PRESETS.find((preset) => preset.id === 'steel-city-spark');
  assert.equal(steelers.event.recipe.kind, 'palette-chase');
  assert.deepEqual(steelers.event.recipe.colors, [
    { hue: 43, saturation: 93, intensity: 68 },
    { hue: 348, saturation: 94, intensity: 53 },
    { hue: 208, saturation: 100, intensity: 42 }
  ]);
  assert.equal(ANIMATION_PRESETS.find((preset) => preset.id === 'spectrum-silk').event.recipe.kind, 'rainbow');
  assert.equal(ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'pixelfx').length, 6);
  assert.equal(ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'zonefx').length, 17);
  assert.equal(ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'system-effect').length, 0);
  assert.equal(ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'pulsing3').length, 1);
  for (const id of ['hearthside-whisper', 'analog-dream', 'cinder-cathedral', 'moonbreath']) {
    assert.ok(ANIMATION_PRESETS.some((preset) => preset.id === id), `${id} should be part of the friendly preset gallery`);
  }
  assert.deepEqual(new Set(ANIMATION_PRESETS.filter((preset) => preset.event.mode === 'pixelfx').map((preset) => preset.event.recipe.kind)), new Set(['chase', 'rainbow', 'fire']));
  assert.equal(new Set(ANIMATION_PRESETS.map((preset) => preset.image)).size, 24);
  const meteor = ANIMATION_PRESETS.find((preset) => preset.id === 'meteor-garden');
  assert.equal(meteor.event.recipe.kind, 'meteor-garden');
  assert.equal(meteor.event.recipe.durationMs, 360);
  const prism = ANIMATION_PRESETS.find((preset) => preset.id === 'prism-continuum');
  assert.equal(prism.event.recipe.kind, 'prism-continuum');
  assert.equal(prism.event.recipe.direction, -1);
  const velvet = ANIMATION_PRESETS.find((preset) => preset.id === 'velvet-kaleidoscope');
  assert.equal(velvet.event.recipe.kind, 'velvet-kaleidoscope');
  assert.equal(velvet.event.recipe.colors.length, 5);
  const orchard = ANIMATION_PRESETS.find((preset) => preset.id === 'celestial-orchard');
  assert.equal(orchard.event.recipe.kind, 'celestial-orchard');
  assert.equal(orchard.event.recipe.durationMs, 900);
  for (const preset of ANIMATION_PRESETS.filter((candidate) => candidate.event.mode === 'pixelfx')) {
    if (['fade', 'cycle'].includes(preset.event.recipe.kind)) {
      assert.ok(preset.event.recipe.colors.length <= 4, `${preset.name} exceeds the documented PB12 palette size`);
    }
  }
  for (const preset of ANIMATION_PRESETS) {
    const assetPath = path.join(__dirname, '../src/renderer', preset.image);
    assert.equal(fs.existsSync(assetPath), true, `${preset.name} image is missing`);
  }
});

test('connection card is first and exposes only the one-time amaran database import path', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const bluetooth = fs.readFileSync(path.join(__dirname, '../native/GrowBarBluetoothBridge.m'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  assert.match(html, /id="adopt-direct"/);
  assert.match(html, /Import amaran database/);
  assert.match(html, /<details id="connection-panel" class="panel connection-panel" open>/);
  assert.match(html, /<summary class="panel-heading connection-heading">/);
  assert.ok(html.indexOf('class="panel connection-panel"') < html.indexOf('class="now-grid"'));
  assert.doesNotMatch(html, /id="pair-direct"/);
  assert.doesNotMatch(html, /id="sidus-bt-uid"/);
  assert.doesNotMatch(html, /id="bluetooth-candidates"/);
  assert.doesNotMatch(html, /id="connection-mode"/);
  assert.doesNotMatch(html, /id="websocket-url"/);
  assert.match(bluetooth, /UUIDWithString:@"1828"/);
  assert.match(bluetooth, /scanForPeripheralsWithServices:@\[self\.targetService\]/);
  assert.match(bluetooth, /setNotifyValue:YES/);
  assert.doesNotMatch(html, /bluetooth\.js/);
  assert.match(renderer, /state\.connection\.state === 'connected'.*connectionPanel\.open = false/);
  assert.match(renderer, /state\.connection\.state !== 'connected'.*connectionPanel\.open = true/);
});

test('configured Bluetooth reconnects automatically at launch, wake, and after failures', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /scheduleNativeReconnect\(0\);/);
  assert.match(main, /powerMonitor\.on\('resume', \(\) => scheduleNativeReconnect\(0\)\)/);
  assert.match(main, /Math\.min\(30000, 2000 \* \(2 \*\*/);
  assert.match(main, /catch \(error\)[\s\S]*scheduleNativeReconnect\(\);[\s\S]*throw error/);
});

test('stable UI excludes the retired Protocol Lab and prevents horizontal overflow', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
  for (const source of [html, main, preload, renderer]) assert.doesNotMatch(source, /research-panel|Protocol Lab|research:/);
  assert.match(css, /html, body \{ width: 100%; max-width: 100%; overflow-x: clip; \}/);
  assert.match(css, /grid-template-columns: 100px minmax\(0, 1fr\) 130px auto/);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/protocol-research.js')), false);
});
