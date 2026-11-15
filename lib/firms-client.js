import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FirmsError, parseFirmsCsv } from './firms-csv.js';

const BASE = 'https://firms.modaps.eosdis.nasa.gov/api';
const DAY = 86400000;
const CHUNK_DAYS = 5;
const MAX_CONCURRENCY = 6;
const TIMEOUT_MS = 30000;
const AVAIL_TTL = 6 * 3600e3;
const RECENT_TTL = 3600e3;

export const FAMILIES = [
  { id: 'MODIS', family: 'MODIS' },
  { id: 'VIIRS_SNPP', family: 'VIIRS' },
  { id: 'VIIRS_NOAA20', family: 'VIIRS' },
  { id: 'VIIRS_NOAA21', family: 'VIIRS' },
];

const dayNum = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const dayStr = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/** Parse the data_availability CSV tolerantly. Returns {source:{min,max}} or null. */
export function parseAvailability(text) {
  const lines = String(text ?? '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const h = lines[0].split(',').map((x) => x.trim().toLowerCase());
  const iId = h.findIndex((x) => x.includes('id') || x.includes('source'));
  const iMin = h.findIndex((x) => x.includes('min'));
  const iMax = h.findIndex((x) => x.includes('max'));
  if (iId < 0 || iMin < 0 || iMax < 0) return null;
  const out = {};
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  for (const line of lines.slice(1)) {
    const c = line.split(',').map((x) => x.trim());
    const min = c[iMin]?.slice(0, 10), max = c[iMax]?.slice(0, 10);
    if (c[iId] && isDate(min) && isDate(max)) out[c[iId]] = { min, max };
  }
  return Object.keys(out).length ? out : null;
}

/** Snap a bbox outward to 0.1 degrees (stable cache keys). */
export function snapBbox([w, s, e, n]) {
  const r = (v) => Math.round(v * 10) / 10;
  return [
    Math.max(-180, r(Math.floor(w * 10 + 1e-9) / 10)),
    Math.max(-90, r(Math.floor(s * 10 + 1e-9) / 10)),
    Math.min(180, r(Math.ceil(e * 10 - 1e-9) / 10)),
    Math.min(90, r(Math.ceil(n * 10 - 1e-9) / 10)),
  ];
}

/** Chunks on a fixed 5-day grid (days since epoch, multiples of 5). */
export function chunkStarts(startUtc, endUtc) {
  const out = [];
  for (let c = Math.floor(dayNum(startUtc) / CHUNK_DAYS) * CHUNK_DAYS; c <= dayNum(endUtc); c += CHUNK_DAYS) {
    out.push({ start: dayStr(c), startN: c, endN: c + CHUNK_DAYS - 1 });
  }
  return out;
}

export function createFirmsClient({ mapKey, fetchImpl = fetch, cacheDir = '.cache/firms', now = () => Date.now() } = {}) {
  const redact = (s) => (mapKey ? String(s).split(mapKey).join('***') : String(s));

  // ---- concurrency limiter ----
  let active = 0;
  const waiters = [];
  async function limited(fn) {
    while (active >= MAX_CONCURRENCY) await new Promise((r) => waiters.push(r));
    active++;
    try { return await fn(); } finally { active--; waiters.shift()?.(); }
  }

  async function httpGet(url) {
    return limited(async () => {
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        try {
          const res = await fetchImpl(url, { signal: ac.signal });
          const text = await res.text();
          if (res.status >= 500) { lastErr = new FirmsError(`FIRMS returned HTTP ${res.status}`); continue; }
          if (res.status === 429) throw new FirmsError('FIRMS rate limit exceeded', 'RATE_LIMIT');
          if (res.status === 401 || res.status === 403) throw new FirmsError('FIRMS rejected the MAP_KEY', 'BAD_KEY');
          return text;
        } catch (err) {
          if (err instanceof FirmsError) throw err;
          const why = err?.name === 'AbortError' ? 'timeout' : err?.message;
          lastErr = new FirmsError(`FIRMS request failed: ${redact(why)}`);
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr;
    });
  }

  // ---- availability ----
  let availCache = null; // { at, value }
  async function getAvailability() {
    if (availCache && now() - availCache.at < (availCache.value ? AVAIL_TTL : 60e3)) return availCache.value;
    let value = null;
    try {
      value = parseAvailability(await httpGet(`${BASE}/data_availability/csv/${mapKey}/ALL`));
    } catch { value = null; }
    availCache = { at: now(), value };
    return value;
  }

  // ---- disk cache of raw CSV ----
  const cachePath = (key) => join(cacheDir, createHash('sha1').update(key).digest('hex') + '.json');
  async function cacheGet(key, ttl) {
    try {
      const j = JSON.parse(await readFile(cachePath(key), 'utf8'));
      if (ttl == null || now() - j.fetchedAt < ttl) return j.body;
    } catch { /* miss */ }
    return null;
  }
  async function cachePut(key, body) {
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath(key), JSON.stringify({ fetchedAt: now(), body }));
    } catch { /* cache is best-effort */ }
  }

  /** Fetch + parse one source/chunk. Raw body cached only if it parsed (not an error). */
  async function fetchChunk(source, bbox, chunk) {
    const key = `${source}|${bbox.join(',')}|${chunk.start}`;
    const recent = chunk.endN >= Math.floor(now() / DAY) - 3;
    const cached = await cacheGet(key, recent ? RECENT_TTL : null);
    if (cached != null) return parseFirmsCsv(cached, source);
    const url = `${BASE}/area/csv/${mapKey}/${source}/${bbox.join(',')}/${CHUNK_DAYS}/${chunk.start}`;
    const body = await httpGet(url);
    let rows;
    try {
      rows = parseFirmsCsv(body, source); // throws FirmsError on error bodies
    } catch (err) {
      // Observed 2026-11-14: once a key is over its transaction limit, FIRMS answers
      // HTTP 400 "Invalid MAP_KEY." - the same text as for a bad key. Ask the status
      // endpoint which it is, so the app says "wait" rather than "your key is wrong".
      if (err instanceof FirmsError && err.code === 'BAD_KEY') {
        const st = await getKeyStatus();
        if (st && st.current >= st.limit) {
          throw new FirmsError(`FIRMS transaction limit reached (${st.limit} per ${st.interval}); try again in a few minutes`, 'RATE_LIMIT');
        }
      }
      throw err;
    }
    await cachePut(key, body);
    return rows;
  }

  /** { limit, current, interval } for this key, or null if the status endpoint did not answer. */
  async function getKeyStatus() {
    try {
      const j = JSON.parse(await httpGet(`https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${mapKey}`));
      const limit = Number(j.transaction_limit), current = Number(j.current_transactions);
      if (!Number.isFinite(limit) || !Number.isFinite(current)) return null;
      return { limit, current, interval: String(j.transaction_interval || '10 minutes') };
    } catch { return null; }
  }

  /** Which sources to query for a family/chunk. null = skip, 'unknown' = NRT then SP fallback. */
  function pickSources(fam, chunk, avail) {
    const sp = `${fam.id}_SP`, nrt = `${fam.id}_NRT`;
    if (!avail) return 'unknown';
    const a = dayStr(chunk.startN), b = dayStr(chunk.endN);
    const within = (r) => r && r.min <= a && r.max >= b;
    const overlaps = (r) => r && r.min <= b && r.max >= a;
    if (within(avail[sp])) return [sp];
    if (within(avail[nrt])) return [nrt];
    const list = [];
    if (overlaps(avail[sp])) list.push(sp);
    if (overlaps(avail[nrt])) list.push(nrt);
    return list.length ? list : null;
  }

  async function fetchDetections({ bbox, startUtc, endUtc }) {
    const avail = await getAvailability();
    const qbbox = snapBbox(bbox);
    const chunks = chunkStarts(startUtc, endUtc);
    const lo = Date.parse(`${startUtc}T00:00:00Z`);
    const hi = Date.parse(`${endUtc}T00:00:00Z`) + DAY;

    const jobs = [];
    const stats = new Map(FAMILIES.map((f) => [f.id, { id: f.id, family: f.family, records: 0, chunks: 0, errors: [] }]));
    for (const fam of FAMILIES) {
      for (const chunk of chunks) {
        const sel = pickSources(fam, chunk, avail);
        if (sel === null) continue;
        stats.get(fam.id).chunks++;
        jobs.push((async () => {
          try {
            let rows;
            if (sel === 'unknown') {
              rows = await fetchChunk(`${fam.id}_NRT`, qbbox, chunk);
              if (!rows.length) rows = await fetchChunk(`${fam.id}_SP`, qbbox, chunk);
            } else {
              rows = (await Promise.all(sel.map((s) => fetchChunk(s, qbbox, chunk)))).flat();
            }
            return { fam, rows };
          } catch (err) {
            if (err instanceof FirmsError && (err.code === 'BAD_KEY' || err.code === 'RATE_LIMIT')) {
              throw new FirmsError(redact(err.message), err.code);
            }
            return { fam, error: redact(err?.message || 'unknown error') };
          }
        })());
      }
    }

    const results = await Promise.all(jobs);
    const [w, s, e, n] = bbox;
    const seen = new Set();
    const detections = [];
    for (const r of results) {
      const st = stats.get(r.fam.id);
      if (r.error) { st.errors.push(r.error); continue; }
      for (const d of r.rows) {
        if (d.utc < lo || d.utc >= hi || d.lon < w || d.lon > e || d.lat < s || d.lat > n) continue;
        const k = `${d.lat},${d.lon},${d.utc},${d.satellite}`;
        if (seen.has(k)) continue;
        seen.add(k);
        st.records++;
        detections.push(d);
      }
    }

    const sources = [...stats.values()].map((st) => {
      const out = {
        id: st.id, family: st.family, records: st.records, chunks: st.chunks,
        status: st.errors.length ? 'error' : st.records ? 'ok' : 'empty',
      };
      if (st.errors.length) out.message = st.errors[0];
      return out;
    });
    return { detections, sources };
  }

  return { getAvailability, fetchDetections, getKeyStatus };
}
