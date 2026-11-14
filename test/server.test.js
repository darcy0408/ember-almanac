import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { FirmsError } from '../lib/firms-csv.js';

async function run(firmsClient, fn) {
  const server = createServer({ firmsClient });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const post = (base, body) =>
  fetch(`${base}/api/calendar`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const poly = { type: 'Polygon', coordinates: [[[-118.1, 34], [-117.9, 34], [-117.9, 34.2], [-118.1, 34.2], [-118.1, 34]]] };
const det = (lon, lat, extra = {}) => ({
  lat, lon, utc: Date.UTC(2025, 7, 10, 21, 30), sensor: 'MODIS', satellite: 'Terra',
  conf: 'high', frp: 10, daynight: 'D', source: 'MODIS_NRT', ...extra,
});

test('503 NO_KEY without a client; status reports hasKey false', async () => {
  await run(null, async (base) => {
    const r = await post(base, { area: { type: 'bbox', bbox: [0, 0, 1, 1] }, start: '2025-08-01', end: '2025-08-05' });
    assert.equal(r.status, 503);
    const j = await r.json();
    assert.equal(j.error.code, 'NO_KEY');
    assert.match(j.error.message, /FIRMS_MAP_KEY/);
    assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { hasKey: false, availability: null });
  });
});

test('400 on a 40-day span, oversized bbox, bad JSON', async () => {
  await run({ fetchDetections: async () => assert.fail('should not be called') }, async (base) => {
    let r = await post(base, { area: { type: 'bbox', bbox: [0, 0, 1, 1] }, start: '2025-08-01', end: '2025-09-09' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'BAD_REQUEST');
    r = await post(base, { area: { type: 'bbox', bbox: [0, 0, 30, 1] }, start: '2025-08-01', end: '2025-08-02' });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/api/calendar`, { method: 'POST', body: '{nope' });
    assert.equal(r.status, 400);
  });
});

test('happy path: polygon filter, local-day shift, range trim', async () => {
  let seen;
  const client = {
    getAvailability: async () => ({ MODIS_NRT: { min: '2025-01-01', max: '2025-11-13' } }),
    fetchDetections: async (args) => {
      seen = args;
      return {
        sources: [{ id: 'MODIS', family: 'MODIS', records: 4, chunks: 1, status: 'ok' }],
        detections: [
          det(-118.0, 34.1),                                        // inside polygon
          det(-118.0, 34.1, { sensor: 'VIIRS', satellite: 'NOAA-20', frp: 3 }), // same cell, other sensor
          det(-117.5, 34.1),                                        // outside polygon -> dropped
          det(-118.0, 34.1, { utc: Date.UTC(2025, 7, 20, 12) }),   // outside requested range -> trimmed
        ],
      };
    },
  };
  await run(client, async (base) => {
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.hasKey, true);
    assert.ok(st.availability.MODIS_NRT);
    const r = await post(base, { area: { type: 'polygon', geometry: poly }, start: '2025-08-09', end: '2025-08-11' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(seen.startUtc, '2025-08-08');
    assert.equal(seen.endUtc, '2025-08-12');
    assert.deepEqual(seen.bbox, [-118.1, 34, -117.9, 34.2]);
    assert.equal(j.tzOffsetHours, -8);
    assert.equal(j.cellSizeKm, 1);
    assert.equal(j.cellsTruncated, false);
    assert.equal(j.days.length, 1);
    assert.equal(j.days[0].date, '2025-08-10');
    assert.equal(j.days[0].cells, 1);
    assert.equal(j.days[0].both, 1);
    assert.equal(j.cells.length, 1);
    assert.equal(j.cells[0].sensors, 'both');
    assert.equal(j.sources.length, 1);
  });
});

test('FIRMS errors map to status codes; unknown paths 404', async () => {
  const client = { fetchDetections: async () => { throw new FirmsError('Exceeded limit', 'RATE_LIMIT'); } };
  await run(client, async (base) => {
    const r = await post(base, { area: { type: 'bbox', bbox: [0, 0, 1, 1] }, start: '2025-08-01', end: '2025-08-02' });
    assert.equal(r.status, 429);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 404);
  });
});
