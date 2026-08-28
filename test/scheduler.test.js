'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activeEvent,
  activeManualOverride,
  createManualOverride,
  eventMinutes,
  interpolatedEvent,
  nextEvent,
  rhythmAt,
  ScheduleRunner
} = require('../src/scheduler');

const schedule = [
  { id: 'on', time: '07:00', mode: 'cct' },
  { id: 'red', time: '14:00', mode: 'hsi' },
  { id: 'off', time: '21:00', mode: 'off' }
];

function localDate(hours, minutes) {
  const date = new Date(2026, 7, 23, hours, minutes, 0, 0);
  return date;
}

test('active step wraps across midnight', () => {
  assert.equal(activeEvent(schedule, localDate(6, 30)).id, 'off');
  assert.equal(activeEvent(schedule, localDate(14, 0)).id, 'red');
  assert.equal(nextEvent(schedule, localDate(22, 0)).id, 'on');
});

test('default sleep-aligned window is fourteen hours with ten hours dark', () => {
  const { DEFAULT_SCHEDULE } = require('../src/defaults');
  const first = eventMinutes(DEFAULT_SCHEDULE[0]);
  const off = eventMinutes(DEFAULT_SCHEDULE.at(-1));
  assert.equal(off - first, 14 * 60);
  assert.equal((24 * 60) - (off - first), 10 * 60);
});

test('smooth sunlight continuously interpolates the default sunrise, daytime CCT, and sunset', () => {
  const { DEFAULT_SCHEDULE } = require('../src/defaults');
  const sunrise = interpolatedEvent(DEFAULT_SCHEDULE, localDate(9, 22));
  assert.equal(sunrise.mode, 'cct');
  assert.equal(sunrise.cct, 2670);
  assert.equal(sunrise.intensity, 12);
  assert.equal(sunrise.interpolated, true);
  assert.equal(sunrise.transition.toTime, '09:30');

  const daytime = interpolatedEvent(DEFAULT_SCHEDULE, new Date(2026, 7, 23, 14, 52, 30));
  assert.equal(daytime.cct, 4400);
  assert.equal(daytime.intensity, 100);

  const sunset = interpolatedEvent(DEFAULT_SCHEDULE, new Date(2026, 7, 23, 23, 7, 30));
  assert.equal(sunset.cct, 2200);
  assert.equal(sunset.intensity, 13);
});

test('smooth sunlight preserves the complete 23:15–09:15 dark window and can be disabled', () => {
  const { DEFAULT_SCHEDULE } = require('../src/defaults');
  assert.equal(rhythmAt(DEFAULT_SCHEDULE, localDate(3, 0), true).current.mode, 'off');
  assert.equal(rhythmAt(DEFAULT_SCHEDULE, localDate(9, 14), true).current.mode, 'off');
  assert.equal(rhythmAt(DEFAULT_SCHEDULE, localDate(9, 15), true).current.intensity, 0);
  const stepped = rhythmAt(DEFAULT_SCHEDULE, localDate(9, 45), false).current;
  assert.equal(stepped.id, 'wake');
  assert.equal(stepped.cct, 3200);
  assert.equal(stepped.intensity, 25);
});

test('runner applies only once per schedule step unless reset', async () => {
  let calls = 0;
  const runner = new ScheduleRunner({
    getConfig: () => ({ scheduleEnabled: true, schedule, targetLightIds: [] }),
    applyEvent: async () => { calls += 1; },
    now: () => localDate(15, 0)
  });
  await runner.tick();
  await runner.tick();
  assert.equal(calls, 1);
  await runner.reset();
  assert.equal(calls, 2);
});

test('runner reapplies only when a rounded sunlight output actually changes', async () => {
  const { DEFAULT_SCHEDULE } = require('../src/defaults');
  let now = localDate(9, 22);
  const calls = [];
  const runner = new ScheduleRunner({
    getConfig: () => ({
      scheduleEnabled: true,
      sunlightSimulationEnabled: true,
      schedule: DEFAULT_SCHEDULE,
      targetLightIds: []
    }),
    applyEvent: async (event) => calls.push([event.cct, event.intensity]),
    now: () => now
  });
  await runner.tick();
  await runner.tick();
  now = localDate(9, 23);
  await runner.tick();
  assert.deepEqual(calls, [[2670, 12], [2730, 13]]);
});

