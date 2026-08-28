'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function cpuType(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.readUInt32LE(0), 0xfeedfacf, `${file} is not a 64-bit Mach-O executable`);
  return data.readUInt32LE(4);
}

function hasLoadCommand(file, expected) {
  const data = fs.readFileSync(file);
  const commands = data.readUInt32LE(16);
  let offset = 32;
  for (let index = 0; index < commands; index += 1) {
    const command = data.readUInt32LE(offset);
    const size = data.readUInt32LE(offset + 4);
    if (command === expected) return true;
    offset += size;
  }
  return false;
}

test('ships signed-size native helpers for Intel and Apple silicon', () => {
  const x64 = path.join(__dirname, '../native/bin/x64/GrowBarBluetoothBridge');
  const arm64 = path.join(__dirname, '../native/bin/arm64/GrowBarBluetoothBridge');
  assert.equal(cpuType(x64), 0x01000007);
  assert.equal(cpuType(arm64), 0x0100000c);
  assert.ok(fs.statSync(x64).mode & 0o100, 'Intel helper is not executable');
  assert.ok(fs.statSync(arm64).mode & 0o100, 'Apple-silicon helper is not executable');
  assert.ok(fs.statSync(x64).size > 50_000);
  assert.ok(fs.statSync(arm64).size > 50_000);
  assert.equal(hasLoadCommand(x64, 0x1d), true, 'Intel helper lacks a code signature');
  assert.equal(hasLoadCommand(arm64, 0x1d), true, 'Apple-silicon helper lacks a code signature');
});
