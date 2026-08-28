'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

function defaultBridgePath({ resourcesPath = process.resourcesPath, appPath = path.join(__dirname, '..') } = {}) {
  if (resourcesPath) {
    return path.join(resourcesPath, 'native', 'GrowBarBluetoothBridge.app', 'Contents', 'MacOS', 'GrowBarBluetoothBridge');
  }
  return path.join(appPath, 'native', 'GrowBarBluetoothBridge.app', 'Contents', 'MacOS', 'GrowBarBluetoothBridge');
}

class NativeBluetoothTransport extends EventEmitter {
  constructor({ binaryPath, spawnProcess = spawn, platform = process.platform } = {}) {
    super();
    this.binaryPath = binaryPath || defaultBridgePath();
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.process = null;
    this.buffer = '';
    this.nextId = 0;
    this.pending = new Map();
    this.started = null;
    this.closing = false;
  }

  available() {
    return this.platform === 'darwin' && Boolean(this.binaryPath) && fs.existsSync(this.binaryPath);
  }

  async start() {
    if (this.process) return this.started;
    if (this.platform !== 'darwin') throw new Error('Native Bluetooth is available only on macOS.');
    if (!this.binaryPath || !fs.existsSync(this.binaryPath)) {
      throw new Error('This GrowBar build is missing its native Bluetooth helper. Reinstall the complete macOS app.');
    }
    this.closing = false;
    const child = this.spawnProcess(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child;
    this.started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The native Bluetooth helper did not start in time.')), 5000);
      const ready = (message) => {
        if (message.event !== 'started') return;
        clearTimeout(timer);
        this.off('message', ready);
        resolve(message);
      };
      this.on('message', ready);
      child.once('error', (error) => {
        clearTimeout(timer);
        this.off('message', ready);
        reject(new Error(`The native Bluetooth helper could not launch: ${error.message}`));
      });
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const detail = String(chunk || '').trim();
      if (detail) this.emit('diagnostic', detail.slice(0, 1000));
    });
    child.once('exit', (code, signal) => this.handleExit(code, signal));
    return this.started;
  }

  consume(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const newline = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch {
        this.emit('diagnostic', `Ignored invalid native Bluetooth output: ${line.slice(0, 240)}`);
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    this.emit('message', message);
    if (message.event === 'status') this.emit('status', message);
    if (message.event === 'state') this.emit('state', message);
    if (message.event === 'diagnostic') this.emit('diagnostic', message.message || '');
    if (message.event === 'notification' && /^[0-9a-f]+$/i.test(message.hex || '')) this.emit('notification', message.hex);
    if (message.event === 'disconnected') this.emit('disconnected', message);
    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.event === pending.successEvent) {
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message);
    } else if (message.event === 'error') {
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.reject(new Error(message.message || 'Native Bluetooth operation failed.'));
    }
  }

  handleExit(code, signal) {
    const expected = this.closing;
    this.process = null;
    this.started = null;
    const detail = expected
      ? 'Native Bluetooth helper closed.'
      : `Native Bluetooth helper stopped${signal ? ` (${signal})` : ` (exit ${code ?? 'unknown'})`}.`;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(detail));
    }
    this.pending.clear();
    if (!expected) this.emit('disconnected', { event: 'disconnected', expected: false, detail });
  }

  async request(command, payload, successEvent, timeoutMs) {
    await this.start();
    const requestId = `native-${Date.now()}-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Native Bluetooth ${command} timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, successEvent });
      this.process.stdin.write(`${JSON.stringify({ command, requestId, ...payload })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  connect({ preferredId = '', expectedMacs = [], timeoutMs = 35000 } = {}) {
    const identities = Array.isArray(expectedMacs)
      ? expectedMacs.map((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase()).filter(Boolean).slice(0, 32)
      : [];
    return this.request('connect', { role: 'proxy', preferredId, expectedMacs: identities }, 'ready', timeoutMs);
  }

  write(packet, timeoutMs = 5000) {
    const hex = Buffer.from(packet || []).toString('hex');
    if (!hex) return Promise.reject(new Error('Cannot send an empty Bluetooth packet.'));
    return this.request('write', { hex }, 'writeResult', timeoutMs);
  }

  disconnect(timeoutMs = 3000) {
    if (!this.process) return Promise.resolve();
    return this.request('disconnect', {}, 'disconnectResult', timeoutMs).catch(() => {});
  }

  stop() {
    this.closing = true;
    if (this.process) {
      try { this.process.stdin.end(); } catch {}
      setTimeout(() => {
        if (this.process) this.process.kill();
      }, 500).unref();
    }
  }
}

module.exports = { NativeBluetoothTransport, defaultBridgePath };
