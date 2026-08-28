'use strict';

const { MeshSession } = require('./direct-protocol');
const { zoneAnimationFrame } = require('./zone-effects');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MAX_OVERRIDE_MS = 4 * 60 * 60 * 1000;
const MIN_ZONE_PACKET_INTERVAL_MS = 12;
const SEQUENCE_EMERGENCY_RESERVE = 4096;
const FRAME_ESTIMATE_COUNT = 64;

class DirectBluetoothClient {
  constructor({ credentials, write, onStatus, onSequence, onConfigured, onAnimationStopped, partitionZones = 32, wait = delay, now = Date.now } = {}) {
    this.credentials = credentials;
    this.write = write;
    this.onStatus = onStatus || (() => {});
    this.onSequence = onSequence || (() => {});
    this.onConfigured = onConfigured || (() => {});
    this.onAnimationStopped = onAnimationStopped || (() => {});
    this.wait = wait;
    this.now = now;
    this.devices = (credentials?.fixtures || []).map((fixture) => ({
      node_id: `direct-${fixture.address}`,
      device_name: fixture.name,
      address: fixture.address,
      transport: 'direct'
    }));
    this.effectPresets = [];
    this.session = credentials ? new MeshSession(credentials) : null;
    this.connected = false;
    this.deviceInfo = null;
    this.animationTimer = null;
    this.animationRun = 0;
    this.activeNativeFx = null;
    this.activePartitionFx = null;
    this.activePulsing3 = null;
    this.activeSystemEffect = null;
    this.partitionZones = [4, 8, 12, 16, 24, 32].includes(Number(partitionZones)) ? Number(partitionZones) : 32;
    this.lastPersistedSequence = this.session?.sequence || 0;
    this.beaconResolver = null;
    this.filterStatusResolver = null;
    // Telink's power command recalls the fixture's last steady mode. Sending
    // it before every HSI/Pixel FX update produces a visible flash and can
    // overwrite a newly staged effect. Track the last state GrowBar applied
    // and wake the fixture only when it is actually needed.
    this.powered = new Map();
  }

  status(state, detail) {
    this.onStatus({
      state,
      detail,
      transport: 'direct',
      devices: this.devices,
      effectPresets: [],
      capabilities: {
        cct: true, hsi: true, gm: true, gel: true, rgbw: true, xy: true,
        globalColor: true, sequences: true, pixelEffects: true,
        nativePixelEffects: true, zoneEffects: true, partitionEffects: true, pulsing3: true,
        systemEffects: true
      }
    });
  }

  async attachTransport(deviceInfo) {
    if (!this.session) throw new Error('Import the paired PB12 from amaran Desktop before connecting directly.');
    this.deviceInfo = deviceInfo;
    this.status('connecting', `Securing the ${deviceInfo.name || 'PB12'} mesh connection…`);
    if (!this.session.beaconReceived) {
      await Promise.race([
        new Promise((resolve) => { this.beaconResolver = resolve; }),
        this.wait(5000)
      ]);
      this.beaconResolver = null;
    }
    // Match the working amaran-BLE-control/Telink sequence exactly: the proxy
    // needs a short settling delay after notifications are enabled, followed
    // by Set Filter Type, its Filter Status reply, and then Add Addresses.
    await this.wait(500);
    await this.write(this.session.setFilterPdu());
    await Promise.race([
      new Promise((resolve) => { this.filterStatusResolver = resolve; }),
      this.wait(2000)
    ]);
    this.filterStatusResolver = null;
    await this.write(this.session.addAddressesPdu());
    await this.wait(300);
    if (!this.credentials.configured && this.credentials.deviceKey) {
      this.status('connecting', 'Finishing the PB12’s private mesh setup…');
      for (const fixture of this.credentials.fixtures) {
        const configuration = this.session.configurePdus(fixture.address);
        await this.sendPackets(configuration.appKeyAdd);
        await this.wait(1200);
        await this.sendPackets(configuration.modelBind);
        await this.wait(900);
      }
      this.credentials.configured = true;
      this.onConfigured(this.session.sequence);
    }
    this.connected = true;
    this.status('connected', `${this.devices.length} light${this.devices.length === 1 ? '' : 's'} ready over direct Bluetooth.`);
    return this.devices;
  }

  receive(data) {
    if (!this.session) return;
    const result = this.session.receive(data);
    if (result.ivIndex !== null && this.beaconResolver) this.beaconResolver();
    if (result.proxyConfigStatus && this.filterStatusResolver) this.filterStatusResolver();
  }

