'use strict';

const MANUAL_OVERRIDE_MS = 4 * 60 * 60 * 1000;

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
}

function eventMinutes(event) {
  const [hours, minutes] = event.time.split(':').map(Number);
  return hours * 60 + minutes;
}

function activeEvent(schedule, date = new Date()) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const sorted = [...schedule].sort((a, b) => eventMinutes(a) - eventMinutes(b));
  const now = minutesSinceMidnight(date);
  return [...sorted].reverse().find((event) => eventMinutes(event) <= now) || sorted[sorted.length - 1];
}

function nextEvent(schedule, date = new Date()) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const sorted = [...schedule].sort((a, b) => eventMinutes(a) - eventMinutes(b));
  const now = minutesSinceMidnight(date);
  return sorted.find((event) => eventMinutes(event) > now) || sorted[0];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function rounded(value, increment = 1) {
  return Math.round(value / increment) * increment;
}

function transitionPosition(current, next, date) {
  let from = eventMinutes(current);
  let to = eventMinutes(next);
  let now = minutesSinceMidnight(date);
  if (to <= from) to += 24 * 60;
  if (now < from) now += 24 * 60;
  return clamp((now - from) / Math.max(1, to - from), 0, 1);
}

function interpolateHue(from, to, progress) {
  const delta = ((to - from + 540) % 360) - 180;
  return rounded((from + delta * progress + 360) % 360);
}

// Produces the actual steady PB12 setting for this instant. Values are rounded
// to hardware-meaningful increments so the light moves gently without flooding
// Bluetooth Mesh with writes that cannot create a visible change.
function interpolatedEvent(schedule, date = new Date()) {
  const current = activeEvent(schedule, date);
  const next = nextEvent(schedule, date);
  if (!current || !next || current.mode === 'off') return current;
  const progress = transitionPosition(current, next, date);
  const transition = {
    fromId: current.id,
    fromLabel: current.label,
    toId: next.id,
    toLabel: next.label,
    toTime: next.time,
    progress
  };

  if (current.mode === 'cct' && (next.mode === 'cct' || next.mode === 'off')
    && Number.isFinite(current.cct) && Number.isFinite(current.intensity)) {
    const targetCct = next.mode === 'cct' && Number.isFinite(next.cct) ? next.cct : current.cct;
    const targetIntensity = next.mode === 'cct' && Number.isFinite(next.intensity) ? next.intensity : 0;
    return {
      ...current,
      cct: clamp(rounded(lerp(current.cct, targetCct, progress), 10), 2000, 10000),
      intensity: clamp(rounded(lerp(current.intensity, targetIntensity, progress)), 0, 100),
      interpolated: true,
      transition
    };
  }

  if (current.mode === 'hsi' && next.mode === 'hsi'
    && [current.hue, current.saturation, current.intensity, next.hue, next.saturation, next.intensity].every(Number.isFinite)) {
    return {
      ...current,
      hue: interpolateHue(current.hue, next.hue, progress),
      saturation: clamp(rounded(lerp(current.saturation, next.saturation, progress)), 0, 100),
      intensity: clamp(rounded(lerp(current.intensity, next.intensity, progress)), 0, 100),
      interpolated: true,
      transition
    };
  }

  return current;
}

function rhythmAt(schedule, date = new Date(), smooth = true) {
  const anchor = activeEvent(schedule, date);
  const next = nextEvent(schedule, date);
  const current = smooth ? interpolatedEvent(schedule, date) : anchor;
  return {
    current,
    next,
    anchor,
    smooth: Boolean(smooth),
    progress: anchor && next ? transitionPosition(anchor, next, date) : 0
  };
}

function eventOutputKey(event) {
  if (!event) return 'none';
  if (event.mode === 'off') return 'off';
  if (event.mode === 'cct') return `cct:${event.cct}:${event.intensity}`;
  if (event.mode === 'hsi') return `hsi:${event.hue}:${event.saturation}:${event.intensity}`;
  return `${event.mode}:${event.id}`;
}

function activeManualOverride(override, date = new Date()) {
  if (!override || !override.event || !override.startedAt || !override.endsAt) return null;
  const now = date.getTime();
  const startedAt = Date.parse(override.startedAt);
  const endsAt = Date.parse(override.endsAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || now < startedAt || now >= endsAt) return null;
  return override;
}

function createManualOverride(presetId, event, date = new Date()) {
  const startedAt = new Date(date);
  if (!Number.isFinite(startedAt.getTime())) throw new Error('Invalid timed light override start.');
  return {
    presetId,
    event: { ...event },
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + MANUAL_OVERRIDE_MS).toISOString()
  };
}

class ScheduleRunner {
  constructor({ getConfig, applyEvent, onState, onOverrideExpired, shouldApply, intervalMs = 15000, now = () => new Date() }) {
    this.getConfig = getConfig;
    this.applyEvent = applyEvent;
    this.onState = onState || (() => {});
    this.onOverrideExpired = onOverrideExpired || (() => {});
    this.shouldApply = shouldApply || (() => true);
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
    this.lastKey = '';
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick(true);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(force = false, propagateError = false) {
    if (this.running) return;
    let config = this.getConfig();
    const now = this.now();
    let override = activeManualOverride(config.manualOverride, now);
    if (config.manualOverride && !override) {
      await this.onOverrideExpired(config.manualOverride);
      config = this.getConfig();
    }

    const rhythm = rhythmAt(config.schedule, now, config.sunlightSimulationEnabled !== false);
    const scheduledCurrent = rhythm.current;
    const scheduledNext = rhythm.next;
    override = activeManualOverride(config.manualOverride, now);
    const current = override ? override.event : scheduledCurrent;
    const resume = override
      ? rhythmAt(config.schedule, new Date(override.endsAt), config.sunlightSimulationEnabled !== false).current
      : null;
    this.onState({ current, next: scheduledNext, enabled: config.scheduleEnabled, rhythm, override: override ? { ...override, resume } : null });
    if ((!config.scheduleEnabled && !override) || !current) return;
    const day = now.toLocaleDateString('en-CA');
    const key = override ? `override:${override.startedAt}:${current.id}` : `${day}:${eventOutputKey(current)}`;
    if (!force && key === this.lastKey) return;
    // A disconnected light is a waiting state, not a failed schedule. The
    // connection owner calls reset() as soon as transport setup completes.
    if (!this.shouldApply()) return;

    this.running = true;
    try {
      await this.applyEvent(current, config.targetLightIds);
      this.lastKey = key;
      this.onState({ current, next: scheduledNext, enabled: config.scheduleEnabled, rhythm, override: override ? { ...override, resume } : null, appliedAt: new Date().toISOString() });
    } catch (error) {
      this.lastKey = '';
      this.onState({ current, next: scheduledNext, enabled: config.scheduleEnabled, rhythm, override: override ? { ...override, resume } : null, error: error.message });
      if (propagateError) throw error;
    } finally {
      this.running = false;
    }
  }

  reset() {
    this.lastKey = '';
    return this.tick(true, true);
  }
}

module.exports = {
  ScheduleRunner,
  activeEvent,
  activeManualOverride,
  createManualOverride,
  eventMinutes,
  eventOutputKey,
  interpolatedEvent,
  nextEvent,
  rhythmAt,
  transitionPosition
};
