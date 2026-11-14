// Ember Almanac front end: wiring, state, rendering.
import { MOCK, getStatus, buildCalendar, ApiError } from './api.js';
import { loadCounties, getCounty, searchCounties, countyAt, approxAreaKm2, bboxAreaKm2 } from './counties.js';
import { buildSeries, summarize } from './analysis.js';
import { renderCalendar, renderLegend } from './calendar.js';
import { renderAgreement } from './charts.js';
import * as mapx from './map.js';
import { addDays, parseDate, diffDays, todayLocal, fmtMed, fmtShort, fmtInt, fmtNum, fmtCompact, fmtLong, el, safeStorage } from './util.js';

const $ = (id) => document.getElementById(id);
const store = safeStorage();
const MAX_SPAN_DAYS = 366;
const MAX_BOX_DEG = 20;
const PRESETS = ['30d', '90d', '12m', 'ytd', 'custom'];

const state = {
  mode: 'county', area: null, range: { preset: '12m', start: '', end: '' },
  metric: 'cells', series: null, result: null, cellsByDate: null, selected: null, cal: null,
  hasKey: null, controller: null, building: false, mapReady: false,
};

// ---------------------------------------------------------------- theme
const mq = matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() { return document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light'); }
function syncThemeButton() {
  const t = effectiveTheme();
  $('theme-btn').setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} theme`);
  $('theme-label').textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
}
function themeChanged() { syncThemeButton(); if (state.mapReady) redrawMap(false); }
function initTheme() {
  const saved = store.get('ember.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  syncThemeButton();
  $('theme-btn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('ember.theme', next);
    themeChanged();
  });
  mq.addEventListener('change', () => { if (!document.documentElement.dataset.theme) themeChanged(); });
}

// ---------------------------------------------------------------- range
function presetRange(p) {
  const today = todayLocal();
  if (p === '30d') return { start: addDays(today, -29), end: today };
  if (p === '90d') return { start: addDays(today, -89), end: today };
  if (p === '12m') return { start: addDays(today, -364), end: today };
  if (p === 'ytd') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  return null;
}
function validateRange(start, end) {
  if (!start || !end || parseDate(start) == null || parseDate(end) == null) return 'Choose both a start and an end date.';
  if (start > end) return 'The start date must be on or before the end date.';
  if (end > todayLocal()) return 'The end date cannot be in the future.';
  if (diffDays(start, end) + 1 > MAX_SPAN_DAYS) return `The range can be at most ${MAX_SPAN_DAYS} days (about 12 months).`;
  return null;
}
function setPreset(p, dates) {
  state.range.preset = p;
  const r = p === 'custom' ? (dates || { start: $('date-start').value, end: $('date-end').value }) : presetRange(p);
  state.range.start = r.start; state.range.end = r.end;
  document.querySelector(`input[name=range][value="${p}"]`).checked = true;
  $('custom-dates').hidden = p !== 'custom';
  $('date-start').value = r.start || ''; $('date-end').value = r.end || '';
  updateRangeSummary();
}
function updateRangeSummary() {
  const { start, end, preset } = state.range;
  const err = preset === 'custom' ? validateRange(start, end) : null;
  $('date-msg').textContent = start && end && preset === 'custom' ? err || '' : '';
  $('range-summary').textContent = start && end && parseDate(start) != null && parseDate(end) != null && start <= end
    ? `${fmtMed(start)} to ${fmtMed(end)} (${diffDays(start, end) + 1} days)` : '';
}

// ---------------------------------------------------------------- area
function boxName(b) {
  const f = (x, p, n) => `${Math.abs(x).toFixed(2)}°${x < 0 ? n : p}`;
  return `Box ${f(b[1], 'N', 'S')} ${f(b[0], 'E', 'W')} to ${f(b[3], 'N', 'S')} ${f(b[2], 'E', 'W')}`;
}
function setArea(area, { fit = true, quiet = false } = {}) {
  state.area = area;
  $('area-msg').textContent = '';
  if (area) {
    $('area-name').textContent = area.name || boxName(area.bbox);
    const km2 = area.type === 'bbox' ? bboxAreaKm2(area.bbox) : approxAreaKm2(area.geometry);
    $('area-size').textContent = `About ${fmtInt(km2)} km²`;
  } else {
    $('area-name').textContent = 'Nothing selected yet';
    $('area-size').textContent = '';
  }
  if (state.mapReady) {
    const b = mapx.setArea(area);
    if (fit && b) mapx.fitBounds(b);
    if (!quiet) { mapx.clearCells(); }
  }
  if (!quiet) markStale();
  persist();
}
function markStale() {
  if (!$('results-body').hidden && !state.building) {
    $('results-body').classList.add('is-stale');
    $('map-note').textContent = 'Area or dates changed. Press Build calendar to update the results.';
  }
}
function countyArea(it) { return { type: 'polygon', geometry: it.feature.geometry, name: it.label, fips: it.fips }; }

function setMode(mode) {
  state.mode = mode;
  document.querySelector(`input[name=areamode][value="${mode}"]`).checked = true;
  $('county-mode').hidden = mode !== 'county';
  $('box-mode').hidden = mode !== 'box';
  if (!state.mapReady) return;
  if (mode === 'box') armDraw(); else { mapx.stopDraw(); syncDrawBtn(); }
}
function syncDrawBtn() {
  const on = mapx.isDrawing();
  const b = $('draw-btn');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Drawing… (Esc to cancel)' : state.area && state.area.type === 'bbox' ? 'Redraw box' : 'Draw box';
}
function armDraw() {
  mapx.startDraw((bbox) => {
    const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
    if (w > MAX_BOX_DEG || h > MAX_BOX_DEG) {
      $('area-msg').textContent = `That box is ${w.toFixed(1)}° wide and ${h.toFixed(1)}° tall. Boxes can be at most ${MAX_BOX_DEG}° on a side; draw a smaller one.`;
      armDraw();
      return;
    }
    setArea({ type: 'bbox', bbox: bbox.map((x) => +x.toFixed(4)) }, { fit: false });
    syncDrawBtn();
  }, syncDrawBtn);
  syncDrawBtn();
}

// ---------------------------------------------------------------- county combobox
const combo = { items: [], active: -1 };
function openList(open) {
  const list = $('county-list'), input = $('county-input');
  list.hidden = !open; input.setAttribute('aria-expanded', String(open));
  if (!open) input.removeAttribute('aria-activedescendant');
}
function renderList() {
  const list = $('county-list');
  list.replaceChildren(...combo.items.map((it, i) => el('li', { id: `opt-${i}`, role: 'option', 'aria-selected': String(i === combo.active), text: it.label })));
  openList(combo.items.length > 0);
  if (combo.active >= 0) $('county-input').setAttribute('aria-activedescendant', `opt-${combo.active}`);
}
function chooseCounty(it) {
  $('county-input').value = it.label;
  openList(false);
  $('county-msg').textContent = '';
  setArea(countyArea(it));
}
function initCombo() {
  const input = $('county-input');
  input.addEventListener('input', () => {
    if (!countiesReady) { $('county-msg').textContent = countiesError || 'Counties are still loading…'; return; }
    combo.items = searchCounties(input.value); combo.active = combo.items.length ? 0 : -1;
    $('county-msg').textContent = input.value.trim() && !combo.items.length ? 'No county matches that name.' : '';
    renderList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!combo.items.length) return;
      e.preventDefault();
      combo.active = (combo.active + (e.key === 'ArrowDown' ? 1 : -1) + combo.items.length) % combo.items.length;
      renderList();
      $(`opt-${combo.active}`).scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!$('county-list').hidden && combo.active >= 0) { e.preventDefault(); chooseCounty(combo.items[combo.active]); }
    } else if (e.key === 'Escape') {
      if (!$('county-list').hidden) { e.preventDefault(); e.stopPropagation(); openList(false); }
    }
  });
  input.addEventListener('blur', () => openList(false));
  $('county-list').addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep focus in the input
    const li = e.target.closest('[role=option]');
    if (li) chooseCounty(combo.items[+li.id.slice(4)]);
  });
}

let countiesReady = false, countiesError = '';
async function startCounties() {
  try {
    await loadCounties();
    countiesReady = true;
    $('county-input').placeholder = 'e.g. Larimer, Maui, Cook…';
  } catch (err) {
    countiesError = `County search is unavailable (${err.message}). You can still draw a box.`;
    $('county-input').placeholder = 'County search unavailable';
    $('county-input').disabled = true;
    $('county-msg').textContent = countiesError;
  }
}

// ---------------------------------------------------------------- persistence (localStorage + URL hash)
function persist() {
  const a = state.area;
  const doc = {
    mode: state.mode,
    area: !a ? null : a.type === 'bbox' ? { t: 'b', bbox: a.bbox } : { t: 'c', fips: a.fips },
    range: state.range,
  };
  store.set('ember.last', JSON.stringify(doc));
  const p = new URLSearchParams();
  if (doc.area) { if (doc.area.t === 'c') p.set('c', doc.area.fips); else p.set('b', doc.area.bbox.join(',')); }
  p.set('r', state.range.preset);
  if (state.range.start) { p.set('from', state.range.start); p.set('to', state.range.end); }
  try { history.replaceState(null, '', `${location.pathname}${location.search}#${p.toString()}`); } catch { /* ignore */ }
}
function validBbox(b) {
  return Array.isArray(b) && b.length === 4 && b.every((x) => Number.isFinite(x)) && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90
    && b[0] < b[2] && b[1] < b[3] && b[2] - b[0] <= MAX_BOX_DEG && b[3] - b[1] <= MAX_BOX_DEG;
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (![...p.keys()].length) return null;
  let area = null;
  if (/^\d{5}$/.test(p.get('c') || '')) area = { t: 'c', fips: p.get('c') };
  else if (p.get('b')) { const b = p.get('b').split(',').map(Number); if (validBbox(b)) area = { t: 'b', bbox: b }; }
  const preset = PRESETS.includes(p.get('r')) ? p.get('r') : null;
  const from = p.get('from'), to = p.get('to');
  const range = preset && from && to && !validateRange(from, to) ? { preset, start: from, end: to } : null;
  return area && range ? { area, range, auto: true } : area || range ? { area, range, auto: false } : null;
}
function readStored() {
  try {
    const d = JSON.parse(store.get('ember.last') || 'null');
    if (!d) return null;
    const area = d.area && d.area.t === 'c' && /^\d{5}$/.test(d.area.fips) ? d.area : d.area && d.area.t === 'b' && validBbox(d.area.bbox) ? d.area : null;
    const preset = d.range && PRESETS.includes(d.range.preset) ? d.range.preset : null;
    let range = null;
    if (preset && preset !== 'custom') range = { preset };
    else if (preset === 'custom' && !validateRange(d.range.start, d.range.end)) range = d.range;
    return { area, range, mode: d.mode, auto: false };
  } catch { return null; }
}