  transportLost(detail = 'The direct Bluetooth connection closed.') {
    this.connected = false;
    this.powered.clear();
    this.stopSequence('connection-lost');
    this.status('disconnected', detail);
  }

  targetDevices(ids = []) {
    if (!ids.length) return this.devices;
    const selected = this.devices.filter((device) => ids.includes(device.node_id));
    return selected.length ? selected : (this.devices.length === 1 ? this.devices : []);
  }

  async sendPackets(packets, label = '', intervalMs = 80, trailingDelay = true) {
    for (const [index, packet] of packets.entries()) {
      try { await this.write(packet); }
      catch (error) {
        const prefix = label ? `${label} failed` : 'Bluetooth Mesh command failed';
        throw new Error(`${prefix} on packet ${index + 1}/${packets.length}: ${error.message}`);
      }
      if (intervalMs > 0 && (trailingDelay || index < packets.length - 1)) await this.wait(intervalMs);
    }
    if (this.session.sequence - this.lastPersistedSequence >= 96) this.persistSequence();
  }

  persistSequence() {
    if (!this.session || this.session.sequence <= this.lastPersistedSequence) return;
    this.onSequence(this.session.sequence);
    this.lastPersistedSequence = this.session.sequence;
  }

  async applyFrame(frame, ids, run) {
    if (run !== this.animationRun) return;
    const targets = this.targetDevices(ids);
    for (const device of targets) {
      await this.ensurePowered(device);
      if (frame.mode === 'cct') await this.sendPackets(this.session.cctPdus(device.address, frame.cct, frame.intensity * 10));
      if (frame.mode === 'hsi') await this.sendPackets(this.session.hsiPdus(device.address, frame.hue, frame.saturation, frame.intensity * 10));
    }
  }

  async ensurePowered(device) {
    if (this.powered.get(device.address) === true) return;
    await this.sendPackets(this.session.onOffPdus(device.address, true));
    this.powered.set(device.address, true);
  }

  async stopNativeFx(devices) {
    if (!this.activeNativeFx) return;
    const recipe = this.activeNativeFx;
    const interval = recipe.kind === 'fire' ? 150 : 200;
    for (const device of devices) {
      await this.sendPackets(this.session.pixelFxStopPdus(device.address, recipe), `Stop PB12 ${recipe.kind} Pixel FX`, interval);
    }
    await this.wait(500);
    this.activeNativeFx = null;
  }

  async setPartitionMode(zones, devices = this.devices) {
    const count = Number(zones);
    if (![4, 8, 12, 16, 24, 32].includes(count)) throw new Error('Choose 4, 8, 12, 16, 24, or 32 PB12 sections.');
    for (const device of devices) {
      await this.ensurePowered(device);
      await this.sendPackets(this.session.partitionModePdus(device.address, count), `Set PB12 ${count}-section layout`, 0);
    }
    await this.wait(500);
    this.partitionZones = count;
    return { count: devices.length, zones: count };
  }

  async stopPartitionFx(devices) {
    if (!this.activePartitionFx) return;
    const allSections = Array.from({ length: 32 }, (_, index) => index);
    for (const device of devices) {
      // Always address all 32 physical sections when disarming the partition
      // engine, irrespective of the active logical layout. A smaller logical
      // mask or a preserve-color sentinel can leave stale red sections behind.
      await this.sendPackets(this.session.partitionCctPdus(device.address, {
        zones: allSections, cct: 4300, duv: 100, intensity: 5, fxEnabled: false
      }), 'Stop PB12 partition effect', 0);
    }
    await this.wait(200);
    this.activePartitionFx = null;
  }

  async stopPulsing3(devices) {
    if (!this.activePulsing3) return;
    for (const device of devices) {
      await this.sendPackets(this.session.pulsing3Pdus(device.address, { ...this.activePulsing3, enabled: false }), 'Stop PB12 Pulsing III', 0);
    }
    await this.wait(500);
    this.activePulsing3 = null;
  }

  async stopSystemEffect(devices) {
    if (!this.activeSystemEffect) return;
    for (const device of devices) {
      await this.sendPackets(this.session.systemEffectStopPdus(device.address), 'Stop PB12 System effect', 0);
    }
    await this.wait(500);
    this.activeSystemEffect = null;
  }

