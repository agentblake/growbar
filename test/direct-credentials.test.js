'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DirectCredentialStore, findAmaranDatabases, importAmaranCredentials, importBestAmaranCredentials } = require('../src/direct-credentials');
const { MESH_SEQUENCE_SAFE_LIMIT } = require('../src/direct-protocol');

test('imports and validates mesh credentials without exposing them in the summary', async () => {
  const run = async (_binary, args) => ({ stdout: args.at(-1).includes('FROM mesh')
    ? '00112233445566778899AABBCCDDEEFF|FFEEDDCCBBAA99887766554433221100\n'
    : 'A4:C1:38:00:00:01|2|INFINIBAR PB12\n' });
  const credentials = await importAmaranCredentials('/tmp/amaran.db', run);
  assert.equal(credentials.schema, 2);
  assert.equal(credentials.configured, true);
  assert.equal(credentials.source, 'amaran-db');
  assert.equal(credentials.fixtures[0].name, 'INFINIBAR PB12');
  assert.equal(credentials.fixtures[0].address, 2);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growbar-credentials-'));
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString()
  };
  const store = new DirectCredentialStore(path.join(directory, 'direct.bin'), secureStorage);
  store.save(credentials);
  assert.deepEqual(store.summary(), [{ node_id: 'direct-2', device_name: 'INFINIBAR PB12', address: 2, transport: 'direct' }]);
  const raw = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(raw.includes(credentials.netKey), false);
  const reserved = store.reserveSequence(1024);
  assert.equal(reserved.sequence, credentials.sequence + 1024);
  store.updateSequence(reserved.sequence + 100);
  assert.equal(store.load().sequence, reserved.sequence + 100);
});

test('rejects an invalid database instead of storing incomplete keys', async () => {
  const run = async () => ({ stdout: 'not-a-key|also-bad\n' });
  await assert.rejects(importAmaranCredentials('/tmp/amaran.db', run), /missing or invalid/);
});

test('refuses to reserve a startup sequence window near the no-wrap boundary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growbar-sequence-'));
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => Buffer.from(value).toString()
  };
  const store = new DirectCredentialStore(path.join(directory, 'direct.bin'), secureStorage);
  store.save({
    netKey: '00112233445566778899AABBCCDDEEFF',
    appKey: 'FFEEDDCCBBAA99887766554433221100',
    fixtures: [{ mac: 'A4:C1:38:00:00:01', address: 2, name: 'PB12' }],
    sequence: MESH_SEQUENCE_SAFE_LIMIT - 100
  });
  assert.throws(() => store.reserveSequence(), /stopped before.*sequence could wrap/i);
  assert.equal(store.load().sequence, MESH_SEQUENCE_SAFE_LIMIT - 100);
});

test('finds every amaran profile and selects the database containing the PB12', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'growbar-amaran-home-'));
  const root = path.join(home, 'Library', 'Application Support', 'amaran Desktop');
  const generic = path.join(root, 'generic', 'amaran.db');
  const pb12 = path.join(root, 'pb12', 'amaran.db');
  fs.mkdirSync(path.dirname(generic), { recursive: true });
  fs.mkdirSync(path.dirname(pb12), { recursive: true });
  fs.writeFileSync(generic, '');
  fs.writeFileSync(pb12, '');
  assert.equal(findAmaranDatabases(home).length, 2);

  const run = async (_binary, args) => {
    const databasePath = args.at(-2);
    const sql = args.at(-1);
    if (sql.includes('FROM mesh')) return { stdout: '00112233445566778899AABBCCDDEEFF|FFEEDDCCBBAA99887766554433221100\n' };
    return { stdout: databasePath === pb12
      ? 'A4:C1:38:ED:D8:D6|2|INFINIBAR PB12\n'
      : 'A4:C1:38:00:00:01|2|Other fixture\n' };
  };
  const imported = await importBestAmaranCredentials(home, { run });
  assert.equal(imported.databasePath, pb12);
  assert.equal(imported.credentials.fixtures[0].name, 'INFINIBAR PB12');
});
