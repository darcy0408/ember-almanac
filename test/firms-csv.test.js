import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FirmsError, parseFirmsCsv } from '../lib/firms-csv.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parses MODIS dialect (CRLF, numeric confidence)', () => {
  const rows = parseFirmsCsv(fx('modis.csv'), 'MODIS_NRT');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.conf), ['high', 'low', 'nominal']);
  assert.equal(rows[0].sensor, 'MODIS');
  assert.equal(rows[0].satellite, 'Terra');
  assert.equal(rows[2].satellite, 'Aqua');
  assert.equal(rows[0].frp, 20.5);
  assert.equal(rows[1].daynight, 'N');
  assert.equal(rows[0].utc, Date.UTC(2025, 7, 10, 21, 30));
});

test('parses VIIRS dialect and acq_time without leading zeros', () => {
  const rows = parseFirmsCsv(fx('viirs.csv'), 'VIIRS_NOAA20_NRT');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.conf), ['high', 'nominal', 'low']);
  assert.equal(rows[0].utc, Date.UTC(2025, 7, 10, 0, 7));
  assert.equal(rows[2].utc, Date.UTC(2025, 7, 10, 13, 42));
  assert.equal(rows[0].sensor, 'VIIRS');
  assert.equal(rows[0].satellite, 'NOAA-20');
});

test('confidence thresholds for MODIS', () => {
  const h = 'latitude,longitude,acq_date,acq_time,confidence\n';
  const rows = parseFirmsCsv(h + '1,1,2025-01-01,0,29\n1,1,2025-01-01,0,30\n1,1,2025-01-01,0,79\n1,1,2025-01-01,0,80\n', 'MODIS_SP');
  assert.deepEqual(rows.map((r) => r.conf), ['low', 'nominal', 'nominal', 'high']);
});

test('empty and header-only bodies are zero detections', () => {
  assert.deepEqual(parseFirmsCsv('', 'MODIS_NRT'), []);
  assert.deepEqual(parseFirmsCsv('latitude,longitude,acq_date,acq_time\n', 'MODIS_NRT'), []);
});

test('error bodies throw FirmsError with codes', () => {
  const cases = [['Invalid MAP_KEY.', 'BAD_KEY'], ['Exceeded transaction limit', 'RATE_LIMIT'], ['Something odd', 'FIRMS_ERROR']];
  for (const [text, code] of cases) {
    assert.throws(() => parseFirmsCsv(text, 'MODIS_NRT'), (e) => e instanceof FirmsError && e.code === code);
  }
});
