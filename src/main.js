'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, Tray } = require('electron');
const { ConfigStore } = require('./config');
const { DirectBluetoothClient } = require('./direct');
const { DirectCredentialStore, importBestAmaranCredentials } = require('./direct-credentials');
const { GEL_LIBRARY } = require('./gel-library');
const { NativeBluetoothTransport, defaultBridgePath } = require('./native-bluetooth');
const { ANIMATION_PRESETS, DEFAULT_SCHEDULE, GEL_PRESETS, MOOD_COLOR_PRESETS, TIMED_OVERRIDE_PRESETS } = require('./defaults');
const { ScheduleRunner, activeEvent, activeManualOverride, createManualOverride, nextEvent, rhythmAt } = require('./scheduler');

const execFileAsync = promisify(execFile);

app.commandLine.appendSwitch('disable-renderer-backgrounding');

let window;
let tray;
let quitting = false;
let store;
let credentialStore;
let client;
let runner;
let connection = {
  state: 'setup',
  detail: 'Import the paired PB12 from amaran Desktop once to begin.',
  transport: 'direct',
  devices: [],
  effectPresets: [],
  capabilities: { cct: true, hsi: true, rgbw: true, xy: true, globalColor: true, sequences: true, pixelEffects: true, zoneEffects: true }
};
let scheduleState = {};
let nativeBluetooth = null;
let nativeReconnectTimer = null;
let nativeReconnectAttempt = 0;
let activeConnectPromise = null;

function emitState() {
  if (window && !window.isDestroyed()) window.webContents.send('app-state', getState());
  rebuildTrayMenu();
}

function getState() {
  const config = store.get();
  const override = activeManualOverride(config.manualOverride);
  const liveRhythm = rhythmAt(config.schedule, new Date(), config.sunlightSimulationEnabled !== false);
  return {
    config,
    presets: { moneyTreeSleepAligned: DEFAULT_SCHEDULE, moods: MOOD_COLOR_PRESETS, animations: ANIMATION_PRESETS, gels: GEL_PRESETS },
    connection: { ...connection, directConfigured: Boolean(credentialStore?.exists()) },
    schedule: {
      current: scheduleState.current || (override ? override.event : liveRhythm.current),
      next: scheduleState.next || liveRhythm.next,
      rhythm: scheduleState.rhythm || liveRhythm,
      override: scheduleState.override !== undefined
        ? scheduleState.override
        : (override ? {
          ...override,
          resume: rhythmAt(config.schedule, new Date(override.endsAt), config.sunlightSimulationEnabled !== false).current
        } : null),
      ...scheduleState
    },
    app: {
      version: app.getVersion(),
      platform: process.platform,
      launchAtLogin: app.getLoginItemSettings().openAtLogin
    }
  };
}

