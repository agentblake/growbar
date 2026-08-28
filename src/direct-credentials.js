'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomInt } = require('node:crypto');
const { MESH_SEQUENCE_SAFE_LIMIT } = require('./direct-protocol');

const execFileAsync = promisify(execFile);
const KEY_PATTERN = /^[0-9a-f]{32}$/i;

function findAmaranDatabases(homeDirectory) {
  const root = path.join(homeDirectory, 'Library', 'Application Support', 'amaran Desktop');
  try {
    const nested = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'amaran.db'))
      .filter((candidate) => fs.existsSync(candidate));
    const direct = path.join(root, 'amaran.db');
    if (fs.existsSync(direct)) nested.push(direct);
    return [...new Set(nested)].sort((left, right) => {
      try { return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs; }
      catch { return 0; }
    });
  } catch {
    return [];
  }
}

function findAmaranDatabase(homeDirectory) {
  return findAmaranDatabases(homeDirectory)[0] || '';
}

async function sqliteQuery(databasePath, sql, run = execFileAsync) {
  const { stdout } = await run('/usr/bin/sqlite3', ['-readonly', '-noheader', databasePath, sql], { maxBuffer: 1024 * 1024 });
  return String(stdout).trim();
}

async function importAmaranCredentials(databasePath, run) {
  if (!databasePath) throw new Error('amaran Desktop’s paired-light database was not found. Pair the PB12 in amaran Desktop first.');
  const meshRow = await sqliteQuery(databasePath, 'SELECT net_key, app_key FROM mesh LIMIT 1;', run);
  const [netKey = '', appKey = ''] = meshRow.split('|').map((value) => value.trim().toUpperCase());
  if (!KEY_PATTERN.test(netKey) || !KEY_PATTERN.test(appKey)) throw new Error('The amaran mesh credentials were missing or invalid.');
  const fixtureRows = await sqliteQuery(databasePath,
    'SELECT mac_address, node_address, name FROM fixtures WHERE node_address > 1 ORDER BY node_address;', run);
  const fixtures = fixtureRows.split(/\r?\n/).filter(Boolean).map((row) => {
    const [mac = '', addressValue = '', ...nameParts] = row.split('|');
    const address = Number.parseInt(addressValue, 10);
    return { mac: mac.trim().toUpperCase(), address, name: nameParts.join('|').trim() || `Light ${address}` };
  }).filter((fixture) => fixture.mac && Number.isInteger(fixture.address) && fixture.address > 1 && fixture.address < 0x8000);
  if (!fixtures.length) throw new Error('No paired lights were found in amaran Desktop’s database.');
  return {
    schema: 2,
    netKey,
    appKey,
    fixtures,
    configured: true,
    source: 'amaran-db',
    sequence: 12000000 + randomInt(4000000),
    importedAt: new Date().toISOString()
  };
}

function importScore(credentials, databasePath) {
  let score = credentials.fixtures.length * 10;
  if (credentials.fixtures.some((fixture) => /PB\s*12|INFINIBAR/i.test(fixture.name || ''))) score += 1000;
  try { score += Math.floor(fs.statSync(databasePath).mtimeMs / 100000000); } catch {}
  return score;
}

async function importBestAmaranCredentials(homeDirectory, { run } = {}) {
  const databases = findAmaranDatabases(homeDirectory);
  if (!databases.length) {
    throw new Error('amaran Desktop’s mesh database was not found. Add the PB12 in amaran Desktop once, leave amaran open, then click Import again.');
  }
  const successes = [];
  const failures = [];
  for (const databasePath of databases) {
    try {
      const credentials = await importAmaranCredentials(databasePath, run);
      successes.push({ databasePath, credentials, score: importScore(credentials, databasePath) });
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (!successes.length) {
    const reason = failures[0] ? ` (${failures[0]})` : '';
    throw new Error(`No paired lights were found in the available amaran databases${reason}. Add the PB12 in amaran Desktop once, confirm it responds there, and import while amaran is still open.`);
  }
  successes.sort((left, right) => right.score - left.score);
  return successes[0];
}

class DirectCredentialStore {
  constructor(filePath, secureStorage) {
    this.filePath = filePath;
    this.secureStorage = secureStorage;
  }

  available() {
    return Boolean(this.secureStorage?.isEncryptionAvailable?.());
  }

  exists() { return fs.existsSync(this.filePath); }

  save(credentials) {
    if (!this.available()) throw new Error('macOS secure storage is unavailable, so GrowBar will not save Bluetooth mesh keys.');
    const encrypted = this.secureStorage.encryptString(JSON.stringify(credentials));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  load() {
    if (!this.exists()) return null;
    if (!this.available()) throw new Error('macOS secure storage is unavailable, so direct Bluetooth credentials cannot be opened.');
    let credentials;
    try { credentials = JSON.parse(this.secureStorage.decryptString(fs.readFileSync(this.filePath))); }
    catch {
      throw new Error('GrowBar could not decrypt the old direct-Bluetooth setup. Use “Import amaran mesh” to replace it with a clean encrypted copy.');
    }
    if (!KEY_PATTERN.test(credentials.netKey || '') || !KEY_PATTERN.test(credentials.appKey || '') || !Array.isArray(credentials.fixtures)) {
      throw new Error('The saved direct Bluetooth credentials are invalid.');
    }
    return credentials;
  }

  summary() {
    const credentials = this.load();
    return credentials ? credentials.fixtures.map((fixture) => ({
      node_id: `direct-${fixture.address}`,
      device_name: fixture.name,
      address: fixture.address,
      transport: 'direct'
    })) : [];
  }

  reserveSequence(gap = 1024) {
    const credentials = this.load();
    if (!credentials) return null;
    const current = Number.isInteger(credentials.sequence) ? credentials.sequence : 12000000;
    const reserved = current + gap;
    if (reserved >= MESH_SEQUENCE_SAFE_LIMIT - 1) {
      throw new Error('GrowBar stopped before the Bluetooth Mesh sequence could wrap. Re-pair the PB12 in amaran and re-import its database to establish fresh mesh state.');
    }
    credentials.sequence = reserved;
    this.save(credentials);
    return credentials;
  }

  updateSequence(sequence) {
    if (!Number.isInteger(sequence)) return;
    const credentials = this.load();
    if (credentials && sequence > (credentials.sequence || 0)) {
      credentials.sequence = sequence;
      this.save(credentials);
    }
  }

  markConfigured(sequence) {
    const credentials = this.load();
    if (!credentials) return;
    credentials.configured = true;
    if (Number.isInteger(sequence) && sequence > (credentials.sequence || 0)) credentials.sequence = sequence;
    this.save(credentials);
  }
}

module.exports = {
  DirectCredentialStore,
  findAmaranDatabase,
  findAmaranDatabases,
  importAmaranCredentials,
  importBestAmaranCredentials,
  sqliteQuery
};
