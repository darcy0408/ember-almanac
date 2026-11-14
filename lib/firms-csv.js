// Parse FIRMS area-CSV bodies into normalized detections.

export class FirmsError extends Error {
  constructor(message, code = 'FIRMS_ERROR') {
    super(message);
    this.name = 'FirmsError';
    this.code = code;
  }
}

/** Map a plain-text FIRMS error body to an error code. */
export function classifyErrorText(text) {
  const t = String(text).toLowerCase();
  if (t.includes('map_key') || /\bkey\b/.test(t)) return 'BAD_KEY';
  if (t.includes('limit') || t.includes('exceed')) return 'RATE_LIMIT';
  return 'FIRMS_ERROR';
}

export function confFromModis(v) {
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '') return n < 30 ? 'low' : n < 80 ? 'nominal' : 'high';
  return confFromLetter(v);
}

function confFromLetter(v) {
  const c = String(v ?? '').trim().toLowerCase()[0];
  if (c === 'h') return 'high';
  if (c === 'l') return 'low';
  return 'nominal'; // 'n' or unknown
}

const MODIS_SATS = { t: 'Terra', a: 'Aqua', terra: 'Terra', aqua: 'Aqua' };
const VIIRS_SATS = { n: 'SNPP', snpp: 'SNPP', n20: 'NOAA-20', n21: 'NOAA-21' };

function parseUtc(date, time) {
  const t = String(time ?? '0').trim().padStart(4, '0');
  const ms = Date.parse(`${String(date).trim()}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
  return ms;
}

/**
 * @param {string} text raw response body
 * @param {string} source FIRMS source id, e.g. VIIRS_NOAA20_NRT
 */
export function parseFirmsCsv(text, source) {
  const body = String(text ?? '').replace(/^﻿/, '').trim();
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  if (!header.includes('latitude')) {
    const msg = body.slice(0, 300);
    throw new FirmsError(msg, classifyErrorText(msg));
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const sensor = String(source).toUpperCase().startsWith('MODIS') ? 'MODIS' : 'VIIRS';
  const satMap = sensor === 'MODIS' ? MODIS_SATS : VIIRS_SATS;
  const get = (cols, name) => (idx[name] === undefined ? undefined : cols[idx[name]]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',');
    const lat = parseFloat(get(cols, 'latitude'));
    const lon = parseFloat(get(cols, 'longitude'));
    const utc = parseUtc(get(cols, 'acq_date'), get(cols, 'acq_time'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(utc)) continue;
    const rawSat = String(get(cols, 'satellite') ?? '').trim();
    const satellite = satMap[rawSat.toLowerCase()] || rawSat || source;
    const confRaw = get(cols, 'confidence');
    const frp = parseFloat(get(cols, 'frp'));
    const dn = String(get(cols, 'daynight') ?? '').trim().toUpperCase();
    out.push({
      lat, lon, utc, sensor, satellite,
      conf: sensor === 'MODIS' ? confFromModis(confRaw) : confFromLetter(confRaw),
      frp: Number.isFinite(frp) ? frp : 0,
      daynight: dn === 'N' ? 'N' : 'D',
      source,
    });
  }
  return out;
}
