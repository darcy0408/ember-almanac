import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFirmsClient } from './lib/firms-client.js';
import { bboxOfGeometry, pointInGeometry, validateBbox } from './lib/geo.js';
import { harmonize } from './lib/harmonize.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 2 * 1024 * 1024;
const MAX_CELLS = 25000;
const MAX_SPAN_DAYS = 31;
const DAY = 86400000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

const STATUS = { NO_KEY: 503, BAD_REQUEST: 400, BAD_KEY: 502, RATE_LIMIT: 429, FIRMS_ERROR: 502, NOT_FOUND: 404 };

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendError(res, err) {
  const known = err instanceof ApiError || err?.name === 'FirmsError';
  const code = known && STATUS[err.code] ? err.code : 'FIRMS_ERROR';
  const message = known ? String(err.message) : 'Unexpected server error.';
  sendJson(res, STATUS[code], { error: { code, message } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new ApiError('BAD_REQUEST', 'Request body exceeds 2 MB.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('BAD_REQUEST', 'Request body is not valid JSON.'); }
}

function parseDate(s, name) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ApiError('BAD_REQUEST', `${name} must be YYYY-MM-DD.`);
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== s) throw new ApiError('BAD_REQUEST', `${name} is not a valid date.`);
  return ms;
}
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

function parseRequest(body) {
  if (!body || typeof body !== 'object') throw new ApiError('BAD_REQUEST', 'Body must be a JSON object.');
  const s = parseDate(body.start, 'start');
  const e = parseDate(body.end, 'end');
  if (e < s) throw new ApiError('BAD_REQUEST', 'end must not be before start.');
  if ((e - s) / DAY + 1 > MAX_SPAN_DAYS) throw new ApiError('BAD_REQUEST', `Date span must be at most ${MAX_SPAN_DAYS} days.`);

  const area = body.area;
  let bbox, geometry = null;
  if (area?.type === 'bbox') {
    bbox = area.bbox;
  } else if (area?.type === 'polygon') {
    geometry = area.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
      throw new ApiError('BAD_REQUEST', 'geometry must be a GeoJSON Polygon or MultiPolygon.');
    }
    try { bbox = bboxOfGeometry(geometry); } catch { throw new ApiError('BAD_REQUEST', 'Invalid geometry coordinates.'); }
  } else {
    throw new ApiError('BAD_REQUEST', 'area.type must be "bbox" or "polygon".');
  }
  const bad = validateBbox(bbox, 20);
  if (bad) throw new ApiError('BAD_REQUEST', bad);
  return { bbox, geometry, startMs: s, endMs: e };
}

async function handleCalendar(req, res, firmsClient) {
  if (!firmsClient) {
    throw new ApiError('NO_KEY', 'FIRMS_MAP_KEY is not configured. Set FIRMS_MAP_KEY in .env (get one free at https://firms.modaps.eosdis.nasa.gov/api/map_key/) and restart the server.');
  }
  const { bbox, geometry, startMs, endMs } = parseRequest(await readJson(req));
  const start = fmt(startMs), end = fmt(endMs);
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const tzOffsetHours = Math.round(centerLon / 15);

  let { detections, sources } = await firmsClient.fetchDetections({
    bbox, startUtc: fmt(startMs - DAY), endUtc: fmt(endMs + DAY),
  });
  if (geometry) detections = detections.filter((d) => pointInGeometry(d.lon, d.lat, geometry));

  const h = harmonize(detections, { tzOffsetHours });
  const days = h.days.filter((d) => d.date >= start && d.date <= end);
  let cells = h.cells.filter((c) => c.date >= start && c.date <= end);
  let cellsTruncated = false;
  if (cells.length > MAX_CELLS) {
    cellsTruncated = true;
    cells = cells.sort((a, b) => b.frp - a.frp).slice(0, MAX_CELLS).sort((a, b) => a.date.localeCompare(b.date));
  }
  return { start, end, tzOffsetHours, cellSizeKm: 1, sources, days, cells, cellsTruncated };
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new ApiError('BAD_REQUEST', 'Bad path encoding.'); }
  if (rel.includes('\0')) throw new ApiError('BAD_REQUEST', 'Bad path.');
  const publicRoot = resolve(PUBLIC_DIR);
  let file = resolve(join(publicRoot, normalize(rel)));
  if (file !== publicRoot && !file.startsWith(publicRoot + sep)) throw new ApiError('NOT_FOUND', 'Not found.');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    throw new ApiError('NOT_FOUND', 'Not found.');
  }
}

export function createServer({ firmsClient = null } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api/status' && req.method === 'GET') {
        let availability = null;
        if (firmsClient?.getAvailability) {
          try { availability = (await firmsClient.getAvailability()) ?? null; } catch { availability = null; }
        }
        return sendJson(res, 200, { hasKey: !!firmsClient, availability });
      }
      if (pathname === '/api/calendar') {
        if (req.method !== 'POST') throw new ApiError('BAD_REQUEST', 'Use POST for /api/calendar.');
        return sendJson(res, 200, await handleCalendar(req, res, firmsClient));
      }
      if (pathname.startsWith('/api/')) throw new ApiError('NOT_FOUND', 'Unknown API endpoint.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError('BAD_REQUEST', 'Method not allowed.');
      await serveStatic(req, res, pathname);
    } catch (err) {
      if (res.headersSent) return res.end();
      sendError(res, err);
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mapKey = process.env.FIRMS_MAP_KEY?.trim();
  const firmsClient = mapKey ? createFirmsClient({ mapKey }) : null;
  const port = Number(process.env.PORT) || 8787;
  createServer({ firmsClient }).listen(port, () => {
    console.log(`Ember Almanac on http://localhost:${port} (FIRMS key ${mapKey ? 'configured' : 'NOT configured'})`);
  });
}
