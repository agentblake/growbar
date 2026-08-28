'use strict';

let state;
let overrideClock;
let rhythmClock;
let lastConnectionState;
let gelLibrary = [];
const $ = (selector, root = document) => root.querySelector(selector);
const { normalizeTimeInput } = globalThis.GrowBarTime;

function describe(event) {
  if (!event) return '—';
  if (event.mode === 'off') return 'Off · uninterrupted dark period';
  if (event.mode === 'cct') return `${event.cct}K white · ${event.intensity}%`;
  if (event.mode === 'global-cct') return `${event.cct}K full-bar white · ${event.gm > 0 ? '+' : ''}${event.gm || 0}% G · ${event.intensity}%`;
  if (event.mode === 'global-hsi') return `Full-bar HSI ${event.hue}° · ${event.saturation}% · ${event.intensity}%`;
  if (event.mode === 'global-rgbw') return `Full-bar RGBW mix · ${event.intensity}%`;
  if (event.mode === 'global-xy') return `Full-bar xy ${event.x.toFixed(4)}, ${event.y.toFixed(4)} · ${event.intensity}%`;
  if (event.mode === 'global-gel') return `${event.gelId.toUpperCase()} native Gel · ${event.intensity}%`;
  if (event.mode === 'effect') return `PB12 animation · ${event.intensity}%`;
  if (event.mode === 'effectpreset') return `Curated multi-color Pixel FX · ${event.intensity}%`;
  if (event.mode === 'pixelfx') return `Native multi-color Pixel FX · ${event.intensity}%`;
  if (event.mode === 'zonefx') return `Independent ${event.partitionZones || 32}-section animation · ${event.intensity}%`;
  if (event.mode === 'partition-breath') return `${event.zones?.length || 0}/${event.partitionZones}-section Breath · ${event.intensity}%`;
  if (event.mode === 'partition-pulse') return `${event.partitionZones}-section ${event.kind} · ${event.trigger} · ${event.frequency} Hz · ${event.intensity}%`;
  if (event.mode === 'pulsing3') return `Pulsing III · ${event.cct}K · ${event.rate}/min · ${event.intensity}%`;
  if (event.mode === 'system-effect') return `${event.kind.replaceAll('-', ' ')} System effect · frequency ${event.frequency} · captured 5%`;
  if (event.mode === 'sequence') return `${event.frames?.length || 0}-step ambient color journey`;
  return `Hue ${event.hue}° · ${event.saturation}% saturation · ${event.intensity}%`;
}

function setMessage(text, kind = '') {
  const message = $('#message');
  message.textContent = text;
  message.className = kind;
}