  async startPartitionBreath(event, ids) {
    const targets = this.targetDevices(ids);
    const count = Number(event.partitionZones || this.partitionZones);
    await this.setPartitionMode(count, targets);
    const selected = [...new Set((event.zones || []).map(Number))].filter((index) => Number.isInteger(index) && index >= 0 && index < count);
    if (!selected.length) throw new Error('Choose at least one section for Partition Breath.');
    for (const device of targets) {
      await this.sendPackets(this.session.partitionBreathPdus(device.address, {
        minimum: event.minimum, frequency: event.frequency
      }), 'Configure PB12 Partition Breath', 0);
      await this.wait(200);
      await this.sendPackets(this.session.partitionMaskPdus(device.address, {
        zones: selected, hue: event.hue, saturation: event.saturation,
        intensity: event.intensity, fxEnabled: true
      }), 'Start PB12 Partition Breath', 0);
    }
    this.activePartitionFx = { partitionZones: count, zones: selected };
    this.status('connected', `Hardware-derived Breath started on ${selected.length} of ${count} PB12 sections.`);
    return { count: targets.length, event };
  }

  async startPulsing3(event, ids) {
    const targets = this.targetDevices(ids);
    const settings = { cct: event.cct, intensity: event.intensity, rate: event.rate };
    for (const device of targets) {
      await this.ensurePowered(device);
      await this.sendPackets(this.session.pulsing3Pdus(device.address, { ...settings, enabled: true }), 'Start PB12 Pulsing III', 0);
    }
    this.activePulsing3 = settings;
    this.status('connected', `Hardware-derived Pulsing III started at ${event.rate} pulses per minute.`);
    return { count: targets.length, event };
  }

  async startPartitionPulse(event, ids) {
    const targets = this.targetDevices(ids);
    const kind = event.kind === 'flash' ? 'flash' : 'pulsing';
    const count = Number(event.partitionZones || this.partitionZones);
    if (kind === 'flash' && ![4, 8].includes(count)) throw new Error('Partition Flash is validated only in 4- or 8-section layouts.');
    await this.setPartitionMode(count, targets);
    const allZones = Array.from({ length: count }, (_, index) => index);
    for (const device of targets) {
      if (kind === 'flash') {
        // The eight-section fixture path is order-sensitive. Hardware
        // readback proved this exact sequence: layout, explicit all-section
        // stop, enable every section in the selected layout, parameters last.
        await this.sendPackets(this.session.partitionCctPdus(device.address, {
          zones: Array.from({ length: 32 }, (_, index) => index),
          cct: 4300, duv: 100, intensity: 5, fxEnabled: false
        }), 'Reset PB12 Partition Flash state', 0);
        await this.sendPackets(this.session.partitionCctPdus(device.address, {
          zones: allZones, cct: 4300, duv: 100, intensity: event.intensity, fxEnabled: true
        }), `Enable PB12 ${count}-section Flash`, 0);
        await this.wait(200);
        await this.sendPackets(this.session.partitionPulsePdus(device.address, {
          kind, frequency: event.frequency, trigger: event.trigger
        }), 'Start PB12 Partition Flash parameters', 0);
      } else {
        await this.sendPackets(this.session.partitionPulsePdus(device.address, {
          kind, frequency: event.frequency, trigger: event.trigger
        }), 'Configure PB12 Partition Pulsing', 0);
        await this.wait(200);
        await this.sendPackets(this.session.partitionCctPdus(device.address, {
          zones: allZones, cct: 4300, duv: 100, intensity: event.intensity, fxEnabled: true
        }), 'Start PB12 Partition Pulsing', 0);
      }
    }
    this.activePartitionFx = { kind, partitionZones: count, zones: allZones };
    const behavior = event.trigger === 'sequential' ? `${count}-section sequential` : 'whole-bar unified';
    this.status('connected', `Hardware-derived Partition ${kind} started in ${behavior} mode at ${event.frequency} Hz.`);
    return { count: targets.length, event: { ...event, partitionZones: count } };
  }

  async startSystemEffect(event, ids) {
    const targets = this.targetDevices(ids);
    const settings = { kind: event.kind, frequency: event.frequency, colorType: event.colorType };
    for (const device of targets) {
      await this.ensurePowered(device);
      await this.sendPackets(this.session.systemEffectPdus(device.address, settings), `Start PB12 ${event.kind} System effect`, 0);
    }
    this.activeSystemEffect = settings;
    this.status('connected', `Hardware-derived ${event.kind.replaceAll('-', ' ')} System effect started.`);
    return { count: targets.length, event };
  }

