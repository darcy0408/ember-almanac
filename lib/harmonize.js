// Harmonize MODIS and VIIRS detections onto one grid and one (local) calendar.
//
// Why this exists: MODIS pixels are ~1 km, VIIRS ~375 m, and the two sensors
// overpass at different times. Counting raw detections makes VIIRS look ~8x
// "more active" and double counts a fire seen by both. So we:
//   1. bucket everything into ~1 km cells (the coarser footprint) and count
//      distinct cells per day as the headline metric;
//   2. use local solar days, because a UTC day splits the afternoon burn peak
//      in the Americas across two dates;
//   3. compute FRP without double counting (see cellFrp).

export const CELL_DEG = 0.01; // ~1.11 km of latitude

const CONF_RANK = { low: 0, nominal: 1, high: 2 };
const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** Cell for a point. Height is fixed in latitude; width widens with latitude
 *  so cells stay roughly square on the ground (width uses the row centre). */
export function cellOf(lat, lon) {
  const row = Math.floor(lat / CELL_DEG);
  const centerLat = (row + 0.5) * CELL_DEG;
  const width = CELL_DEG / Math.cos((centerLat * Math.PI) / 180);
  const col = Math.floor(lon / width);
  return { id: `${row}:${col}`, lat: centerLat, lon: (col + 0.5) * width };
}

export function localDate(utcMs, tzOffsetHours) {
  return new Date(utcMs + tzOffsetHours * 3600e3).toISOString().slice(0, 10);
}

/**
 * FRP of one cell on one day, without double counting.
 * - Several VIIRS pixels (375 m) inside one 1 km cell in the same overpass
 *   are different parts of the same fire front: they ADD.
 * - The same sensor seen again on a later overpass observes the same fire
 *   again: taking the max overpass sum avoids adding it twice.
 * - MODIS and VIIRS both measure the same fire: take the max of the sensors
 *   rather than their sum.
 * Overpass = satellite + acquisition minute.
 */
function cellFrp(dets) {
  const perSensor = {};
  for (const d of dets) {
    const s = (perSensor[d.sensor] ??= new Map());
    const key = `${d.satellite}|${Math.floor(d.utc / 60000)}`;
    s.set(key, (s.get(key) || 0) + (d.frp || 0));
  }
  let best = 0;
  for (const m of Object.values(perSensor)) best = Math.max(best, ...m.values());
  return best;
}

export function harmonize(detections, { tzOffsetHours = 0 } = {}) {
  const groups = new Map(); // `${date}|${cellId}` -> { date, cell, dets }
  for (const d of detections) {
    const date = localDate(d.utc, tzOffsetHours);
    const cell = cellOf(d.lat, d.lon);
    const key = `${date}|${cell.id}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { date, cell, dets: [] }));
    g.dets.push(d);
  }

  // Which sensors saw each cell-day, so agreement can tolerate geolocation
  // error: a MODIS pixel centre is only good to about a pixel (and pixels grow
  // to ~2 x 4.8 km at the scan edge), so the same fire often lands one cell
  // over from the VIIRS detections. A cell seen by one sensor counts as
  // confirmed by the other when the other sensor has a detection in the same
  // cell or any of its 8 neighbours on the same local day.
  const seen = { MODIS: new Set(), VIIRS: new Set() };
  for (const [key, g] of groups) {
    for (const d of g.dets) seen[d.sensor]?.add(key);
  }
  const nearbyHas = (sensor, date, cell) => {
    for (let dr = -1; dr <= 1; dr++) {
      const lat = cell.lat + dr * CELL_DEG;
      const width = CELL_DEG / Math.cos((lat * Math.PI) / 180);
      for (let dc = -1; dc <= 1; dc++) {
        if (seen[sensor].has(`${date}|${cellOf(lat, cell.lon + dc * width).id}`)) return true;
      }
    }
    return false;
  };

  const cells = [];
  const dayMap = new Map();
  for (const { date, cell, dets } of groups.values()) {
    const modisN = dets.filter((d) => d.sensor === 'MODIS').length;
    const viirsN = dets.length - modisN;
    const sensors = (modisN || nearbyHas('MODIS', date, cell)) && (viirsN || nearbyHas('VIIRS', date, cell))
      ? 'both' : modisN ? 'modis' : 'viirs';
    const conf = dets.reduce((c, d) => (CONF_RANK[d.conf] > CONF_RANK[c] ? d.conf : c), 'low');
    const night = dets.some((d) => d.daynight === 'N');
    const frp = round(cellFrp(dets), 1);

    cells.push({ date, lat: round(cell.lat, 4), lon: round(cell.lon, 4), sensors, conf, frp, modisN, viirsN });

    let day = dayMap.get(date);
    if (!day) {
      dayMap.set(date, (day = {
        date, cells: 0, both: 0, modisOnly: 0, viirsOnly: 0, frp: 0,
        modisDetections: 0, viirsDetections: 0, highConfCells: 0, nightCells: 0,
      }));
    }
    day.cells++;
    if (sensors === 'both') day.both++; else if (sensors === 'modis') day.modisOnly++; else day.viirsOnly++;
    day.frp += frp;
    day.modisDetections += modisN;
    day.viirsDetections += viirsN;
    if (conf === 'high') day.highConfCells++;
    if (night) day.nightCells++;
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) day.frp = round(day.frp, 1);
  cells.sort((a, b) => a.date.localeCompare(b.date));
  return { days, cells };
}