function formatClock(dateValue) {
  const date = new Date(dateValue);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function remainingText(endsAt) {
  const remaining = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalMinutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min remaining`;
  return `${hours} hr ${minutes} min remaining`;
}

function timeMinutes(time) {
  const [hours, minutes] = String(time || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function kelvinColor(kelvin) {
  const temperature = Math.max(20, Math.min(100, Number(kelvin || 4300) / 100));
  let red;
  let green;
  let blue;
  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * ((temperature - 60) ** -0.1332047592);
    green = 288.1221695283 * ((temperature - 60) ** -0.0755148492);
    blue = 255;
  }
  const hex = (value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function graphPoints(schedule) {
  const sorted = [...schedule].sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time));
  if (!sorted.length) return [];
  const beforeMidnight = sorted.at(-1);
  return [
    { ...beforeMidnight, minute: 0 },
    ...sorted.map((event) => ({ ...event, minute: timeMinutes(event.time) })),
    { ...beforeMidnight, minute: 1440 }
  ];
}

function graphPath(points, smooth, x, y) {
  if (!points.length) return '';
  let path = `M ${x(points[0].minute)} ${y(points[0].mode === 'off' ? 0 : points[0].intensity)}`;
  for (const point of points.slice(1)) {
    const px = x(point.minute);
    const py = y(point.mode === 'off' ? 0 : point.intensity);
    path += smooth ? ` L ${px} ${py}` : ` H ${px} V ${py}`;
  }
  return path;
}

function rhythmPreset() {
  const presetId = state?.schedule.override?.presetId;
  if (!presetId) return null;
  return [...(state.presets.moods || []), ...(state.presets.animations || [])].find((preset) => preset.id === presetId) || null;
}

function renderAlternateRhythmVisual(container, current, kind) {
  container.className = `rhythm-visual rhythm-visual-${kind}`;
  const scene = document.createElement('div');
  scene.className = 'rhythm-scene';
  const preset = rhythmPreset();
  if (preset?.image) {
    const art = document.createElement('img');
    art.className = 'rhythm-scene-art';
    art.src = preset.image;
    art.alt = '';
    scene.append(art);
  } else {
    const glow = svgElement('svg', { viewBox: '0 0 900 230', 'aria-hidden': 'true' });
    const hue = Number(current?.hue ?? 220);
    const color = current?.mode?.includes('hsi') ? `hsl(${hue} 88% 58%)` : '#8bd450';
    glow.append(svgElement('circle', { cx: 450, cy: 115, r: 92, fill: color, opacity: 0.42 }));
    scene.append(glow);
  }
  const copy = document.createElement('div');
  copy.className = 'rhythm-scene-copy';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'rhythm-scene-eyebrow';
  eyebrow.textContent = kind === 'paused'
    ? 'DAILY RHYTHM PAUSED'
    : kind === 'override' ? 'FOUR-HOUR LIGHT MODE' : 'DAILY RHYTHM · COLOR MODE';
  const title = document.createElement('strong');
  title.textContent = current?.label || (kind === 'paused' ? 'Schedule is paused' : 'Alternate light mode');
  const detail = document.createElement('small');
  detail.textContent = current ? describe(current) : 'Resume the schedule to continue the sunlight curve.';
  copy.append(eyebrow, title, detail);
  scene.append(copy);
  container.append(scene);
}

function renderDarknessVisual(container) {
  container.className = 'rhythm-visual rhythm-visual-dark';
  const scene = document.createElement('div');
  scene.className = 'darkness-scene';
  const stars = document.createElement('div');
  stars.className = 'darkness-stars';
  const moon = document.createElement('div');
  moon.className = 'darkness-moon';
  const copy = document.createElement('div');
  copy.className = 'rhythm-scene-copy';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'rhythm-scene-eyebrow';
  eyebrow.textContent = 'PLANT NIGHT';
  const title = document.createElement('strong');
  title.textContent = 'Ten-hour uninterrupted darkness';
  const detail = document.createElement('small');
  detail.textContent = '23:15–09:15 · Sunrise begins at 09:15';
  copy.append(eyebrow, title, detail);
  scene.append(stars, moon, copy);
  container.append(scene);
}

function renderSunlightVisual(container, current, next) {
  container.className = 'rhythm-visual rhythm-visual-sunlight';
  const smooth = state.config.sunlightSimulationEnabled !== false;
  const header = document.createElement('div');
  header.className = 'rhythm-chart-header';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'rhythm-scene-eyebrow';
  eyebrow.textContent = smooth ? 'LIVE SUNLIGHT CURVE' : 'STEP SCHEDULE';
  const title = document.createElement('strong');
  title.textContent = current.interpolated && current.transition
    ? `${current.transition.fromLabel} → ${current.transition.toLabel}`
    : current.label;
  const detail = document.createElement('small');
  detail.textContent = smooth && next
    ? `Flowing toward ${next.cct ? `${next.cct}K · ` : ''}${next.mode === 'off' ? 'darkness' : `${next.intensity}%`} at ${next.time}`
    : `Next anchor: ${next?.time || '—'} · ${next?.label || '—'}`;
  copy.append(eyebrow, title, detail);
  const readings = document.createElement('div');
  readings.className = 'rhythm-readings';
  for (const [value, label] of [[`${current.cct}K`, 'WHITE'], [`${current.intensity}%`, 'OUTPUT']]) {
    const reading = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = label;
    reading.append(strong, small);
    readings.append(reading);
  }
  header.append(copy, readings);

  const svg = svgElement('svg', { class: 'rhythm-chart', viewBox: '0 0 920 230', role: 'img', 'aria-label': 'Daily brightness and white-temperature curve across 24 hours' });
  const defs = svgElement('defs');
  const spectrum = svgElement('linearGradient', { id: 'rhythm-spectrum', x1: 0, y1: 0, x2: 1, y2: 0 });
  const points = graphPoints(state.config.schedule);
  for (const point of points) {
    spectrum.append(svgElement('stop', {
      offset: `${(point.minute / 1440) * 100}%`,
      'stop-color': point.mode === 'cct' ? kelvinColor(point.cct) : '#17221e'
    }));
  }
  defs.append(spectrum);
  svg.append(defs);
  const left = 40;
  const right = 900;
  const top = 20;
  const bottom = 178;
  const x = (minute) => left + (minute / 1440) * (right - left);
  const y = (intensity) => bottom - (Number(intensity || 0) / 100) * (bottom - top);
  for (const level of [0, 25, 50, 75, 100]) {
    svg.append(svgElement('line', { x1: left, x2: right, y1: y(level), y2: y(level), class: 'rhythm-grid-line' }));
    const label = svgElement('text', { x: left - 8, y: y(level) + 3, class: 'rhythm-axis-label', 'text-anchor': 'end' });
    label.textContent = `${level}`;
    svg.append(label);
  }
  svg.append(svgElement('rect', { x: left, y: top, width: x(555) - left, height: bottom - top, class: 'rhythm-night-band' }));
  svg.append(svgElement('rect', { x: x(1395), y: top, width: right - x(1395), height: bottom - top, class: 'rhythm-night-band' }));
  const path = graphPath(points, smooth, x, y);
  svg.append(svgElement('path', { d: `${path} L ${right} ${bottom} L ${left} ${bottom} Z`, class: 'rhythm-area' }));
  svg.append(svgElement('path', { d: path, class: 'rhythm-line' }));
  for (const point of points.slice(1, -1)) {
    svg.append(svgElement('circle', { cx: x(point.minute), cy: y(point.mode === 'off' ? 0 : point.intensity), r: 3.2, class: 'rhythm-anchor-dot' }));
  }
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const markerX = x(minute);
  const markerY = y(current.intensity);
  svg.append(svgElement('line', { x1: markerX, x2: markerX, y1: top, y2: bottom, class: 'rhythm-now-line' }));
  svg.append(svgElement('circle', { cx: markerX, cy: markerY, r: 7, fill: kelvinColor(current.cct), class: 'rhythm-now-dot' }));
  for (const [minuteTick, text] of [[0, '00:00'], [555, '09:15'], [720, '12:00'], [1080, '18:00'], [1395, '23:15'], [1440, '24:00']]) {
    const label = svgElement('text', { x: x(minuteTick), y: 211, class: 'rhythm-time-label', 'text-anchor': minuteTick === 0 ? 'start' : minuteTick === 1440 ? 'end' : 'middle' });
    label.textContent = text;
    svg.append(label);
  }
  container.append(header, svg);
}

function renderRhythmVisual() {
  if (!state) return;
  const container = $('#rhythm-visual');
  container.replaceChildren();
  const current = state.schedule.current;
  const override = state.schedule.override;
  if (!state.config.scheduleEnabled && !override) return renderAlternateRhythmVisual(container, current, 'paused');
  if (override) return renderAlternateRhythmVisual(container, current, 'override');
  if (!current || current.mode === 'off') return renderDarknessVisual(container);
  if (current.mode === 'cct') return renderSunlightVisual(container, current, state.schedule.next);
  return renderAlternateRhythmVisual(container, current, 'alternate');
}

function renderOverride() {
  if (!state) return;
  const override = state.schedule.override;
  const statuses = [
    { element: $('#custom-status'), ready: 'Build a precise full-bar color for four hours—even during scheduled darkness.', waiting: 'Connect the light and keep Daily Rhythm active to use full-bar control.' },
    { element: $('#override-status'), ready: 'Choose a color for four hours—even during scheduled darkness. Daily Rhythm resumes automatically afterward.', waiting: 'Connect the light and keep Daily Rhythm active to use a timed mood color.' },
    { element: $('#animation-status'), ready: 'Choose an animation for four hours—even during scheduled darkness. Daily Rhythm resumes automatically afterward.', waiting: 'Connect the light and keep Daily Rhythm active to use a timed animation.' }
  ];
  const cancelButtons = [$('#cancel-custom'), $('#cancel-override'), $('#cancel-animation')];
  const buttons = $$('.preset-button');
  const canStart = state.connection.state === 'connected' && state.connection.devices?.length > 0 && state.config.scheduleEnabled;
  buttons.forEach((button) => {
    const requiredPreset = button.dataset.effectPresetName;
    const directUnsupported = (['effect', 'effectpreset', 'pixelfx'].includes(button.dataset.eventMode)
      && !state.connection.capabilities?.pixelEffects)
      || (button.dataset.eventMode === 'zonefx' && !state.connection.capabilities?.zoneEffects)
      || (button.dataset.eventMode === 'pulsing3' && !state.connection.capabilities?.pulsing3)
      || (button.dataset.eventMode === 'system-effect' && !state.connection.capabilities?.systemEffects);
    const hasRequiredPreset = !requiredPreset || (state.connection.effectPresets || []).some((preset) => preset.name.toLocaleLowerCase() === requiredPreset.toLocaleLowerCase());
    button.disabled = !canStart || !hasRequiredPreset || directUnsupported;
    button.classList.toggle('setup-required', !hasRequiredPreset || directUnsupported);
    if (directUnsupported || !hasRequiredPreset) button.title = 'This PB12 animation command is not available over GrowBar’s direct Bluetooth path.';
    else button.removeAttribute('title');
    button.classList.toggle('selected', Boolean(override && button.dataset.preset === override.presetId));
    button.setAttribute('aria-pressed', String(Boolean(override && button.dataset.preset === override.presetId)));
  });
  cancelButtons.forEach((button) => button.classList.toggle('hidden', !override));
  $('#apply-custom').disabled = !canStart || !state.connection.capabilities?.globalColor;
  $('#apply-native-fx').disabled = !canStart || !state.connection.capabilities?.nativePixelEffects;
  $('#apply-partition-breath').disabled = !canStart || !state.connection.capabilities?.partitionEffects;
  $('#apply-partition-pulse').disabled = !canStart || !state.connection.capabilities?.partitionEffects;
  $('#apply-pulsing3').disabled = !canStart || !state.connection.capabilities?.pulsing3;
  $('#apply-system-effect').disabled = !canStart || !state.connection.capabilities?.systemEffects;
  $('#apply-partition-layout').disabled = !canStart || Boolean(override);
  for (const { element: status, ready, waiting } of statuses) {
    status.className = `override-status${override ? ' is-active' : ''}`;
    if (!override) {
      $('strong', status).textContent = 'Daily Rhythm is in control';
      $('span', status).textContent = canStart ? ready : waiting;
      continue;
    }
    $('strong', status).textContent = `${override.event.label} is active`;
    $('span', status).textContent = `${remainingText(override.endsAt)} · Daily Rhythm returns at ${formatClock(override.endsAt)}.`;
  }
}

function renderCustomMode() {
  const selected = $('#custom-mode').value;
  $$('[data-custom-mode]').forEach((fields) => fields.classList.toggle('hidden', fields.dataset.customMode !== selected));
}

function syncGelFields() {
  const selected = $('#custom-gel').selectedOptions[0];
  if (!selected) return;
  $('#custom-gel-origin').value = selected.dataset.origin;
  $('#custom-gel-type').value = selected.dataset.type;
  $('#custom-gel-color').value = selected.dataset.color;
  $('#custom-gel-detail').textContent = `${selected.dataset.brand} · ${selected.dataset.series} · native address ${selected.dataset.origin}/${selected.dataset.type}/${selected.dataset.color}`;
}

function renderGelLibrary(query = '') {
  const select = $('#custom-gel');
  const previous = select.value || 'lee-203';
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = gelLibrary.filter((gel) => {
    const haystack = `${gel.brand} ${gel.series} ${gel.number} ${gel.name}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  select.replaceChildren(...filtered.map((gel) => {
    const option = document.createElement('option');
    option.value = gel.id;
    option.textContent = `${gel.brand} ${gel.number} · ${gel.name} — ${gel.series}`;
    option.dataset.origin = String(gel.origin);
    option.dataset.type = String(gel.type);
    option.dataset.color = String(gel.index);
    option.dataset.brand = gel.brand;
    option.dataset.series = gel.series;
    return option;
  }));
  const retained = filtered.some((gel) => gel.id === previous);
  if (retained) select.value = previous;
  else if (filtered.length) select.selectedIndex = 0;
  syncGelFields();
  $('#custom-gel-detail').textContent = filtered.length
    ? `${filtered.length} of ${gelLibrary.length} native gels · ${select.selectedOptions[0]?.dataset.brand || ''} ${select.selectedOptions[0]?.dataset.series || ''}`
    : `No Gel entries match “${query}”.`;
}

function customNumber(selector) {
  const input = $(selector);
  if (!input.reportValidity()) throw new Error('Correct the highlighted full-bar control value.');
  return Number(input.value);
}

function customEvent() {
  const mode = $('#custom-mode').value;
  if (mode === 'global-cct') return { mode, cct: customNumber('#custom-cct'), gm: customNumber('#custom-gm'), intensity: customNumber('#custom-cct-intensity') };
  if (mode === 'global-hsi') return {
    mode, hue: customNumber('#custom-hue'), saturation: customNumber('#custom-saturation'), intensity: customNumber('#custom-hsi-intensity')
  };
  if (mode === 'global-rgbw') return {
    mode,
    red: customNumber('#custom-red'), green: customNumber('#custom-green'), blue: customNumber('#custom-blue'),
    warmWhite: customNumber('#custom-warm-white'), coolWhite: customNumber('#custom-cool-white'),
    intensity: customNumber('#custom-rgbw-intensity')
  };
  if (mode === 'global-xy') return {
    mode, x: customNumber('#custom-x'), y: customNumber('#custom-y'), intensity: customNumber('#custom-xy-intensity')
  };
  if (mode === 'global-gel') {
    const selected = $('#custom-gel').selectedOptions[0];
    if (!selected) throw new Error('Choose a Gel from the catalog.');
    return {
      mode, gelId: selected.value, cct: customNumber('#custom-gel-cct'), origin: customNumber('#custom-gel-origin'),
      type: customNumber('#custom-gel-type'), color: customNumber('#custom-gel-color'), intensity: customNumber('#custom-gel-intensity')
    };
  }
  throw new Error('Choose a supported full-bar color model.');
}

async function startMoodPreset(button) {
  const presetId = button.dataset.preset;
  const presetName = $('strong', button).textContent;
  button.disabled = true;
  try {
    const fps = button.dataset.eventMode === 'zonefx' ? Number($('#animation-fps').value) : undefined;
    const updated = await window.growbar.startOverride(presetId, fps, Number($('#partition-zones').value));
    updateLive(updated);
    setMessage(`${presetName} started. Daily Rhythm will return automatically.`, 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { renderOverride(); }
}

function renderMoodPresets(presets) {
  const gallery = $('#mood-buttons');
  gallery.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement('button');
    button.className = 'mood-button preset-button';
    button.dataset.preset = preset.id;
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');

    const art = document.createElement('img');
    art.className = 'mood-art';
    art.src = preset.image;
    art.alt = '';
    art.loading = 'lazy';

    const copy = document.createElement('span');
    copy.className = 'mood-copy';
    const name = document.createElement('strong');
    name.textContent = preset.name;
    const note = document.createElement('small');
    note.textContent = preset.note;
    const settings = document.createElement('span');
    settings.className = 'mood-settings';
    settings.textContent = preset.detail;
    copy.append(name, note, settings);
    button.append(art, copy);
    button.addEventListener('click', () => startMoodPreset(button));
    gallery.append(button);
  }
}

function renderAnimationPresets(presets) {
  const gallery = $('#animation-buttons');
  gallery.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement('button');
    button.className = 'mood-button animation-button preset-button';
    button.dataset.preset = preset.id;
    button.dataset.eventMode = preset.event.mode;
    if (preset.event.mode === 'effectpreset') button.dataset.effectPresetName = preset.event.presetName;
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');

    const art = document.createElement('img');
    art.className = 'mood-art';
    art.src = preset.image;
    art.alt = '';
    art.loading = 'lazy';

    const copy = document.createElement('span');
    copy.className = 'mood-copy';
    const name = document.createElement('strong');
    name.textContent = preset.name;
    const note = document.createElement('small');
    note.textContent = preset.note;
    const detail = document.createElement('span');
    detail.className = 'mood-settings';
    detail.textContent = preset.detail;
    const engine = document.createElement('span');
    const engineDisplay = {
      pixelfx: ['native-engine', 'Native Pixel FX'],
      zonefx: ['zone-engine', '32-Section Studio'],
      pulsing3: ['pulse-engine', 'Smooth Pulse'],
      'system-effect': ['system-engine', 'Native System FX']
    }[preset.event.mode] || ['native-engine', 'PB12 FX'];
    engine.className = `effect-engine ${engineDisplay[0]}`;
    engine.textContent = engineDisplay[1];
    copy.append(engine, name, note, detail);
    button.append(art, copy);
    button.addEventListener('click', () => startMoodPreset(button));
    gallery.append(button);
  }
}

function colorToHsi(selector, intensity) {
  const hex = $(selector).value.replace('#', '');
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(red, green, blue); const minimum = Math.min(red, green, blue); const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue: Math.round(hue), saturation: maximum ? Math.round(delta / maximum * 100) : 0, intensity, cct: 0 };
}

