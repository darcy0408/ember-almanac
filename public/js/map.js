// Leaflet wrapper: basemap, area outline, per-day cell squares, hand-rolled box drawing.
import { el, fmtLong, fmtNum, fmtInt } from './util.js';

const L = window.L;
let map, areaLayer = null, cellLayer = null, drawRect = null, canvas;
let drawing = null; // {onDone, onCancel, start, active, pointerId}
export const CELL_CAP = 5000;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function initMap(container, onClick) {
  map = L.map(container, { center: [39, -98], zoom: 4, minZoom: 2, worldCopyJump: false, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  canvas = L.canvas({ padding: 0.5 });
  map.on('click', (e) => onClick && onClick(e.latlng));
  return map;
}

export function invalidate() { if (map) map.invalidateSize(); }

export function setArea(area) {
  if (areaLayer) { areaLayer.remove(); areaLayer = null; }
  if (!area) return null;
  const style = { color: css('--outline'), weight: 2, fill: true, fillColor: css('--outline'), fillOpacity: 0.05, interactive: false };
  if (area.type === 'bbox') {
    const [w, s, e, n] = area.bbox;
    areaLayer = L.rectangle([[s, w], [n, e]], style).addTo(map);
  } else {
    areaLayer = L.geoJSON(area.geometry, { style: () => style }).addTo(map);
  }
  return areaLayer.getBounds();
}

export function fitBounds(b, maxZoom) {
  if (b && b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: maxZoom || 11, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
}
export function fitArea() { if (areaLayer) fitBounds(areaLayer.getBounds()); }

export function clearCells() { if (cellLayer) { cellLayer.remove(); cellLayer = null; } map.closePopup(); }

/** cells: array from API. Returns {drawn, capped}. */
export function showCells(cells, cellSizeKm, { fit }) {
  clearCells();
  let list = cells, capped = false;
  if (cells.length > CELL_CAP) { list = [...cells].sort((a, b) => b.frp - a.frp).slice(0, CELL_CAP); capped = true; }
  const colors = { both: css('--sens-both'), modis: css('--sens-modis'), viirs: css('--sens-viirs') };
  const dLat = cellSizeKm / 111.32 / 2;
  const group = L.featureGroup();
  for (const c of list) {
    const dLon = dLat / Math.max(0.05, Math.cos((c.lat * Math.PI) / 180));
    const r = L.rectangle([[c.lat - dLat, c.lon - dLon], [c.lat + dLat, c.lon + dLon]], {
      renderer: canvas, stroke: false, fillColor: colors[c.sensors] || colors.viirs, fillOpacity: 0.85,
    });
    r.on('click', (e) => { L.DomEvent.stopPropagation(e); L.popup({ closeButton: true }).setLatLng([c.lat, c.lon]).setContent(popupNode(c)).openOn(map); });
    group.addLayer(r);
  }
  cellLayer = group.addTo(map);
  if (fit && list.length) fitBounds(group.getBounds(), 12);
  return { drawn: list.length, capped };
}

const SENSOR_NAME = { both: 'Both MODIS and VIIRS', modis: 'MODIS only', viirs: 'VIIRS only' };
function popupNode(c) {
  const rows = [['Date', fmtLong(c.date)], ['Seen by', SENSOR_NAME[c.sensors] || c.sensors], ['Confidence', c.conf], ['FRP', `${fmtNum(c.frp)} MW`],
    ['MODIS detections', fmtInt(c.modisN)], ['VIIRS detections', fmtInt(c.viirsN)], ['Location', `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`]];
  const dl = el('dl', { class: 'popup-dl' });
  for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', { text: v }));
  return dl;
}

// ---- box drawing --------------------------------------------------------------------------------
function clampLL(ll) { return L.latLng(Math.max(-90, Math.min(90, ll.lat)), Math.max(-180, Math.min(180, ll.lng))); }

function onDown(e) {
  if (!drawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.target.closest('.leaflet-control')) return;
  e.preventDefault();
  drawing.start = clampLL(map.mouseEventToLatLng(e));
  drawing.active = true;
  drawing.pointerId = e.pointerId;
  drawing.startPx = [e.clientX, e.clientY];
  try { map.getContainer().setPointerCapture(e.pointerId); } catch { /* ignore */ }
  if (drawRect) drawRect.remove();
  drawRect = L.rectangle(L.latLngBounds(drawing.start, drawing.start), { color: css('--outline'), weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(map);
}
function onMove(e) {
  if (!drawing || !drawing.active || e.pointerId !== drawing.pointerId) return;
  drawRect.setBounds(L.latLngBounds(drawing.start, clampLL(map.mouseEventToLatLng(e))));
}
function onUp(e) {
  if (!drawing || !drawing.active || e.pointerId !== drawing.pointerId) return;
  const d = drawing;
  d.active = false;
  const moved = Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]);
  const b = drawRect ? drawRect.getBounds() : null;
  if (drawRect) { drawRect.remove(); drawRect = null; }
  if (moved < 6 || !b) return; // a tap: keep drawing mode on
  stopDraw();
  d.onDone([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
}

export function startDraw(onDone, onCancel) {
  stopDraw();
  drawing = { onDone, onCancel, active: false };
  const c = map.getContainer();
  map.dragging.disable();
  map.doubleClickZoom.disable();
  c.classList.add('is-drawing');
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', cancelDraw);
  document.addEventListener('keydown', onKey);
}
export function isDrawing() { return !!drawing; }
function onKey(e) { if (e.key === 'Escape') cancelDraw(); }

function cancelDraw() {
  if (!drawing) return;
  const cb = drawing.onCancel;
  stopDraw();
  cb && cb();
}
export function stopDraw() {
  if (drawRect) { drawRect.remove(); drawRect = null; }
  if (!drawing) return;
  drawing = null;
  const c = map.getContainer();
  c.classList.remove('is-drawing');
  c.removeEventListener('pointerdown', onDown);
  c.removeEventListener('pointermove', onMove);
  c.removeEventListener('pointerup', onUp);
  c.removeEventListener('pointercancel', cancelDraw);
  document.removeEventListener('keydown', onKey);
  map.dragging.enable();
  map.doubleClickZoom.enable();
}