// ---------------------------------------------------------------- build
function setProgress(done, total) {
  $('progress-text').textContent = `${done} of ${total} month${total === 1 ? '' : 's'}`;
  $('progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
  const bar = document.querySelector('#progress .bar');
  bar.setAttribute('aria-valuemax', String(total)); bar.setAttribute('aria-valuenow', String(done));
}
function showAlert(msg) { $('alert').textContent = msg || ''; $('alert').classList.toggle('on', !!msg); }

async function onSubmit(e) {
  e.preventDefault();
  if (state.building || state.hasKey === false) return;
  showAlert('');
  if (!state.area) { $('area-msg').textContent = 'Choose a county or draw a box first.'; return; }
  const dErr = validateRange(state.range.start, state.range.end);
  if (dErr) { $('date-msg').textContent = dErr; return; }
  const apiArea = state.area.type === 'bbox'
    ? { type: 'bbox', bbox: state.area.bbox }
    : { type: 'polygon', geometry: state.area.geometry, name: state.area.name };
  const snap = { areaName: state.area.name || boxName(state.area.bbox), start: state.range.start, end: state.range.end };

  state.building = true;
  state.controller = new AbortController();
  $('build-btn').disabled = true;
  $('progress').hidden = false;
  setProgress(0, 1);
  $('map-note').textContent = '';
  const hadResults = !$('results-body').hidden;
  if (hadResults) $('results-body').classList.add('is-stale');
  let first = true;
  try {
    const out = await buildCalendar({
      area: apiArea, start: snap.start, end: snap.end, signal: state.controller.signal,
      onProgress: (done, total, partial) => {
        setProgress(done, total);
        if (first) { first = false; state.selected = null; }
        renderResults(partial, snap, { loading: true });
      },
    });
    if (first && !out.cancelled) { state.selected = null; renderResults(out.merged, snap, {}); first = false; }
    if (!first) renderResults(out.merged, snap, { failed: out.failed, cancelled: out.cancelled, total: out.total });
    if (out.failed.length) {
      const okCount = out.total - out.failed.length;
      showAlert(`${out.failed.length} of ${out.total} months could not be loaded (${out.failed.map((f) => f.key).join(', ')}): ${out.failed[0].message}${okCount ? ' The months that loaded are shown.' : ''}`);
    }
    if (first && out.cancelled) $('results-body').classList.remove('is-stale');
  } catch (err) {
    $('results-body').classList.toggle('is-stale', false);
    const msg = err instanceof ApiError ? err.message : `Something went wrong: ${err.message}`;
    showAlert(msg);
    if (err instanceof ApiError && err.code === 'NO_KEY') { state.hasKey = false; applyKeyState(); }
  } finally {
    state.building = false; state.controller = null;
    $('progress').hidden = true;
    $('build-btn').disabled = state.hasKey === false;
  }
}

// ---------------------------------------------------------------- results
function renderResults(result, snap, { loading = false, failed = [], cancelled = false, total = 0 } = {}) {
  state.result = result;
  const series = buildSeries(result, snap.start, snap.end);
  state.series = series;
  state.cellsByDate = new Map();
  for (const c of result.cells) { const a = state.cellsByDate.get(c.date); if (a) a.push(c); else state.cellsByDate.set(c.date, [c]); }
  if (state.selected && !series.some((d) => d.date === state.selected)) state.selected = null;

  $('empty-state').hidden = true;
  const body = $('results-body');
  body.hidden = false; body.classList.remove('is-stale');
  $('results-title').textContent = snap.areaName;
  const tz = result.tzOffsetHours;
  $('results-sub').textContent = `${fmtMed(snap.start)} to ${fmtMed(snap.end)} · ${series.length} days${tz != null ? ` · local solar days (UTC${tz >= 0 ? '+' : '−'}${Math.abs(tz)})` : ''}`;
  $('tz-note').textContent = tz != null ? ` (this area: UTC${tz >= 0 ? '+' : '−'}${Math.abs(tz)})` : '';
  const notes = [];
  if (loading) notes.push('Still loading: results so far are shown.');
  if (cancelled) notes.push(`Cancelled. Showing the months that finished${total ? ` (${total - failed.length} of ${total} requested)` : ''}.`);
  if (failed.length) notes.push(`Missing months: ${failed.map((f) => f.key).join(', ')}. Those days show as empty, not as zero fire.`);
  $('partial-note').textContent = notes.join(' ');

  const sum = summarize(series);
  renderTiles(sum);
  let zero = $('zero-note');
  if (!zero) { zero = el('p', { id: 'zero-note', class: 'zero' }); $('tiles').after(zero); }
  zero.textContent = sum.cellDays === 0 && !loading
    ? 'No fire detections were reported for this area in this period. The calendar below is all neutral.' : '';
  zero.hidden = !zero.textContent;

  drawCalendar();
  renderAgreement($('agr-chart'), series);
  renderTable(series);
  renderSources(result.sources || []);
  renderDetail();
  $('map-legend').hidden = false;
  if (state.mapReady) redrawMap(!loading || state.selected != null);
}

function tile(label, value, sub) {
  return el('div', { class: 'tile' }, el('div', { class: 'tile-label', text: label }), el('div', { class: 'tile-value', text: value }), el('div', { class: 'tile-sub', text: sub }));
}
function renderTiles(s) {
  $('tiles').replaceChildren(
    tile('Active fire days', fmtInt(s.active), `of ${fmtInt(s.days)} days`),
    tile('Peak day', s.peak ? fmtShort(s.peak.date) : '—', s.peak ? `${fmtInt(s.peak.cells)} cells` : 'no detections'),
    tile('Fire cell-days', fmtInt(s.cellDays), 'each ~1 km cell counted once per day'),
    tile('Total FRP', s.cellDays ? `${fmtCompact(s.frp)} MW` : '—', 'summed daily, de-duplicated'),
    tile('Sensor agreement', s.agreement == null ? '—' : `${Math.round(s.agreement * 100)}%`, 'of cell-days seen by both'),
  );
}

function drawCalendar() {
  const tzOffsetHours = state.result.tzOffsetHours;
  state.cal = renderCalendar($('calendar'), {
    series: state.series, metric: state.metric, selected: state.selected, tzOffsetHours,
    onSelect: (date) => selectDay(date),
  });
  renderLegend($('cal-legend'), state.series, state.metric);
}

function selectDay(date) {
  state.selected = date;
  state.cal && state.cal.setSelected(date);
  renderDetail();
  redrawMap(true);
}

function renderDetail() {
  const box = $('detail');
  const d = state.selected && state.series.find((x) => x.date === state.selected);
  $('whole-btn').disabled = !d;
  if (!d) {
    box.replaceChildren(el('p', { class: 'hint', text: 'Whole period shown on the map. Select a day in the calendar to see that day’s cells and numbers.' }));
    return;
  }
  const rows = d.cells === 0
    ? [['Date', fmtLong(d.date)], ['Fire cells', 'none detected']]
    : [['Date', fmtLong(d.date)], ['Fire cells', fmtInt(d.cells)], ['Both sensors', fmtInt(d.both), 'both'], ['MODIS only', fmtInt(d.modisOnly), 'modis'],
      ['VIIRS only', fmtInt(d.viirsOnly), 'viirs'], ['FRP', `${fmtNum(d.frp || 0)} MW`], ['High-confidence cells', fmtInt(d.highConfCells)],
      ['Night-time cells', fmtInt(d.nightCells)], ['MODIS detections', fmtInt(d.modisDetections)], ['VIIRS detections', fmtInt(d.viirsDetections)]];
  const dl = el('dl', { class: 'detail-dl' });
  for (const [k, v, sw] of rows) dl.append(el('dt', {}, sw ? el('i', { class: `sw ${sw}`, 'aria-hidden': 'true' }) : null, k), el('dd', { text: v }));
  box.replaceChildren(dl);
}

function redrawMap(fitCells) {
  if (!state.mapReady) return;
  mapx.setArea(state.area);
  if (!state.result) return;
  const sel = state.selected;
  const cells = sel ? state.cellsByDate.get(sel) || [] : state.result.cells;
  const { drawn, capped } = mapx.showCells(cells, state.result.cellSizeKm || 1, { fit: !!sel && fitCells });
  const parts = [];
  if (sel) parts.push(cells.length ? `${fmtInt(cells.length)} fire cells on ${fmtLong(sel)}.` : `No detections on ${fmtLong(sel)}.`);
  else parts.push(`Whole period: ${fmtInt(state.result.cells.length)} cell-days${state.result.cells.length ? ' (overlapping days are drawn on top of each other)' : ''}.`);
  if (capped) parts.push(`Showing the ${fmtInt(drawn)} highest-FRP cells only, to keep the map responsive.`);
  if (state.result.cellsTruncated) parts.push('The server trimmed the cell list for this area, so the map is incomplete; calendar totals are not affected.');
  $('map-note').textContent = parts.join(' ');
}

function renderTable(series) {
  const t = $('day-table');
  const head = ['Date', 'Cells', 'Both', 'MODIS only', 'VIIRS only', 'FRP (MW)', 'MODIS det.', 'VIIRS det.', 'High-conf. cells', 'Night cells'];
  const thead = el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { scope: 'col', text: h }))));
  const tbody = el('tbody');
  const days = series.filter((d) => d.cells > 0);
  if (!days.length) tbody.append(el('tr', {}, el('td', { colspan: String(head.length), text: 'No detections in this period.' })));
  for (const d of days) {
    tbody.append(el('tr', {}, el('th', { scope: 'row', text: d.date }), ...[d.cells, d.both, d.modisOnly, d.viirsOnly].map((v) => el('td', { text: fmtInt(v) })),
      el('td', { text: fmtNum(d.frp || 0) }), ...[d.modisDetections, d.viirsDetections, d.highConfCells, d.nightCells].map((v) => el('td', { text: fmtInt(v) }))));
  }
  t.replaceChildren(el('caption', { class: 'sr-only', text: 'Days with fire detections' }), thead, tbody);
}