function customNativeFxEvent() {
  const selection = $('#native-fx-kind').value;
  const intensity = customNumber('#native-fx-intensity');
  const speed = customNumber('#native-fx-speed');
  const direction = customNumber('#native-fx-direction');
  const palette = ['#native-fx-color-1', '#native-fx-color-2', '#native-fx-color-3'].map((selector) => colorToHsi(selector, intensity));
  let recipe;
  if (selection === 'rainbow') recipe = { kind: 'rainbow', intensity, speed, direction };
  else if (selection === 'fire') recipe = {
    kind: 'fire', intensity, speed, direction, minimum: customNumber('#native-fx-minimum'),
    sparkColor: palette[0], baseColor: colorToHsi('#native-fx-background', intensity)
  };
  else if (selection.startsWith('chase-')) recipe = {
    kind: 'chase', intensity, speed, direction,
    group: customNumber('#native-fx-group'), pixelLength: customNumber('#native-fx-length'),
    baseColor: colorToHsi('#native-fx-background', Math.max(1, Math.round(intensity * 0.15))),
    colors: palette.slice(0, Number(selection.split('-')[1]))
  };
  else recipe = {
    kind: selection, intensity, speed, direction,
    changeStyle: customNumber('#native-fx-style'), colors: palette
  };
  return { mode: 'pixelfx', intensity, recipe };
}

