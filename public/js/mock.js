// DEV-ONLY mock backend. Imported only when the URL contains ?mock=1. Generates deterministic,
// plausible-looking (but entirely synthetic) fire data. Never used in real mode.
import { addDays, diffDays, parseDate } from './util.js';

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

function areaBbox(area) {
  if (area.type === 'bbox') return area.bbox;
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  walk(area.geometry.coordinates);
  return [w, s, e, n];
}

function firesFor(areaKey, year, bbox) {
  const r = prng(hashStr(`${areaKey}|${year}`));
  const count = 3 + Math.floor(r() * 4);
  const fires = [];
  for (let i = 0; i < count; i++) {
    // start day of year skewed toward Jul-Sep
    const doy = Math.round(150 + Math.abs(gauss(r)) * 55 * (r() < 0.5 ? 1 : -0.6) + 30);
    const dur = 6 + Math.floor(r() * 38);
    const peak = r() < 0.15 ? 400 + r() * 500 : 4 + Math.pow(r(), 2.2) * 160;
    fires.push({
      id: `${year}-${i}`, doy: Math.max(20, Math.min(340, doy)), dur, peak,
      lon: bbox[0] + (0.15 + 0.7 * r()) * (bbox[2] - bbox[0]),
      lat: bbox[1] + (0.15 + 0.7 * r()) * (bbox[3] - bbox[1]),
    });
  }
  return fires;
}

function genDay(areaKey, date, bbox) {
  const year = +date.slice(0, 4);
  const doy = diffDays(`${year}-01-01`, date) + 1;
  const cells = new Map();
  for (const f of firesFor(areaKey, year, bbox)) {
    const t = (doy - f.doy) / f.dur;
    if (t < 0 || t > 1) continue;
    const r = prng(hashStr(`${f.id}|${date}`));
    if (r() < 0.12) continue; // cloudy / no overpass day
    const bell = Math.sin(Math.PI * t) ** 1.5;
    const n = Math.max(1, Math.round(f.peak * bell * (0.6 + 0.8 * r())));
    const spread = 0.004 * Math.sqrt(f.peak) + 0.01;
    for (let k = 0; k < n; k++) {
      let lat = f.lat + gauss(r) * spread, lon = f.lon + gauss(r) * spread;
      lat = Math.min(bbox[3], Math.max(bbox[1], lat)); lon = Math.min(bbox[2], Math.max(bbox[0], lon));
      lat = Math.round(lat / 0.009) * 0.009; lon = Math.round(lon / 0.0118) * 0.0118;
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (cells.has(key)) continue;
      const u = r();
      const sensors = u < 0.38 ? 'both' : u < 0.48 ? 'modis' : 'viirs';
      const c = r();
      cells.set(key, {
        date, lat: +lat.toFixed(4), lon: +lon.toFixed(4), sensors,
        conf: c < 0.3 ? 'high' : c < 0.8 ? 'nominal' : 'low',
        frp: +(1 + Math.pow(r(), 2.5) * 90).toFixed(1),
        modisN: sensors === 'viirs' ? 0 : 1 + Math.floor(r() * 2),
        viirsN: sensors === 'modis' ? 0 : 1 + Math.floor(r() * 4),
      });
    }
  }
  return [...cells.values()];
}

function generate(body) {
  const bbox = areaBbox(body.area);
  const areaKey = JSON.stringify(bbox.map((x) => +x.toFixed(2)));
  const tz = Math.round(((bbox[0] + bbox[2]) / 2) / 15);
  const days = [], allCells = [];
  const nDays = diffDays(body.start, body.end) + 1;
  const r = prng(hashStr(areaKey));
  for (let i = 0; i < nDays; i++) {
    const date = addDays(body.start, i);
    const cells = genDay(areaKey, date, bbox);
    if (!cells.length) continue;
    let both = 0, modisOnly = 0, viirsOnly = 0, frp = 0, md = 0, vd = 0, hc = 0, night = 0;
    for (const c of cells) {
      if (c.sensors === 'both') both++; else if (c.sensors === 'modis') modisOnly++; else viirsOnly++;
      frp += c.frp; md += c.modisN; vd += c.viirsN; if (c.conf === 'high') hc++; if (r() < 0.3) night++;
    }
    days.push({ date, cells: cells.length, both, modisOnly, viirsOnly, frp: +frp.toFixed(1), modisDetections: md, viirsDetections: vd, highConfCells: hc, nightCells: night });
    allCells.push(...cells);
  }
  const rec = (n) => Math.round(n * (0.8 + r() * 0.4));
  const vd = days.reduce((a, d) => a + d.viirsDetections, 0), md = days.reduce((a, d) => a + d.modisDetections, 0);
  const src = (id, family, records, status, message) => ({ id, family, records, chunks: Math.max(1, Math.ceil(nDays / 10)), status, message });
  return {
    start: body.start, end: body.end, tzOffsetHours: tz, cellSizeKm: 1,
    sources: [
      src('MODIS_NRT', 'MODIS', md, md ? 'ok' : 'empty'),
      src('VIIRS_SNPP_NRT', 'VIIRS_SNPP', rec(vd * 0.3), vd ? 'ok' : 'empty'),
      src('VIIRS_NOAA20_NRT', 'VIIRS_NOAA20', rec(vd * 0.35), vd ? 'ok' : 'empty'),
      src('VIIRS_NOAA21_NRT', 'VIIRS_NOAA21', rec(vd * 0.35), vd ? 'ok' : 'empty'),
    ],
    days, cells: allCells, cellsTruncated: false,
  };
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function mockFetch(path, init = {}) {
  const wait = (ms) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
  });
  await wait(path === 'api/status' ? 50 : 350 + Math.random() * 500);
  if (path === 'api/status') return json(200, { hasKey: true, availability: null });
  if (path === 'api/calendar') {
    const body = JSON.parse(init.body);
    if (parseDate(body.start) == null || parseDate(body.end) == null) return json(400, { error: { code: 'BAD_REQUEST', message: 'Bad dates.' } });
    return json(200, generate(body));
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'Mock has no such endpoint.' } });
}