  async startSequence(event, ids) {
    if (!Array.isArray(event.frames) || event.frames.length < 2) throw new Error('This animation has no usable frames.');
    const run = ++this.animationRun;
    let index = 0;
    const advance = async () => {
      if (run !== this.animationRun) return;
      const frame = event.frames[index];
      try { await this.applyFrame(frame, ids, run); }
      catch (error) {
        if (run === this.animationRun) this.status('error', `Animation stopped: ${error.message}`);
        this.stopSequence();
        return;
      }
      if (run !== this.animationRun) return;
      index = (index + 1) % event.frames.length;
      this.animationTimer = setTimeout(advance, frame.durationMs);
    };
    await advance();
    return { count: this.targetDevices(ids).length, event };
  }

  async startZoneAnimation(event, ids) {
    const run = ++this.animationRun;
    let frameIndex = 0;
    const requestedFps = Math.max(1, Math.min(60, Math.round(Number(event.targetFps) || 15)));
    const targets = this.targetDevices(ids);
    const partitionZones = Number(event.partitionZones || this.partitionZones);
    await this.setPartitionMode(partitionZones, targets);
    const reduceZones = (zones) => Array.from({ length: partitionZones }, (_, index) => zones[Math.floor(index * zones.length / partitionZones)]);
    const authoredFrame = zoneAnimationFrame(event.recipe, 0);
    // Each preset owns its dramatic tempo. The UI frame-rate control is a
    // ceiling for slower hardware or a constrained Mesh sequence budget; it
    // must never accelerate a quiet authored scene into a frantic one.
    const authoredFps = 1000 / authoredFrame.durationMs;
    // Estimate the most expensive frame across a full 32-zone traversal. The
    // resulting budget is intentionally conservative: an animation selected
    // for a four-hour override must remain safe for all four hours, even if it
    // is later interrupted early.
    let commandsPerFixture = 1;
    for (let sample = 0; sample < FRAME_ESTIMATE_COUNT; sample += 1) {
      const sampled = zoneAnimationFrame(event.recipe, sample);
      commandsPerFixture = Math.max(commandsPerFixture, this.session.zoneFrameCommandCount(reduceZones(sampled.zones)));
    }
    const packetsPerFrame = commandsPerFixture * targets.length;
    const headroom = this.session.sequenceHeadroom(SEQUENCE_EMERGENCY_RESERVE);
    const sequenceLimitedFps = Math.floor(headroom / (packetsPerFrame * (MAX_OVERRIDE_MS / 1000)));
    const packetIntervalMs = Math.max(
      MIN_ZONE_PACKET_INTERVAL_MS,
      Math.min(100, Math.round(Number(event.recipe.packetIntervalMs) || MIN_ZONE_PACKET_INTERVAL_MS))
    );
    const transportLimitedFps = Math.max(1, Math.floor(1000 / (packetsPerFrame * packetIntervalMs)));
    const targetFps = Math.min(requestedFps, authoredFps, sequenceLimitedFps, transportLimitedFps);
    if (targetFps < 1) {
      throw new Error('There is not enough safe Bluetooth Mesh sequence capacity for another four-hour animation. Re-pair the PB12 in amaran and re-import its database before using animations again.');
    }
    const advance = async () => {
      if (run !== this.animationRun) return;
      const frame = zoneAnimationFrame(event.recipe, frameIndex);
      const isInitialFrame = frameIndex === 0;
      const frameStartedAt = this.now();
      try {
        for (const device of targets) {
          await this.ensurePowered(device);
          const preferredColors = event.recipe.preferredWriteOrder ? event.recipe.colors : [];
          await this.sendPackets(this.session.zoneFramePdus(device.address, reduceZones(frame.zones), preferredColors), `PB12 ${event.recipe.kind} zone frame`, packetIntervalMs, true);
        }
      } catch (error) {
        if (run === this.animationRun) this.status('error', `Zone animation stopped: ${error.message}`);
        this.stopSequence('animation-error');
        if (isInitialFrame) throw error;
        return;
      }
      if (run !== this.animationRun) return;
      frameIndex += 1;
      // durationMs is the target start-to-start cadence. Compensating for
      // transmission time fixes the old behavior where colorful frames ran
      // much slower than their recipe because every packet delay was added
      // before the entire frame duration.
      const targetDuration = 1000 / targetFps;
      const remaining = Math.max(0, targetDuration - (this.now() - frameStartedAt));
      this.animationTimer = setTimeout(advance, remaining);
    };
    await advance();
    if (run === this.animationRun) {
      const formatFps = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
      const limits = [];
      if (authoredFps < requestedFps) limits.push(`${formatFps(authoredFps)} FPS authored pace`);
      if (sequenceLimitedFps < Math.min(requestedFps, authoredFps)) limits.push(`${formatFps(sequenceLimitedFps)} FPS Mesh budget`);
      if (transportLimitedFps < Math.min(requestedFps, authoredFps, sequenceLimitedFps)) limits.push(`${formatFps(transportLimitedFps)} FPS transport`);
      const limitNote = limits.length ? ` The ${requestedFps} FPS UI setting is a maximum; active limit: ${limits.join(', ')}.` : '';
      this.status('connected', `Independent ${partitionZones}-zone ${event.recipe.kind} animation started at ${formatFps(targetFps)} FPS.${limitNote}`);
    }
    return { count: this.targetDevices(ids).length, event };
  }