function selectedBreathZones(count, pattern) {
  if (pattern === 'all') return Array.from({ length: count }, (_, index) => index);
  if (pattern === 'odd') return Array.from({ length: count }, (_, index) => index).filter((index) => index % 2 === 0);
  if (pattern === 'even') return Array.from({ length: count }, (_, index) => index).filter((index) => index % 2 === 1);
  if (pattern === 'ends') return count === 4 ? [0, 3] : [0, 1, count - 2, count - 1];
  const width = Math.max(2, Math.round(count / 4));
  const start = Math.floor((count - width) / 2);
  return Array.from({ length: width }, (_, index) => start + index);
}

function customPartitionBreathEvent() {
  const partitionZones = customNumber('#partition-zones');
  const intensity = customNumber('#breath-intensity');
  const color = colorToHsi('#breath-color', intensity);
  return {
    mode: 'partition-breath', partitionZones,
    zones: selectedBreathZones(partitionZones, $('#breath-zones').value),
    hue: color.hue, saturation: color.saturation, intensity,
    minimum: customNumber('#breath-minimum'), frequency: customNumber('#breath-frequency')
  };
}

function customPulsing3Event() {
  return {
    mode: 'pulsing3', cct: customNumber('#pulsing-cct'),
    intensity: customNumber('#pulsing-intensity'), rate: customNumber('#pulsing-rate')
  };
}

