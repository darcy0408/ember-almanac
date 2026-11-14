// Small GeoJSON helpers (no dependencies).

function eachCoord(coords, fn) {
  if (typeof coords[0] === 'number') fn(coords[0], coords[1]);
  else for (const c of coords) eachCoord(c, fn);
}

export function bboxOfGeometry(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  eachCoord(geometry.coordinates, (x, y) => {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  });
  return [w, s, e, n];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// rings[0] is the outer ring, the rest are holes.
function inPolygon(x, y, rings) {
  if (!rings.length || !inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
  return true;
}

export function pointInGeometry(lon, lat, geometry) {
  if (geometry.type === 'Polygon') return inPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => inPolygon(lon, lat, p));
  return false;
}

/** Returns an error string, or null when valid. */
export function validateBbox(b, maxSpan = 20) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return 'bbox must be [west, south, east, north] numbers';
  }
  const [w, s, e, n] = b;
  if (w < -180 || e > 180 || s < -90 || n > 90) return 'bbox out of range (lon -180..180, lat -90..90)';
  if (!(w < e) || !(s < n)) return 'bbox must have west < east and south < north';
  if (e - w > maxSpan || n - s > maxSpan) return `bbox must be at most ${maxSpan} degrees wide and tall`;
  return null;
}

export function padBbox([w, s, e, n], pad) {
  return [Math.max(-180, w - pad), Math.max(-90, s - pad), Math.min(180, e + pad), Math.min(90, n + pad)];
}
