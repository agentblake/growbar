'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GEL_LIBRARY, GEL_SERIES } = require('../src/gel-library');

test('ships the complete native Sidus LEE and Rosco Gel catalog', () => {
  assert.equal(GEL_LIBRARY.length, 318);
  assert.equal(GEL_SERIES.length, 9);
  assert.equal(new Set(GEL_LIBRARY.map((gel) => gel.id)).size, 318);
  assert.deepEqual(
    GEL_SERIES.map((series) => `${series.brand}:${series.type}:${series.entries.length}`),
    ['Rosco:0:33', 'Rosco:1:33', 'Rosco:2:10', 'Rosco:3:46', 'LEE:0:39', 'LEE:1:89', 'LEE:2:9', 'LEE:3:18', 'LEE:4:41']
  );
});

test('maps searchable catalog identities to the native GELProtocol addresses', () => {
  const lee203 = GEL_LIBRARY.find((gel) => gel.id === 'lee-203');
  const rosco3208 = GEL_LIBRARY.find((gel) => gel.id === 'rosco-3208');
  const final = GEL_LIBRARY.at(-1);
  assert.deepEqual(
    { origin: lee203.origin, type: lee203.type, index: lee203.index, name: lee203.name },
    { origin: 0, type: 0, index: 4, name: '1/4 CTB' }
  );
  assert.deepEqual(
    { origin: rosco3208.origin, type: rosco3208.type, index: rosco3208.index, name: rosco3208.name },
    { origin: 1, type: 0, index: 4, name: '1/4 CTB' }
  );
  assert.deepEqual(
    { brand: final.brand, type: final.type, index: final.index, number: final.number },
    { brand: 'LEE', type: 4, index: 40, number: '795' }
  );
});