const STATUS_LABEL = { ok: 'OK', empty: 'No records', error: 'Error' };
const SOURCE_NAME = {
  MODIS: 'MODIS (Terra + Aqua)', VIIRS_SNPP: 'VIIRS Suomi NPP', VIIRS_NOAA20: 'VIIRS NOAA-20', VIIRS_NOAA21: 'VIIRS NOAA-21',
};
function renderSources(sources) {
  const t = $('sources-table');
  const thead = el('thead', {}, el('tr', {}, ...['Source', 'Records', 'Status'].map((h) => el('th', { scope: 'col', text: h }))));
  const tbody = el('tbody');
  for (const s of sources) {
    const st = el('td', {}, el('span', { text: STATUS_LABEL[s.status] || String(s.status) }));
    if (s.message && s.status !== 'ok') st.append(el('div', { class: 'hint', text: s.message }));
    tbody.append(el('tr', {}, el('th', { scope: 'row', text: SOURCE_NAME[s.id] || s.id }), el('td', { text: fmtInt(s.records || 0) }), st));
  }
  t.replaceChildren(thead, tbody);
}

function downloadCsv() {
  if (!state.series) return;
  const cols = ['date', 'cells', 'both', 'modis_only', 'viirs_only', 'frp_mw', 'modis_detections', 'viirs_detections', 'high_conf_cells', 'night_cells'];
  const rows = state.series.map((d) => [d.date, d.cells, d.both, d.modisOnly, d.viirsOnly, d.frp || 0, d.modisDetections, d.viirsDetections, d.highConfCells, d.nightCells].join(','));
  const blob = new Blob([[cols.join(','), ...rows].join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `ember-almanac_${state.series[0].date}_${state.series[state.series.length - 1].date}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- init
function applyKeyState() {
  $('setup-notice').hidden = state.hasKey !== false;
  $('build-btn').disabled = state.hasKey === false || state.building;
  $('build-btn').title = state.hasKey === false ? 'Add FIRMS_MAP_KEY to .env first' : '';
}

async function init() {
  initTheme();
  if (MOCK) $('mock-badge').hidden = false;
  initCombo();

  state.mapReady = !!window.L;
  if (state.mapReady) {
    mapx.initMap($('map'), (ll) => {
      if (state.mode !== 'county') return;
      if (!countiesReady) { $('county-msg').textContent = countiesError || 'Counties are still loading…'; return; }
      const it = countyAt(ll.lat, ll.lng);
      if (!it) { $('county-msg').textContent = 'No US county at that spot.'; return; }
      $('county-input').value = it.label; $('county-msg').textContent = '';
      setArea(countyArea(it), { fit: false });
    });
  } else {
    $('map-fallback').hidden = false; $('map').hidden = true;
    $('draw-btn').disabled = true;
  }

  document.querySelectorAll('input[name=areamode]').forEach((r) => r.addEventListener('change', () => { setMode(r.value); persist(); }));
  $('draw-btn').addEventListener('click', () => { if (mapx.isDrawing()) { mapx.stopDraw(); syncDrawBtn(); } else armDraw(); });
  document.querySelectorAll('input[name=range]').forEach((r) => r.addEventListener('change', () => {
    setPreset(r.value, r.value === 'custom' ? { start: state.range.start, end: state.range.end } : null);
    markStale(); persist();
  }));
  for (const id of ['date-start', 'date-end']) $(id).addEventListener('change', () => {
    state.range.start = $('date-start').value; state.range.end = $('date-end').value;
    updateRangeSummary(); markStale(); persist();
  });
  $('date-start').max = $('date-end').max = todayLocal();
  document.querySelectorAll('input[name=metric]').forEach((r) => r.addEventListener('change', () => {
    state.metric = r.value; if (state.series) drawCalendar();
  }));
  $('controls').addEventListener('submit', onSubmit);
  $('cancel-btn').addEventListener('click', () => state.controller && state.controller.abort());
  $('whole-btn').addEventListener('click', () => { state.selected = null; state.cal && state.cal.setSelected(null); renderDetail(); redrawMap(false); mapx.fitArea(); });
  $('csv-btn').addEventListener('click', downloadCsv);
  window.addEventListener('resize', () => state.mapReady && mapx.invalidate());

  // Initial control state (hash wins over localStorage)
  const fromHash = readHash();
  const saved = fromHash || readStored();
  if (saved && saved.range) {
    const r = saved.range;
    if (r.preset === 'custom') setPreset('custom', r);
    else {
      setPreset(r.preset); // stored view: recompute relative to today
      if (fromHash && r.start) { // shared link: reproduce the exact dates
        state.range.start = r.start; state.range.end = r.end;
        $('date-start').value = r.start; $('date-end').value = r.end;
        updateRangeSummary();
      }
    }
  } else setPreset('12m');
  let pendingCounty = null;
  if (saved && saved.area) {
    if (saved.area.t === 'b') { setMode('box'); setArea({ type: 'bbox', bbox: saved.area.bbox }, { quiet: true }); if (state.mapReady) { mapx.stopDraw(); syncDrawBtn(); mapx.fitArea(); } }
    else pendingCounty = saved.area.fips;
  }
  const statusP = getStatus().then((s) => { state.hasKey = !!s.hasKey; }, (err) => { showAlert(`Cannot reach the server (${err.message}).`); });

  // lazy: after first paint
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  await startCounties();
  if (pendingCounty && countiesReady) {
    const it = getCounty(pendingCounty);
    if (it) { $('county-input').value = it.label; setArea(countyArea(it), { quiet: true }); }
  }
  await statusP;
  applyKeyState();
  if (fromHash && fromHash.auto && state.area && state.hasKey !== false) $('controls').requestSubmit();
}

init();