function customPartitionPulseEvent() {
  const kind = $('#partition-pulse-kind').value;
  return {
    mode: 'partition-pulse', kind,
    partitionZones: customNumber('#partition-pulse-zones'),
    trigger: $('#partition-pulse-trigger').value,
    intensity: customNumber('#partition-pulse-intensity'),
    frequency: customNumber('#partition-pulse-frequency')
  };
}

function customSystemEffectEvent() {
  const kind = $('#system-effect-kind').value;
  return {
    mode: 'system-effect', kind, intensity: 5,
    frequency: kind === 'lightning' ? 1 : customNumber('#system-effect-frequency'),
    colorType: kind === 'candle' ? 0 : customNumber('#system-effect-color')
  };
}

function syncEffectConstraints() {
  const flash = $('#partition-pulse-kind').value === 'flash';
  const layout = $('#partition-pulse-zones');
  [...layout.options].forEach((option) => { option.disabled = flash && !['4', '8'].includes(option.value); });
  if (flash && !['4', '8'].includes(layout.value)) layout.value = '8';
  const systemKind = $('#system-effect-kind').value;
  $('#system-effect-frequency').disabled = systemKind === 'lightning';
  if (systemKind === 'lightning') $('#system-effect-frequency').value = '1';
  $('#system-effect-color').disabled = !['tv', 'fire'].includes(systemKind);
  if (!['tv', 'fire'].includes(systemKind)) $('#system-effect-color').value = '0';
}

