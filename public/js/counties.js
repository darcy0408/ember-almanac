// County data: lazy load of us-atlas TopoJSON, labels, search, point-in-polygon hit test, geometry helpers.

const FIPS_TO_USPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
  '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};
const NO_SUFFIX_STATES = new Set(['02', '11', '60', '66', '69', '72', '78']);

let items = null;      // [{fips, label, lower, name, feature, bbox}]
let byFips = new Map();
let loadPromise = null;

export function isLoaded() { return !!items; }

export function bboxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else for (const x of c) walk(x);
  };
  walk(geometry.coordinates);
  return [w, s, e, n];
}

function makeLabel(name, fips) {
  const st = fips.slice(0, 2);
  const abbr = FIPS_TO_USPS[st] || st;
  let base = name;
  if (!NO_SUFFIX_STATES.has(st)) {
    if (st === '22') { if (!/parish/i.test(name)) base = `${name} Parish`; }
    else if (!/\b(county|city|borough|census area|municipality|parish)\b/i.test(name)) base = `${name} County`;
  }
  return `${base}, ${abbr}`;
}

export function loadCounties() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!window.topojson) throw new Error('The topojson library did not load.');
    const res = await fetch('data/counties-10m.json');
    if (!res.ok) throw new Error(`County file returned HTTP ${res.status}.`);
    const topo = await res.json();
    const feats = window.topojson.feature(topo, topo.objects.counties).features;
    items = [];
    for (const f of feats) {
      if (!f.geometry) continue;
      const fips = String(f.id).padStart(5, '0');
      const name = (f.properties && f.properties.name) || fips;
      const label = makeLabel(name, fips);
      const it = { fips, name, label, lower: label.toLowerCase(), nameLower: name.toLowerCase(), feature: f, bbox: bboxOf(f.geometry) };
      items.push(it);
      byFips.set(fips, it);
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items.length;
  })().catch((err) => { loadPromise = null; throw err; });
  return loadPromise;
}

export function getCounty(fips) { return byFips.get(fips) || null; }

export function searchCounties(q, limit = 8) {
  if (!items) return [];
  const s = q.trim().toLowerCase();
  if (s.length < 1) return [];
  const starts = [], inc = [];
  for (const it of items) {
    if (it.nameLower.startsWith(s) || it.lower.startsWith(s)) starts.push(it);
    else if (it.lower.includes(s)) inc.push(it);
    if (starts.length >= limit) break;
  }
  return starts.concat(inc).slice(0, limit);
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyContains(rings, x, y) {
  if (!ringContains(rings[0], x, y)) return false;
  for (let i = 1; i < rings.length; i++) if (ringContains(rings[i], x, y)) return false;
  return true;
}
export function geometryContains(geometry, x, y) {
  if (geometry.type === 'Polygon') return polyContains(geometry.coordinates, x, y);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => polyContains(p, x, y));
  return false;
}

/** Hit test: only features whose bbox contains the point are tested exactly. */
export function countyAt(lat, lon) {
  if (!items) return null;
  for (const it of items) {
    const b = it.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (geometryContains(it.feature.geometry, lon, lat)) return it;
  }
  return null;
}

/** Approximate geodesic area in km2 (local equirectangular shoelace per ring). */
export function approxAreaKm2(geometry) {
  const ringArea = (ring) => {
    let latSum = 0;
    for (const p of ring) latSum += p[1];
    const k = Math.cos(((latSum / ring.length) * Math.PI) / 180);
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] * 111.32 * k) * (ring[i][1] * 110.57) - (ring[i][0] * 111.32 * k) * (ring[j][1] * 110.57);
    }
    return Math.abs(a / 2);
  };
  const polyArea = (rings) => rings.reduce((acc, r, i) => acc + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
  if (geometry.type === 'Polygon') return polyArea(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((a, p) => a + polyArea(p), 0);
  return 0;
}

export function bboxAreaKm2(b) {
  const k = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180);
  return Math.abs(b[2] - b[0]) * 111.32 * k * Math.abs(b[3] - b[1]) * 110.57;
}
