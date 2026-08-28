'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NativeBluetoothTransport, defaultBridgePath } = require('../src/native-bluetooth');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = {
    writes: [],
    write(value, callback) { this.writes.push(value); callback?.(); },
    end() {}
  };
  child.kill = () => {};
  return child;
}

test('uses the packaged nested CoreBluetooth helper path', () => {
  assert.equal(
    defaultBridgePath({ resourcesPath: '/Applications/GrowBar.app/Contents/Resources' }),
    '/Applications/GrowBar.app/Contents/Resources/native/GrowBarBluetoothBridge.app/Contents/MacOS/GrowBarBluetoothBridge'
  );
});

test('connects and writes through line-delimited native bridge messages', async () => {
  const child = fakeChild();
  const transport = new NativeBluetoothTransport({ binaryPath: __filename, platform: 'darwin', spawnProcess: () => child });
  const start = transport.start();
  child.stdout.emit('data', '{"event":"started","version":1}\n');
  await start;

  const connecting = transport.connect({ expectedMacs: ['A4:C1:38:ED:D8:D6'] });
  await new Promise((resolve) => setImmediate(resolve));
  const connectCommand = JSON.parse(child.stdin.writes.at(-1));
  assert.equal(connectCommand.role, 'proxy');
  assert.equal('uid' in connectCommand, false);
  assert.deepEqual(connectCommand.expectedMacs, ['A4C138EDD8D6']);
  child.stdout.emit('data', `${JSON.stringify({ event: 'ready', requestId: connectCommand.requestId, role: 'proxy', id: 'ABC' })}\n`);
  assert.equal((await connecting).id, 'ABC');

  const writing = transport.write(Buffer.from('030005', 'hex'));
  await new Promise((resolve) => setImmediate(resolve));
  const writeCommand = JSON.parse(child.stdin.writes.at(-1));
  assert.equal(writeCommand.hex, '030005');
  child.stdout.emit('data', `${JSON.stringify({ event: 'writeResult', requestId: writeCommand.requestId })}\n`);
  await writing;
});

test('forwards notifications, hides discovery events, and rejects native errors', async () => {
  const child = fakeChild();
  const transport = new NativeBluetoothTransport({ binaryPath: __filename, platform: 'darwin', spawnProcess: () => child });
  const notifications = [];
  transport.on('notification', (hex) => notifications.push(hex));
  const start = transport.start();
  child.stdout.emit('data', '{"event":"started","version":1}\n');
  await start;
  child.stdout.emit('data', '{"event":"scan","id":"ONE","rssi":-41}\n{"event":"notification","hex":"0102aB"}\n');
  assert.deepEqual(notifications, ['0102aB']);

  const connecting = transport.connect();
  await new Promise((resolve) => setImmediate(resolve));
  const command = JSON.parse(child.stdin.writes.at(-1));
  child.stdout.emit('data', `${JSON.stringify({ event: 'error', requestId: command.requestId, message: 'Bluetooth permission denied.' })}\n`);
  await assert.rejects(connecting, /permission denied/);
});