  async apply(event, ids = []) {
    if (!this.connected) throw new Error('The PB12 is not connected over direct Bluetooth.');
    this.stopSequence();
    const targets = this.targetDevices(ids);
    if (!targets.length) throw new Error('No direct Bluetooth light is selected.');
    // Onboard Pixel FX keep running independently of GrowBar. Always stop the
    // active fixture state machine before entering another control engine,
    // including the software sequence and 32-zone streaming paths.
    await this.stopNativeFx(targets);
    await this.stopPulsing3(targets);
    await this.stopSystemEffect(targets);
    await this.stopPartitionFx(targets);
    if (event.mode === 'partition-layout') return this.setPartitionMode(event.partitionZones, targets);
    if (event.mode === 'sequence') return this.startSequence(event, ids);
    if (event.mode === 'zonefx') return this.startZoneAnimation(event, ids);
    if (event.mode === 'partition-breath') return this.startPartitionBreath(event, ids);
    if (event.mode === 'partition-pulse') return this.startPartitionPulse(event, ids);
    if (event.mode === 'pulsing3') return this.startPulsing3(event, ids);
    if (event.mode === 'system-effect') return this.startSystemEffect(event, ids);
    for (const device of targets) {
      if (event.mode === 'off') {
        await this.sendPackets(this.session.onOffPdus(device.address, false));
        this.powered.set(device.address, false);
      } else {
        await this.ensurePowered(device);
        if (event.mode === 'cct') await this.sendPackets(this.session.cctPdus(device.address, event.cct, event.intensity * 10));
        if (event.mode === 'hsi') await this.sendPackets(this.session.hsiPdus(device.address, event.hue, event.saturation, event.intensity * 10));
        if (event.mode === 'global-cct') await this.sendPackets(this.session.globalCctPdus(device.address, event.cct, event.intensity * 10, event.gm ?? 0));
        if (event.mode === 'global-hsi') await this.sendPackets(this.session.globalHsiPdus(device.address, event.hue, event.saturation, event.intensity * 10));
        if (event.mode === 'global-rgbw') await this.sendPackets(this.session.globalRgbwPdus(device.address, {
          red: event.red * 10, green: event.green * 10, blue: event.blue * 10,
          warmWhite: event.warmWhite * 10, coolWhite: event.coolWhite * 10, intensity: event.intensity * 10
        }));
        if (event.mode === 'global-xy') await this.sendPackets(this.session.globalXyPdus(device.address, {
          x: event.x, y: event.y, intensity: event.intensity * 10
        }));
        if (event.mode === 'global-gel') await this.sendPackets(this.session.gelPdus(device.address, {
          cct: event.cct, origin: event.origin, type: event.type, color: event.color, intensity: event.intensity * 10
        }));
        if (event.mode === 'pixelfx') {
          const packets = this.session.pixelFxPdus(device.address, event.recipe);
          await this.sendPackets(packets, `PB12 ${event.recipe.kind} Pixel FX`, event.recipe.kind === 'fire' ? 150 : 200);
          this.activeNativeFx = JSON.parse(JSON.stringify(event.recipe));
          this.status('connected', `Hardware-derived ${event.recipe.kind} Pixel FX started in the PB12's onboard engine.`);
        }
        if (event.mode === 'effect' || event.mode === 'effectpreset') {
          throw new Error('This saved animation uses GrowBar’s retired amaran preset format. Start it again from the Light Animations card.');
        }
      }
    }
    return { count: targets.length, event };
  }

  stopSequence(reason = '') {
    const hadAnimation = Boolean(this.animationTimer);
    this.animationRun += 1;
    clearTimeout(this.animationTimer);
    this.animationTimer = null;
    if (reason && hadAnimation) this.onAnimationStopped(reason);
  }

  disconnect() {
    this.persistSequence();
    this.connected = false;
    this.powered.clear();
    this.activeNativeFx = null;
    this.activePartitionFx = null;
    this.activePulsing3 = null;
    this.activeSystemEffect = null;
    this.stopSequence();
  }
}

module.exports = { DirectBluetoothClient };