test('manual override is active only inside its complete four-hour window', () => {
  const override = {
    event: { id: 'manual-blue', mode: 'hsi' },
    startedAt: localDate(12, 0).toISOString(),
    endsAt: localDate(16, 0).toISOString()
  };
  assert.equal(activeManualOverride(override, localDate(15, 59)).event.id, 'manual-blue');
  assert.equal(activeManualOverride(override, localDate(16, 0)), null);
});

test('a timed preset started during scheduled darkness receives a full four hours', () => {
  const startedAt = localDate(23, 30);
  assert.equal(activeEvent(schedule, startedAt).mode, 'off');
  const override = createManualOverride('blue', { id: 'manual-blue', mode: 'hsi' }, startedAt);
  assert.equal(Date.parse(override.endsAt) - Date.parse(override.startedAt), 4 * 60 * 60 * 1000);
  assert.equal(new Date(override.endsAt).getHours(), 3);
  assert.equal(activeManualOverride(override, localDate(24, 30)).presetId, 'blue');
});

test('runner keeps an override active across scheduled darkness and restores Off when it expires', async () => {
  let now = localDate(20, 0);
  const calls = [];
  const config = {
    scheduleEnabled: true,
    schedule,
    targetLightIds: [],
    manualOverride: {
      presetId: 'blue',
      event: { id: 'manual-blue', label: 'Room Blue', mode: 'hsi', hue: 240, saturation: 100, intensity: 75 },
      startedAt: now.toISOString(),
      endsAt: localDate(24, 0).toISOString()
    }
  };
  const runner = new ScheduleRunner({
    getConfig: () => config,
    applyEvent: async (event) => calls.push(event.id),
    onOverrideExpired: () => { config.manualOverride = null; },
    now: () => now
  });
  await runner.tick();
  now = localDate(22, 0);
  await runner.tick();
  assert.deepEqual(calls, ['manual-blue']);
  now = localDate(24, 1);
  await runner.tick();
  assert.deepEqual(calls, ['manual-blue', 'off']);
  assert.equal(config.manualOverride, null);
});

test('runner preserves a manual color and returns to the current schedule after expiry', async () => {
  let now = localDate(12, 0);
  const calls = [];
  const config = {
    scheduleEnabled: true,
    schedule,
    targetLightIds: [],
    manualOverride: {
      presetId: 'red',
      event: { id: 'manual-red', label: 'Room Red', mode: 'hsi', hue: 0, saturation: 100, intensity: 75 },
      startedAt: now.toISOString(),
      endsAt: localDate(16, 0).toISOString()
    }
  };
  const runner = new ScheduleRunner({
    getConfig: () => config,
    applyEvent: async (event) => calls.push(event.id),
    onOverrideExpired: () => { config.manualOverride = null; },
    now: () => now
  });
  await runner.tick();
  await runner.tick();
  assert.deepEqual(calls, ['manual-red']);
  now = localDate(16, 1);
  await runner.tick();
  assert.deepEqual(calls, ['manual-red', 'red']);
  assert.equal(config.manualOverride, null);
});

test('manual reset reports an apply failure while background ticks remain non-throwing', async () => {
  const runner = new ScheduleRunner({
    getConfig: () => ({ scheduleEnabled: true, schedule, targetLightIds: [], manualOverride: null }),
    applyEvent: async () => { throw new Error('light unavailable'); },
    now: () => localDate(15, 0)
  });
  await runner.tick();
  await assert.rejects(() => runner.reset(), /light unavailable/);
});

test('runner waits quietly until its transport is ready', async () => {
  let ready = false;
  let calls = 0;
  const states = [];
  const runner = new ScheduleRunner({
    getConfig: () => ({ scheduleEnabled: true, schedule, targetLightIds: [], manualOverride: null }),
    applyEvent: async () => { calls += 1; },
    shouldApply: () => ready,
    onState: (state) => states.push(state),
    now: () => localDate(15, 0)
  });
  await runner.tick(true);
  assert.equal(calls, 0);
  assert.equal(states.at(-1).error, undefined);
  ready = true;
  await runner.reset();
  assert.equal(calls, 1);
});