function numberField(label, className, value, min, max, suffix) {
  const wrapper = document.createElement('label');
  const title = document.createElement('span');
  title.textContent = `${label} (${suffix})`;
  const input = document.createElement('input');
  input.type = 'number'; input.className = className; input.value = value; input.min = min; input.max = max; input.required = true;
  wrapper.append(title, input);
  return wrapper;
}

function renderModeFields(row, event) {
  const fields = $('.mode-fields', row);
  const mode = $('.event-mode', row).value;
  fields.replaceChildren();
  if (mode === 'cct') {
    fields.append(numberField('White', 'event-cct', event.cct ?? 5600, 2000, 10000, 'K'));
    fields.append(numberField('Brightness', 'event-intensity', event.intensity ?? 100, 0, 100, '%'));
  } else if (mode === 'hsi') {
    fields.append(numberField('Hue', 'event-hue', event.hue ?? 0, 0, 360, '°'));
    fields.append(numberField('Color', 'event-saturation', event.saturation ?? 65, 0, 100, '%'));
    fields.append(numberField('Brightness', 'event-intensity', event.intensity ?? 100, 0, 100, '%'));
  } else {
    const note = document.createElement('p'); note.className = 'muted fine'; note.textContent = 'The PB12 turns off.'; fields.append(note);
  }
}

function rowValue(row) {
  const mode = $('.event-mode', row).value;
  const timeInput = $('.event-time', row);
  timeInput.value = normalizeTimeInput(timeInput.value);
  const event = {
    id: row.dataset.id,
    time: timeInput.value,
    label: $('.event-label', row).value,
    mode,
    intensity: mode === 'off' ? 0 : Number($('.event-intensity', row).value)
  };
  if (mode === 'cct') event.cct = Number($('.event-cct', row).value);
  if (mode === 'hsi') {
    event.hue = Number($('.event-hue', row).value);
    event.saturation = Number($('.event-saturation', row).value);
  }
  return event;
}

