import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFirmsClient, chunkStarts, snapBbox, parseAvailability } from '../lib/firms-client.js';

const KEY = 'SECRETKEY123';
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = Date.parse('2025-11-14T12:00:00Z');
const BBOX = [-118.31, 33.92, -117.98, 34.18];
const resp = (body, status = 200) => ({ status, ok: status < 400, text: async () => body });

const AVAIL = [
  'data_id,min_date,max_date',
  'MODIS_SP,2000-11-01,2025-06-30',
  'MODIS_NRT,2025-05-01,2025-11-13',
  'VIIRS_NOAA20_SP,2018-01-01,2025-06-30',
].join('\n');

function stub({ avail = AVAIL, area } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/data_availability/')) return avail == null ? resp('Not found', 404) : resp(avail);
    const m = url.match(/\/area\/csv\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/([\d-]+)$/);
    assert.ok(m, `unexpected url ${url}`);
    const [, key, source, bbox, range, date] = m;
    assert.equal(key, KEY);
    assert.equal(range, '5');
    if (area) { const r = area({ source, bbox, date }); if (r !== undefined) return r; }
    return resp(source.startsWith('MODIS') ? fx('modis.csv') : fx('viirs.csv'));
  };
  return { fetchImpl, calls, area: () => calls.filter((u) => u.includes('/area/')) };
}
const mk = async (s, extra = {}) =>
  createFirmsClient({ mapKey: KEY, fetchImpl: s.fetchImpl, cacheDir: await mkdtemp(join(tmpdir(), 'ember-')), now: () => NOW, ...extra });

test('chunks align to a fixed 5-day grid and bbox snaps outward', () => {
  const cs = chunkStarts('2025-08-07', '2025-08-12');
  for (const c of cs) assert.equal(c.startN % 5, 0);
  assert.ok(cs[0].start <= '2025-08-07' && cs.at(-1).endN * 86400000 >= Date.parse('2025-08-12'));
  assert.deepEqual(snapBbox(BBOX), [-118.4, 33.9, -117.9, 34.2]);
});

test('parseAvailability tolerant of header order, null on garbage', () => {
  assert.deepEqual(parseAvailability('max_date,data_id,min_date\n2025-02-01,MODIS_SP,2000-01-01'), { MODIS_SP: { min: '2000-01-01', max: '2025-02-01' } });
  assert.equal(parseAvailability('Invalid MAP_KEY.'), null);
});

test('SP vs NRT selection from availability; uncovered families skipped; results trimmed and deduped', async () => {
  const s = stub();
  const c = await mk(s);
  const out = await c.fetchDetections({ bbox: BBOX, startUtc: '2025-08-10', endUtc: '2025-08-11' });
  const urls = s.area();
  assert.ok(urls.length > 0);
  assert.ok(urls.every((u) => u.includes('/MODIS_NRT/')), 'Aug 2025 is NRT-only for MODIS; VIIRS families not covered');
  assert.ok(urls.every((u) => u.includes('/-118.4,33.9,-117.9,34.2/')));
  assert.equal(out.sources.find((x) => x.id === 'VIIRS_NOAA20').chunks, 0);
  const modis = out.sources.find((x) => x.id === 'MODIS');
  assert.equal(modis.status, 'ok');
  assert.equal(modis.records, 3); // duplicates across overlapping chunks removed
  assert.equal(out.detections.length, 3);

  const s2 = stub();
  await (await mk(s2)).fetchDetections({ bbox: BBOX, startUtc: '2025-01-10', endUtc: '2025-01-11' });
  const u2 = s2.area();
  assert.ok(u2.some((u) => u.includes('/MODIS_SP/')) && u2.some((u) => u.includes('/VIIRS_NOAA20_SP/')));
  assert.ok(!u2.some((u) => u.includes('_NRT/')));
});

test('boundary chunk queries both SP and NRT', async () => {
  const s = stub();
  await (await mk(s)).fetchDetections({ bbox: BBOX, startUtc: '2025-06-28', endUtc: '2025-07-01' });
  const u = s.area();
  assert.ok(u.some((x) => x.includes('/MODIS_SP/')) && u.some((x) => x.includes('/MODIS_NRT/')));
});

test('unknown availability: NRT first, SP fallback on zero rows', async () => {
  const s = stub({ avail: null, area: ({ source }) => (source === 'MODIS_NRT' ? resp('latitude,longitude,acq_date,acq_time\n') : undefined) });
  const out = await (await mk(s)).fetchDetections({ bbox: BBOX, startUtc: '2025-08-10', endUtc: '2025-08-10' });
  const u = s.area();
  assert.ok(u.some((x) => x.includes('/MODIS_NRT/')) && u.some((x) => x.includes('/MODIS_SP/')));
  assert.equal(out.sources.find((x) => x.id === 'MODIS').status, 'ok');
  assert.ok(u.some((x) => x.includes('/VIIRS_SNPP_NRT/')));
});

test('second call is served from disk cache', async () => {
  const s = stub();
  const c = await mk(s);
  const args = { bbox: BBOX, startUtc: '2025-01-10', endUtc: '2025-01-11' };
  await c.fetchDetections(args);
  const n = s.area().length;
  assert.ok(n > 0);
  await c.fetchDetections(args);
  assert.equal(s.area().length, n);
});

test('error bodies are never cached and the key never leaks', async () => {
  const s = stub({ area: () => resp('Invalid MAP_KEY.') });
  const dir = await mkdtemp(join(tmpdir(), 'ember-'));
  const c = createFirmsClient({ mapKey: KEY, fetchImpl: s.fetchImpl, cacheDir: dir, now: () => NOW });
  await assert.rejects(
    c.fetchDetections({ bbox: BBOX, startUtc: '2025-08-10', endUtc: '2025-08-10' }),
    (e) => e.code === 'BAD_KEY' && !e.message.includes(KEY),
  );
  assert.deepEqual(await readdir(dir).catch(() => []), []);
});

test('rate limit propagates; a failing family does not fail the request', async () => {
  const s = stub({ area: () => resp('Exceeded transaction limit') });
  await assert.rejects(
    (await mk(s)).fetchDetections({ bbox: BBOX, startUtc: '2025-08-10', endUtc: '2025-08-10' }),
    (e) => e.code === 'RATE_LIMIT',
  );

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/data_availability/')) return resp('Nope', 500);
    if (url.includes('VIIRS_NOAA20')) throw new Error(`connect ECONNRESET ${url}`);
    if (url.includes('VIIRS_SNPP')) return resp('', 200);
    return resp(url.includes('MODIS') ? fx('modis.csv') : fx('viirs.csv'));
  };
  const c = createFirmsClient({ mapKey: KEY, fetchImpl, cacheDir: await mkdtemp(join(tmpdir(), 'ember-')), now: () => NOW });
  const out = await c.fetchDetections({ bbox: BBOX, startUtc: '2025-08-10', endUtc: '2025-08-10' });
  const n20 = out.sources.find((x) => x.id === 'VIIRS_NOAA20');
  assert.equal(n20.status, 'error');
  assert.ok(!n20.message.includes(KEY));
  assert.equal(out.sources.find((x) => x.id === 'MODIS').status, 'ok');
  assert.equal(out.sources.find((x) => x.id === 'VIIRS_SNPP').status, 'empty');
  assert.ok(calls.filter((u) => u.includes('VIIRS_NOAA20_NRT')).length >= 2, 'retried once');
});
