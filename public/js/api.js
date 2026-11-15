// Backend client. Splits a range into calendar-month pieces, runs 2 at a time, retries once, merges.
import { addDays, daysInMonth, fmtDate, parseDate } from './util.js';

export const MOCK = new URLSearchParams(location.search).get('mock') === '1';

async function doFetch(path, init) {
  if (MOCK) {
    const m = await import('./mock.js'); // loaded only in explicit mock mode
    return m.mockFetch(path, init);
  }
  return fetch(path, init);
}

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function parseError(res) {
  let code = 'HTTP_' + res.status, message = `The server answered HTTP ${res.status}.`;
  try {
    const j = await res.json();
    if (j && j.error) { code = j.error.code || code; message = j.error.message || message; }
  } catch { /* non-JSON body */ }
  return new ApiError(code, message);
}

export async function getStatus() {
  const res = await doFetch('api/status');
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export function splitMonths(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    const t = new Date(parseDate(cur));
    const last = fmtDate(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), daysInMonth(t.getUTCFullYear(), t.getUTCMonth())));
    const to = last < end ? last : end;
    out.push({ start: cur, end: to, key: cur.slice(0, 7) });
    cur = addDays(to, 1);
  }
  return out;
}

async function callMonth(area, piece, signal) {
  const res = await doFetch('api/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area, start: piece.start, end: piece.end }),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

const FATAL = new Set(['NO_KEY', 'BAD_KEY', 'BAD_REQUEST']);
const STATUS_RANK = { ok: 0, empty: 1, error: 2 };

export function mergeResults(parts, start, end) {
  const out = { start, end, tzOffsetHours: null, cellSizeKm: 1, sources: [], days: [], cells: [], cellsTruncated: false };
  const src = new Map();
  for (const p of parts) {
    if (out.tzOffsetHours == null && typeof p.tzOffsetHours === 'number') out.tzOffsetHours = p.tzOffsetHours;
    if (p.cellSizeKm) out.cellSizeKm = p.cellSizeKm;
    out.days.push(...(p.days || []));
    out.cells.push(...(p.cells || []));
    out.cellsTruncated = out.cellsTruncated || !!p.cellsTruncated;
    for (const s of p.sources || []) {
      const cur = src.get(s.id);
      if (!cur) { src.set(s.id, { ...s }); continue; }
      cur.records += s.records || 0;
      cur.chunks += s.chunks || 0;
      if ((STATUS_RANK[s.status] ?? 0) > (STATUS_RANK[cur.status] ?? 0)) { cur.status = s.status; cur.message = s.message; }
      else if (!cur.message && s.message) cur.message = s.message;
    }
  }
  out.sources = [...src.values()];
  // A source that returned records in any month is not "empty" overall.
  for (const s of out.sources) if (s.status === 'empty' && s.records > 0) s.status = 'ok';
  out.days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/**
 * Runs all months. onProgress(done, total, partialMerged) fires after each month finishes.
 * Resolves {merged, failed:[{key,message,code}], total, cancelled}. Throws only on fatal errors.
 */
export async function buildCalendar({ area, start, end, signal, onProgress }) {
  const pieces = splitMonths(start, end);
  const results = new Array(pieces.length).fill(null);
  const failed = [];
  let next = 0, done = 0, fatal = null;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort);

  async function worker() {
    while (!fatal && !signal.aborted) {
      const i = next++;
      if (i >= pieces.length) return;
      let lastErr = null;
      for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
        try {
          results[i] = await callMonth(area, pieces[i], ctrl.signal);
          lastErr = null;
          break;
        } catch (err) {
          if (signal.aborted) return;
          lastErr = err;
          if (err instanceof ApiError && FATAL.has(err.code)) { fatal = err; ctrl.abort(); return; }
          if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (signal.aborted) return;
      if (lastErr) failed.push({ key: pieces[i].key, code: lastErr.code, message: lastErr.message || 'Request failed.' });
      done++;
      onProgress && onProgress(done, pieces.length, mergeResults(results.filter(Boolean), start, end));
    }
  }
  try {
    await Promise.all([worker(), worker()]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (fatal) throw fatal;
  return {
    merged: mergeResults(results.filter(Boolean), start, end),
    failed: failed.sort((a, b) => (a.key < b.key ? -1 : 1)),
    total: pieces.length,
    cancelled: signal.aborted,
  };
}
