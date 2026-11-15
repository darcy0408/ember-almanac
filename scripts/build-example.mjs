// Precompute the multi-year example served as a static file, so the evidence
// panel loads instantly and needs no MAP_KEY or server at view time.
//
//   node --env-file=.env scripts/build-example.mjs 08077 2013
//
// Pulls every FIRMS detection for one county from Jan 1 of the start year to
// yesterday (cached on disk, so it is resumable), then counts three ways on the
// same ~1 km grid and local-day calendar:
//   M = MODIS only (Terra + Aqua)       - the same two satellites the whole span
//   S = VIIRS Suomi NPP only            - one satellite the whole span (to 2 Nov 2026)
//   A = every sensor together           - what the live calendar shows
// Comparing M with S is like-for-like across years; A is not, because the
// number of VIIRS satellites grew from one to three.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createFirmsClient } from '../lib/firms-client.js';
import { FirmsError } from '../lib/firms-csv.js';
import { bboxOfGeometry, pointInGeometry } from '../lib/geo.js';
import { harmonize } from '../lib/harmonize.js';

const fips = process.argv[2] || '08077';
const startYear = Number(process.argv[3] || 2013);
const mapKey = process.env.FIRMS_MAP_KEY;
if (!mapKey) { console.error('FIRMS_MAP_KEY is not set'); process.exit(1); }

// --- county geometry from the us-atlas TopoJSON (decoded here: no dependencies) ---
const topo = JSON.parse(await readFile(new URL('../public/data/counties-10m.json', import.meta.url), 'utf8'));
function decodeArc(i) {
  const arc = topo.arcs[i < 0 ? ~i : i];
  const { scale, translate } = topo.transform;
  let x = 0, y = 0;
  const pts = arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
  return i < 0 ? pts.reverse() : pts;
}
const ring = (arcs) => arcs.flatMap((a, k) => (k ? decodeArc(a).slice(1) : decodeArc(a)));
const obj = topo.objects.counties.geometries.find((g) => String(g.id).padStart(5, '0') === fips);
if (!obj) { console.error(`No county with FIPS ${fips}`); process.exit(1); }
const geometry = obj.type === 'Polygon'
  ? { type: 'Polygon', coordinates: obj.arcs.map(ring) }
  : { type: 'MultiPolygon', coordinates: obj.arcs.map((poly) => poly.map(ring)) };
const stateName = topo.objects.states.geometries.find((g) => String(g.id).padStart(2, '0') === fips.slice(0, 2))?.properties.name;
const bbox = bboxOfGeometry(geometry);
const tzOffsetHours = Math.round((bbox[0] + bbox[2]) / 2 / 15);

// --- pull, in 90-day blocks so a rate-limit pause loses little ---
const client = createFirmsClient({ mapKey });
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400e3;
const startMs = Date.UTC(startYear, 0, 1) - DAY;          // one UTC day early, for the local-day shift
const endMs = Math.floor(Date.now() / DAY) * DAY;          // today (UTC); trimmed to yesterday local below
const detections = [];
const coverage = {};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** Wait until the key has room: FIRMS allows 5000 transactions per 10 minutes and a
 *  5-day request appears to cost about 5, so a multi-year pull has to pace itself. */
async function waitForBudget() {
  for (;;) {
    const st = await client.getKeyStatus();
    if (st && st.current <= st.limit * 0.5 && (await client.getAvailability())) return;
    console.log(`  waiting for FIRMS budget (${st ? `${st.current}/${st.limit}` : 'status unavailable'})`);
    await sleep(45e3);
  }
}
for (let a = startMs; a <= endMs; a += 90 * DAY) {
  const b = Math.min(a + 89 * DAY, endMs);
  for (let attempt = 1; ; attempt++) {
    await waitForBudget();
    try {
      const r = await client.fetchDetections({ bbox, startUtc: iso(a), endUtc: iso(b) });
      const failed = r.sources.filter((s) => s.status === 'error');
      if (failed.length && attempt < 4) { console.log(`  ${failed.length} source(s) failed, retrying block`); continue; }
      for (const d of r.detections) if (pointInGeometry(d.lon, d.lat, geometry)) detections.push(d);
      for (const s of r.sources) {
        const c = (coverage[s.id] ??= { records: 0, chunks: 0, errors: [] });
        c.records += s.records; c.chunks += s.chunks;
        if (s.status === 'error') c.errors.push(`${iso(a)}..${iso(b)}: ${s.message}`);
      }
      console.log(`${iso(a)}..${iso(b)}  in county so far: ${detections.length}`);
      break;
    } catch (err) {
      if (err instanceof FirmsError && (err.code === 'RATE_LIMIT' || err.code === 'BAD_KEY') && attempt < 40) {
        console.log(`  ${err.code} at ${iso(a)}: ${err.message}`);
        await sleep(45e3);
      } else throw err;
    }
  }
}

// --- count three ways ---
const first = `${startYear}-01-01`;
const last = iso(endMs - DAY);
const sets = {
  M: detections.filter((d) => d.sensor === 'MODIS'),
  S: detections.filter((d) => d.satellite === 'SNPP'),
  A: detections,
};
const daily = {}; // date -> [mCells, mDet, sCells, sDet, aCells, aDet, aFrp, aBoth]
const row = (date) => (daily[date] ??= [0, 0, 0, 0, 0, 0, 0, 0]);
for (const [k, dets] of Object.entries(sets)) {
  for (const d of harmonize(dets, { tzOffsetHours }).days) {
    if (d.date < first || d.date > last) continue;
    const r = row(d.date);
    const n = d.modisDetections + d.viirsDetections;
    if (k === 'M') { r[0] = d.cells; r[1] = n; }
    if (k === 'S') { r[2] = d.cells; r[3] = n; }
    if (k === 'A') { r[4] = d.cells; r[5] = n; r[6] = d.frp; r[7] = d.both; }
  }
}

const out = {
  area: { type: 'county', fips, name: `${obj.properties.name} County, ${stateName}`, bbox },
  start: first, end: last, tzOffsetHours, cellSizeKm: 1,
  generated: new Date().toISOString(),
  columns: ['modisCells', 'modisDetections', 'snppCells', 'snppDetections', 'allCells', 'allDetections', 'allFrp', 'allBoth'],
  snppEnd: '2026-11-02',
  coverage,
  daily: Object.fromEntries(Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))),
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
const file = new URL(`../public/data/example-${fips}.json`, import.meta.url);
await writeFile(file, JSON.stringify(out));
console.log(`wrote ${file.pathname}: ${Object.keys(daily).length} days with detections, ${detections.length} detections`);
console.log(JSON.stringify(coverage, null, 1));