function showWindow() {
  if (!window) createWindow();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 820,
    minHeight: 640,
    title: 'GrowBar',
    backgroundColor: '#0b1210',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="black" d="M8.3 16.8c.2-3.4-.1-6-1-7.7C4.1 8.8 2 6.8 1.5 3.8c3.2-.1 5.7 1.4 7 4.1C9.7 4.4 12.4 2.3 16.6 2c-.1 4.3-2.6 7.2-6.8 7.8-.2 1.9-.1 4.2.2 7H8.3Z"/></svg>`;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  icon.setTemplateImage(true);
  return icon;
}

function rebuildTrayMenu() {
  if (!tray || !store) return;
  const config = store.get();
  const current = scheduleState.current || activeEvent(config.schedule);
  const override = activeManualOverride(config.manualOverride);
  const overrideEnd = override && new Date(override.endsAt);
  const overrideEndLabel = overrideEnd
    ? `${String(overrideEnd.getHours()).padStart(2, '0')}:${String(overrideEnd.getMinutes()).padStart(2, '0')}`
    : '';
  const label = override ? `${current.label} until ${overrideEndLabel}` : (current ? `${current.time} · ${current.label}` : 'No schedule');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connection.state === 'connected' ? `Connected · ${connection.devices.length} light(s)` : connection.detail, enabled: false },
    { label: `Current: ${label}`, enabled: false },
    { type: 'separator' },
    { label: 'Open GrowBar', click: showWindow },
    { label: override ? 'Reapply Timed Override' : 'Apply Current Step Now', click: () => runner.reset() },
    ...(override ? [{ label: 'Return to Daily Rhythm', click: () => cancelManualOverride() }] : []),
    { label: config.scheduleEnabled ? 'Pause Schedule' : 'Resume Schedule', click: () => {
      const updated = store.get();
      updated.scheduleEnabled = !updated.scheduleEnabled;
      store.save(updated);
      if (updated.scheduleEnabled) runner.reset();
      emitState();
    } },
    { label: 'Reconnect PB12', enabled: Boolean(credentialStore?.exists()), click: () => connectActive().catch(() => {}) },
    { type: 'separator' },
    { label: 'Quit GrowBar', click: () => { quitting = true; app.quit(); } }
  ]));
}

function sendDirectWrite(packet) {
  if (!nativeBluetooth) return Promise.reject(new Error('GrowBar’s native Bluetooth helper is unavailable.'));
  return nativeBluetooth.write(packet);
}

function setupNativeBluetooth() {
  const binaryPath = app.isPackaged
    ? defaultBridgePath({ resourcesPath: process.resourcesPath })
    : path.join(app.getAppPath(), 'native', 'GrowBarBluetoothBridge.app', 'Contents', 'MacOS', 'GrowBarBluetoothBridge');
  nativeBluetooth = new NativeBluetoothTransport({ binaryPath });
  nativeBluetooth.on('status', () => {
    if (connection.transport !== 'direct') return;
    connection = { ...connection, state: 'connecting', detail: 'Looking for the PB12 that belongs to the imported amaran mesh…' };
    emitState();
  });
  nativeBluetooth.on('notification', (hex) => handleDirectNotification(hex));
  nativeBluetooth.on('disconnected', (event) => {
    if (!event.expected) handleDirectLost(event.detail || 'The native PB12 Bluetooth connection closed.');
  });
}

function handleDirectNotification(hex) {
  if (!/^[0-9a-f]+$/i.test(hex || '') || hex.length % 2 !== 0) return;
  const packet = Buffer.from(hex, 'hex');
  if (client instanceof DirectBluetoothClient) client.receive(packet);
}

function handleDirectLost(detail) {
  if (client instanceof DirectBluetoothClient) {
    client.transportLost(String(detail || 'Direct Bluetooth disconnected.'));
    scheduleNativeReconnect(1000);
  }
}

function clearInterruptedZoneOverride() {
  if (!store) return;
  const config = store.get();
  if (config.manualOverride?.event?.mode !== 'zonefx') return;
  config.manualOverride = null;
  store.save(config);
  if (runner) runner.lastKey = '';
  emitState();
}

function scheduleNativeReconnect(delayMs = null) {
  clearTimeout(nativeReconnectTimer);
  nativeReconnectTimer = null;
  if (quitting || !credentialStore?.exists() || connection.state === 'connected') return;
  const backoff = Math.min(30000, 2000 * (2 ** Math.min(nativeReconnectAttempt, 4)));
  const delay = delayMs == null ? backoff : Math.max(0, delayMs);
  nativeReconnectAttempt = Math.min(nativeReconnectAttempt + 1, 5);
  nativeReconnectTimer = setTimeout(() => {
    nativeReconnectTimer = null;
    if (!quitting && credentialStore?.exists()) connectActive().catch(() => {});
  }, delay);
}

function createDirectClient() {
  if (client) client.disconnect();
  const credentials = credentialStore.reserveSequence();
  if (!credentials) {
    client = null;
    throw new Error('Import the paired PB12 from amaran Desktop before connecting.');
  }
  client = new DirectBluetoothClient({
    credentials,
    write: sendDirectWrite,
    onSequence: (sequence) => credentialStore.updateSequence(sequence),
    onConfigured: (sequence) => credentialStore.markConfigured(sequence),
    partitionZones: store.get().partitionZones,
    // A streamed animation is deliberately not resumed after a disconnect or
    // runtime safety stop. Automatic reconnect still happens, then Daily
    // Rhythm is applied instead of silently restarting a high-rate command
    // stream.
    onAnimationStopped: () => clearInterruptedZoneOverride(),
    onStatus: (status) => { connection = status; emitState(); }
  });
  return client;
}

async function connectActive() {
  if (!credentialStore?.exists()) throw new Error('Import the paired PB12 from amaran Desktop first.');
  if (!client) createDirectClient();
  if (activeConnectPromise) return activeConnectPromise;
  if (!nativeBluetooth?.available()) throw new Error('This GrowBar build is missing its native macOS Bluetooth helper.');
  activeConnectPromise = (async () => {
    connection = { state: 'connecting', detail: 'Looking for the PB12 that belongs to the imported amaran mesh…', transport: 'direct', devices: client.devices, effectPresets: [], capabilities: { cct: true, hsi: true, rgbw: true, xy: true, globalColor: true, sequences: true, pixelEffects: true, zoneEffects: true } };
    emitState();
    try {
      const config = store.get();
      const expectedMacs = (client.credentials?.fixtures || []).map((fixture) => fixture.mac).filter(Boolean);
      const ready = await nativeBluetooth.connect({
        preferredId: config.directBluetoothDeviceId,
        expectedMacs
      });
      config.directBluetoothDeviceId = String(ready.id || '').slice(0, 200);
      store.save(config);
      await client.attachTransport({ id: config.directBluetoothDeviceId, name: String(ready.name || 'PB12').slice(0, 100) });
      nativeReconnectAttempt = 0;
      clearTimeout(nativeReconnectTimer);
      nativeReconnectTimer = null;
      await runner.reset();
      return client.devices;
    } catch (error) {
      connection = { ...connection, state: 'error', detail: error.message, devices: [] };
      emitState();
      scheduleNativeReconnect();
      throw error;
    }
  })().finally(() => { activeConnectPromise = null; });
  return activeConnectPromise;
}

async function adoptDirectBluetooth() {
  await nativeBluetooth?.disconnect();
  connection = {
    state: 'connecting',
    detail: 'Reading the newest working amaran mesh database…',
    transport: 'direct', devices: [], effectPresets: [],
    capabilities: { cct: true, hsi: true, rgbw: true, xy: true, globalColor: true, sequences: true, pixelEffects: true, zoneEffects: true }
  };
  emitState();
  try {
    const config = store.get();
    const { credentials } = await importBestAmaranCredentials(app.getPath('home'));
    credentialStore.save(credentials);
    config.directBluetoothDeviceId = '';
    config.targetLightIds = [];
    store.save(config);
    if (process.platform === 'darwin') {
      try { await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "amaran Desktop" to quit']); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    createDirectClient();
    connection = { state: 'connecting', detail: `${credentials.fixtures.length} paired light${credentials.fixtures.length === 1 ? '' : 's'} imported securely. amaran is no longer needed; connecting to the PB12…`, transport: 'direct', devices: client.devices, effectPresets: [], capabilities: { cct: true, hsi: true, rgbw: true, xy: true, globalColor: true, sequences: true, pixelEffects: true, zoneEffects: true } };
    emitState();
    await connectActive();
    return getState();
  } catch (error) {
    connection = { ...connection, state: 'error', detail: error.message, devices: [] };
    emitState();
    throw error;
  }
}

const ANIMATION_FRAME_RATES = Object.freeze([5, 10, 15, 24, 30, 60]);

function animationFps(value, fallback = 15) {
  const requested = Number(value);
  return ANIMATION_FRAME_RATES.includes(requested) ? requested : fallback;
}

async function startManualOverride(presetId, requestedFps, requestedZones) {
  const preset = TIMED_OVERRIDE_PRESETS[presetId];
  if (!preset) throw new Error('Unknown timed light preset.');
  if (connection.state !== 'connected' || !connection.devices.length) throw new Error('Connect the PB12 before starting a timed light preset.');
  const config = store.get();
  if (!config.scheduleEnabled) throw new Error('Turn on Daily Rhythm before starting a timed light preset.');
  const event = JSON.parse(JSON.stringify(preset));
  if (event.mode === 'zonefx') {
    config.animationFps = animationFps(requestedFps, animationFps(config.animationFps));
    if ([4, 8, 12, 16, 24, 32].includes(Number(requestedZones))) config.partitionZones = Number(requestedZones);
    event.targetFps = config.animationFps;
    event.partitionZones = config.partitionZones;
    if (event.recipe?.kind === 'celestial-orchard') event.recipe.seed = randomBytes(4).readUInt32LE(0);
  }
  const override = createManualOverride(presetId, event);
  config.manualOverride = override;
  store.save(config);
  runner.lastKey = '';
  try {
    await runner.reset();
  } catch (error) {
    // Never leave a failed animation armed for the reconnect loop or the next
    // app launch. Mood colors are one-shot commands and retain their existing
    // persistence behavior.
    const current = store.get();
    if (event.mode === 'zonefx' && current.manualOverride?.startedAt === override.startedAt) {
      current.manualOverride = null;
      store.save(current);
      runner.lastKey = '';
    }
    throw error;
  }
  emitState();
  return getState();
}

async function startCustomOverride(requestedEvent) {
  if (connection.state !== 'connected' || !connection.devices.length) throw new Error('Connect the PB12 before applying a custom color.');
  const config = store.get();
  if (!config.scheduleEnabled) throw new Error('Turn on Daily Rhythm before starting a timed custom color.');
  const mode = String(requestedEvent?.mode || '').toLowerCase();
  const labels = {
    'global-cct': 'Custom white',
    'global-hsi': 'Custom HSI color',
    'global-rgbw': 'Custom RGBW mix',
    'global-xy': 'Custom xy color',
    'global-gel': 'Custom Gel color',
    pixelfx: 'Custom native Pixel FX',
    'partition-breath': 'Custom zone Breath',
    'partition-pulse': 'Custom Partition Flash/Pulsing',
    pulsing3: 'Custom Pulsing III',
    'system-effect': 'Custom System effect'
  };
  if (!labels[mode]) throw new Error('Choose a supported full-bar color mode.');
  const event = { ...requestedEvent, id: `custom-${mode}`, label: labels[mode], mode };
  if (mode === 'partition-breath' || mode === 'partition-pulse') config.partitionZones = Number(event.partitionZones);
  const override = createManualOverride(`custom-${mode}`, event);
  config.manualOverride = override;
  // ConfigStore performs the authoritative range and shape validation before
  // any PB12 command is sent.
  store.save(config);
  runner.lastKey = '';
  try { await runner.reset(); }
  catch (error) {
    const current = store.get();
    if (current.manualOverride?.startedAt === override.startedAt) {
      current.manualOverride = null;
      store.save(current);
      runner.lastKey = '';
    }
    throw error;
  }
  emitState();
  return getState();
}

async function cancelManualOverride() {
  const config = store.get();
  if (!config.manualOverride) return getState();
  config.manualOverride = null;
  store.save(config);
  runner.lastKey = '';
  await runner.reset();
  emitState();
  return getState();
}

function registerIpc() {
  ipcMain.handle('state:get', () => getState());
  ipcMain.handle('gel-library:get', () => GEL_LIBRARY);
  ipcMain.handle('config:save', async (_event, config) => {
    const saved = store.save(config);
    app.setLoginItemSettings({ openAtLogin: saved.launchAtLogin, openAsHidden: true });
    runner.lastKey = '';
    emitState();
    if (saved.scheduleEnabled && connection.state === 'connected') await runner.reset();
    return getState();
  });
  ipcMain.handle('connection:retry', async () => { await connectActive(); return getState(); });
  ipcMain.handle('schedule:apply', async (_event, scheduleEvent) => {
    if (!client) throw new Error('Import and connect the PB12 first.');
    const result = await client.apply(scheduleEvent, store.get().targetLightIds);
    return { ...result, state: getState() };
  });
  ipcMain.handle('schedule:apply-current', async () => { await runner.reset(); return getState(); });
  ipcMain.handle('override:start', async (_event, presetId, fps, zones) => startManualOverride(presetId, fps, zones));
  ipcMain.handle('override:start-custom', async (_event, event) => startCustomOverride(event));
  ipcMain.handle('override:cancel', async () => cancelManualOverride());
  ipcMain.handle('partition:set-layout', async (_event, zones) => {
    if (!client) throw new Error('Import and connect the PB12 first.');
    const config = store.get();
    if (activeManualOverride(config.manualOverride)) throw new Error('Return to Daily Rhythm before changing the PB12 zone layout.');
    config.partitionZones = Number(zones);
    const saved = store.save(config);
    const result = await client.apply({ mode: 'partition-layout', partitionZones: saved.partitionZones }, saved.targetLightIds);
    emitState();
    return { ...result, state: getState() };
  });
  ipcMain.handle('direct:adopt', () => adoptDirectBluetooth());
  ipcMain.handle('window:hide', () => window.hide());
}

app.whenReady().then(async () => {
  store = new ConfigStore(path.join(app.getPath('userData'), 'settings.json'));
  credentialStore = new DirectCredentialStore(path.join(app.getPath('userData'), 'direct-bluetooth.bin'), safeStorage);
  const config = store.load();
  setupNativeBluetooth();
  app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, openAsHidden: true });
  try { createDirectClient(); }
  catch (error) {
    connection = { ...connection, state: credentialStore.exists() ? 'error' : 'setup', detail: error.message, devices: [] };
    client = null;
  }
  runner = new ScheduleRunner({
    getConfig: () => store.get(),
    applyEvent: (event, ids) => {
      if (!client) throw new Error('Import and connect the PB12 first.');
      return client.apply(event, ids);
    },
    onState: (state) => { scheduleState = state; emitState(); },
    shouldApply: () => connection.state === 'connected',
    onOverrideExpired: (expired) => {
      const current = store.get();
      if (current.manualOverride?.startedAt === expired.startedAt) {
        current.manualOverride = null;
        store.save(current);
      }
    }
  });
  registerIpc();
  tray = new Tray(trayIcon());
  tray.setToolTip('GrowBar plant light scheduler');
  tray.on('click', showWindow);
  createWindow();
  runner.start();
  powerMonitor.on('resume', () => scheduleNativeReconnect(0));
  // Credentials are enough to make connection automatic. A zero-delay first
  // attempt starts after the runner and native bridge are ready; failures keep
  // retrying with a bounded backoff until the PB12 becomes reachable.
  scheduleNativeReconnect(0);
});

app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  if (runner) runner.stop();
  if (client) client.disconnect();
  clearTimeout(nativeReconnectTimer);
  nativeBluetooth?.stop();
});