function addRow(event, focus = false) {
  const row = $('#schedule-row-template').content.firstElementChild.cloneNode(true);
  row.dataset.id = event.id || crypto.randomUUID();
  $('.event-time', row).value = event.time || '12:00';
  $('.event-time', row).addEventListener('blur', (inputEvent) => {
    inputEvent.currentTarget.value = normalizeTimeInput(inputEvent.currentTarget.value);
  });
  $('.event-label', row).value = event.label || 'New step';
  $('.event-mode', row).value = event.mode || 'cct';
  renderModeFields(row, event);
  $('.event-mode', row).addEventListener('change', () => renderModeFields(row, { intensity: 100 }));
  $('.remove-step', row).addEventListener('click', () => {
    if ($$('.schedule-row').length <= 2) return setMessage('Keep at least two schedule steps.', 'error');
    row.remove();
  });
  $('.test-step', row).addEventListener('click', async (buttonEvent) => {
    const button = buttonEvent.currentTarget;
    button.disabled = true;
    try { await window.growbar.applyEvent(rowValue(row)); setMessage(`Applied “${$('.event-label', row).value}”.`, 'success'); }
    catch (error) { setMessage(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  $('#schedule-list').append(row);
  if (focus) $('.event-time', row).focus();
}

function $$(selector) { return [...document.querySelectorAll(selector)]; }

function renderSchedule(schedule) {
  $('#schedule-list').replaceChildren();
  schedule.forEach((event) => addRow(event));
}

function renderDevices(devices, selected) {
  const list = $('#device-list');
  list.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement('p'); empty.className = 'muted';
    empty.textContent = state.connection.directConfigured ? 'Imported light is not connected yet.' : 'No amaran mesh has been imported yet.';
    list.append(empty); return;
  }
  for (const device of devices) {
    const label = document.createElement('label'); label.className = 'device-chip';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = device.node_id; input.checked = !selected.length || selected.includes(device.node_id);
    const name = document.createElement('span'); name.textContent = device.device_name || device.name || device.node_id;
    label.append(input, name); list.append(label);
  }
}

function updateLive(nextState) {
  state = nextState;
  const connectionPanel = $('#connection-panel');
  if (state.connection.state === 'connected' && lastConnectionState !== 'connected') connectionPanel.open = false;
  if (state.connection.state !== 'connected') connectionPanel.open = true;
  lastConnectionState = state.connection.state;
  const connection = $('#connection');
  connection.className = `status status-${state.connection.state}`;
  $('strong', connection).textContent = state.connection.state === 'connected'
    ? 'PB12 connected directly'
    : state.connection.state === 'connecting' ? 'Connecting to imported PB12'
      : state.connection.state === 'setup' ? 'One-time import needed' : 'PB12 not connected';
  $('small', connection).textContent = state.connection.detail || '';
  const current = state.schedule.current;
  const next = state.schedule.next;
  const override = state.schedule.override;
  $('#current-name').textContent = current ? current.label : '—';
  $('#current-detail').textContent = current
    ? (override ? `${describe(current)} · ${remainingText(override.endsAt)}` : `${current.time} · ${describe(current)}`)
    : 'Waiting for schedule';
  const nextDisplay = override ? override.resume : next;
  $('#next-name').textContent = nextDisplay ? (override ? `Daily Rhythm · ${nextDisplay.label}` : nextDisplay.label) : '—';
  $('#next-detail').textContent = nextDisplay
    ? `${override ? formatClock(override.endsAt) : nextDisplay.time} · ${describe(nextDisplay)}`
    : '—';
  renderOverride();
  renderRhythmVisual();
  // Connection setup intentionally leaves the scheduler waiting. Do not let a
  // stale pre-connection apply error obscure live Bluetooth diagnostics.
  if (state.schedule.error && state.connection.state === 'connected') setMessage(state.schedule.error, 'error');
}

function renderAll(nextState) {
  updateLive(nextState);
  $('#schedule-enabled').checked = state.config.scheduleEnabled;
  $('#sunlight-simulation').checked = state.config.sunlightSimulationEnabled !== false;
  $('#launch-login').checked = state.config.launchAtLogin;
  $('#animation-fps').value = String(state.config.animationFps || 15);
  $('#partition-zones').value = String(state.config.partitionZones || 32);
  $('#adopt-direct').textContent = state.connection.directConfigured ? 'Re-import amaran database' : 'Import amaran database';
  $('#reconnect').classList.toggle('hidden', !state.connection.directConfigured);
  renderSchedule(state.config.schedule);
  renderDevices(state.connection.devices || [], state.config.targetLightIds);
  renderMoodPresets(state.presets.moods || []);
  renderAnimationPresets(state.presets.animations || []);
  renderOverride();
}

function collectConfig() {
  const targetBoxes = $$('#device-list input[type=checkbox]');
  const selected = targetBoxes.filter((input) => input.checked).map((input) => input.value);
  return {
    ...state.config,
    scheduleEnabled: $('#schedule-enabled').checked,
    sunlightSimulationEnabled: $('#sunlight-simulation').checked,
    launchAtLogin: $('#launch-login').checked,
    animationFps: Number($('#animation-fps').value),
    partitionZones: Number($('#partition-zones').value),
    targetLightIds: selected.length === targetBoxes.length ? [] : selected,
    schedule: $$('.schedule-row').map(rowValue)
  };
}

$('#add-step').addEventListener('click', () => addRow({ time: '12:00', label: 'New step', mode: 'cct', cct: 5600, intensity: 80 }, true));
$('#restore-defaults').addEventListener('click', () => {
  renderSchedule(state.presets.moneyTreeSleepAligned);
  setMessage('Sleep-aligned money-tree preset restored. Save to keep it.', 'success');
});
$('#save').addEventListener('click', async () => {
  const button = $('#save'); button.disabled = true;
  try { const saved = await window.growbar.saveConfig(collectConfig()); renderAll(saved); setMessage('Schedule saved and applied.', 'success'); }
  catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#reconnect').addEventListener('click', async () => {
  const button = $('#reconnect'); button.disabled = true; setMessage('Looking for the light…');
  try {
    const connected = await window.growbar.reconnect();
    renderAll(connected);
    setMessage('PB12 connected directly.', 'success');
  }
  catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#adopt-direct').addEventListener('click', async () => {
  const button = $('#adopt-direct'); button.disabled = true;
  setMessage('Reading the working amaran mesh, encrypting it locally, then connecting to the PB12…');
  try {
    const updated = await window.growbar.adoptDirect();
    renderAll(updated);
    setMessage('amaran database imported. The PB12 is connected directly and amaran Desktop is no longer needed.', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#apply-current').addEventListener('click', async () => {
  const button = $('#apply-current'); button.disabled = true;
  try { await window.growbar.applyCurrent(); setMessage('Current schedule step applied.', 'success'); }
  catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#custom-mode').addEventListener('change', renderCustomMode);
$('#custom-gel').addEventListener('change', syncGelFields);
$('#custom-gel-search').addEventListener('input', (event) => renderGelLibrary(event.currentTarget.value));
$('#partition-pulse-kind').addEventListener('change', syncEffectConstraints);
$('#system-effect-kind').addEventListener('change', syncEffectConstraints);
$('#apply-custom').addEventListener('click', async () => {
  const button = $('#apply-custom'); button.disabled = true;
  try {
    const updated = await window.growbar.startCustomOverride(customEvent());
    updateLive(updated);
    setMessage('Custom full-bar color applied. Daily Rhythm will return automatically.', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { renderOverride(); }
});

$('#apply-native-fx').addEventListener('click', async () => {
  const button = $('#apply-native-fx'); button.disabled = true;
  try {
    const updated = await window.growbar.startCustomOverride(customNativeFxEvent());
    updateLive(updated);
    setMessage('Native PB12 effect started. Daily Rhythm will return automatically.', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; renderOverride(); }
});

$('#apply-partition-layout').addEventListener('click', async () => {
  const button = $('#apply-partition-layout'); button.disabled = true;
  try {
    const result = await window.growbar.setPartitionLayout(customNumber('#partition-zones'));
    renderAll(result.state);
    setMessage(`PB12 set to ${result.zones}-section control.`, 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});

async function applyCustomAnimation(button, event, success) {
  button.disabled = true;
  try {
    const updated = await window.growbar.startCustomOverride(event);
    updateLive(updated);
    setMessage(success, 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; renderOverride(); }
}

$('#apply-partition-breath').addEventListener('click', (event) => applyCustomAnimation(
  event.currentTarget, customPartitionBreathEvent(), 'Section-selective Breath started. Daily Rhythm will return automatically.'
));
$('#apply-pulsing3').addEventListener('click', (event) => applyCustomAnimation(
  event.currentTarget, customPulsing3Event(), 'Pulsing III started. Daily Rhythm will return automatically.'
));
$('#apply-partition-pulse').addEventListener('click', (event) => applyCustomAnimation(
  event.currentTarget, customPartitionPulseEvent(), 'Partition effect started. Daily Rhythm will return automatically.'
));
$('#apply-system-effect').addEventListener('click', (event) => applyCustomAnimation(
  event.currentTarget, customSystemEffectEvent(), 'System effect started. Daily Rhythm will return automatically.'
));

async function cancelTimedOverride(button) {
  button.disabled = true;
  try {
    const updated = await window.growbar.cancelOverride();
    updateLive(updated);
    setMessage('Daily Rhythm restored.', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { button.disabled = false; }
}

$('#cancel-override').addEventListener('click', (event) => cancelTimedOverride(event.currentTarget));
$('#cancel-animation').addEventListener('click', (event) => cancelTimedOverride(event.currentTarget));
$('#cancel-custom').addEventListener('click', (event) => cancelTimedOverride(event.currentTarget));

window.growbar.onState(updateLive);
Promise.all([window.growbar.getState(), window.growbar.getGelLibrary()])
  .then(([initialState, library]) => {
    gelLibrary = Array.isArray(library) ? library : [];
    renderGelLibrary();
    syncEffectConstraints();
    renderAll(initialState);
  })
  .catch((error) => setMessage(error.message, 'error'));
overrideClock = setInterval(() => {
  if (state?.schedule.override) {
    renderOverride();
    const detail = $('#current-detail');
    detail.textContent = `${describe(state.schedule.current)} · ${remainingText(state.schedule.override.endsAt)}`;
  }
}, 1000);
rhythmClock = setInterval(renderRhythmVisual, 1000);
window.addEventListener('beforeunload', () => {
  clearInterval(overrideClock);
  clearInterval(rhythmClock);
});
