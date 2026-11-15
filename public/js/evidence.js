// Evidence panel: loads a precomputed multi-year example (static JSON) and renders it above the live results.
import { el, fmtInt, fmtMed, parseDate } from './util.js';
import { computeEvidence, describe, EN } from './evidence-stats.js';
import { drawBars, drawIndex, drawHeatmap } from './evidence-charts.js';

const $ = (id) => document.getElementById(id);
const FALLBACK = [{ id: '08077', file: 'data/example-08077.json', label: 'Mesa County, Colorado', note: '' }];
const FLEET_CAVEAT = 'All sensors combines MODIS with every VIIRS satellite flying at the time (one until 2018, two from NOAA-20’s start in 2018, three from NOAA-21’s start in 2023). More satellites mean more overpasses, so rises over the years can reflect how fire was observed, not only fire. To compare years, use MODIS or VIIRS Suomi NPP.';
const GRID_CAVEAT = 'Putting both sensors on a 1 km grid removes repeat counting within a cell and day, but they still differ in sensitivity (VIIRS detects smaller and cooler fires), overpass time, and cloud cover at overpass. A detection is not burned area: it means a sensor saw heat consistent with fire, not that the whole cell burned.';

const state = { manifest: [], current: null, cache: new Map(), failed: new Map(), sensor: 'modis' };
let manifestP = null;

export const getExampleId = () => state.current;

function validEntry(e) {
  return e && typeof e.id === 'string' && /^[\w-]+$/.test(e.id) && typeof e.file === 'string' && /^data\/[\w.-]+\.json$/.test(e.file) && typeof e.label === 'string';
}
export function loadManifest() {
  if (!manifestP) {
    manifestP = fetch('data/examples.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { const list = Array.isArray(j) ? j.filter(validEntry) : []; if (!list.length) throw new Error('empty manifest'); return list; })
      .catch(() => FALLBACK)
      .then((list) => { state.manifest = list; return list; });
  }
  return manifestP;
}

function setHash(id) {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('example', id);
  try { history.replaceState(null, '', `${location.pathname}${location.search}#${p.toString()}`); } catch { /* ignore */ }
}

const errText = (e) => (typeof e === 'string' ? e : e && (e.message || e.error || e.key) ? String(e.message || e.error || e.key) : JSON.stringify(e));

// ------------------------------------------------------------------ entry points (empty-state buttons, header link)
function entryLabel(entry) {
  const hit = state.cache.get(entry.id);
  return hit ? `See the ${hit.ev.insufficient ? '' : `${hit.ev.completeYears.length}-year `}example: ${hit.ex.area && hit.ex.area.name ? hit.ex.area.name : entry.label}` : `See the example: ${entry.label}`;
}
function renderEntries() {
  const box = $('example-buttons');
  box.replaceChildren(...state.manifest.map((e, i) => {
    const b = el('button', { type: 'button', class: i === 0 ? 'btn btn-primary btn-cta' : 'btn btn-cta', 'data-example': e.id, text: entryLabel(e) });
    b.addEventListener('click', () => selectExample(e.id, true));
    return el('div', { class: 'example-entry' }, b,
      e.note ? el('p', { class: 'hint', text: e.note }) : null,
      el('p', { class: 'msg msg-warn', role: 'status', 'data-msg': e.id, text: state.failed.get(e.id) || '' }));
  }));
  const link = $('example-link');
  if (state.manifest.length) link.href = `#example=${state.manifest[0].id}`;
}
function setBusy(id, busy) {
  document.querySelectorAll('[data-example]').forEach((b) => { if (b.dataset.example === id) { b.disabled = busy; if (busy) b.textContent = 'Loading example…'; } });
}
function refreshMessages() {
  document.querySelectorAll('[data-msg]').forEach((m) => { m.textContent = state.failed.get(m.dataset.msg) || ''; });
}

export async function initEvidence() {
  const want = new URLSearchParams(location.hash.slice(1)).get('example'); // read before main.js rewrites the hash
  $('example-link').addEventListener('click', async (e) => { e.preventDefault(); const l = await loadManifest(); selectExample(l[0].id, true); });
  const list = await loadManifest();
  renderEntries();
  if (want) {
    const hit = list.find((e) => e.id === want);
    if (hit) selectExample(hit.id, false);
    else { state.failed.set(list[0].id, `No example with id ${want}.`); refreshMessages(); }
  }
}

export async function selectExample(id, scroll) {
  const entry = state.manifest.find((e) => e.id === id);
  if (!entry) return;
  setBusy(id, true);
  try {
    if (!state.cache.has(id)) {
      const res = await fetch(entry.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ex = await res.json();
      if (!ex || typeof ex.daily !== 'object' || !ex.start || !ex.end) throw new Error('the file is not a valid example');
      state.cache.set(id, { ex, ev: computeEvidence(ex) });
    }
    state.failed.delete(id);
    state.current = id;
    setHash(id);
    renderEntries();
    render(scroll);
  } catch (err) {
    state.failed.set(id, `Could not load the example “${entry.label}” (${err.message}). The other examples and the live explorer are unaffected.`);
    renderEntries();
    if (!state.current) { showOnlyError(id); }
    else render(false);
  }
}

function showOnlyError(id) {
  const box = $('evidence');
  box.hidden = false;
  box.replaceChildren(el('p', { class: 'msg msg-warn', role: 'alert', text: state.failed.get(id) }));
}

// ------------------------------------------------------------------ rendering
const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const num = (x, d) => (x == null ? 'n/a' : x.toFixed(d));

function provenance(ex, ev) {
  const gen = ex.generated && parseDate(String(ex.generated).slice(0, 10)) != null ? fmtMed(String(ex.generated).slice(0, 10)) : null;
  const tz = ex.tzOffsetHours;
  const bits = [
    `Precomputed from NASA FIRMS${gen ? ` on ${gen}` : ''}`,
    `${fmtMed(ex.start)} to ${fmtMed(ex.end)}`,
    tz != null ? `local solar days (UTC${tz >= 0 ? '+' : '−'}${Math.abs(tz)})` : 'local solar days',
    'standard-quality archive through mid-2026, near-real-time after',
  ];
  if (ex.snppEnd) bits.push(`VIIRS Suomi NPP data end ${fmtMed(ex.snppEnd)}`);
  return bits.join(' · ');
}

function coverageWarning(ex) {
  const items = [];
  for (const [name, c] of Object.entries(ex.coverage || {})) {
    const errs = c && Array.isArray(c.errors) ? c.errors : [];
    if (errs.length) items.push(`${name}: ${errs.map(errText).join('; ')}`);
  }
  if (!items.length) return null;
  const ul = el('ul', { class: 'ev-warn-list' }, ...items.map((t) => el('li', { text: t })));
  return el('div', { class: 'ev-warn', role: 'status' },
    el('strong', { text: 'Some data could not be retrieved. ' }),
    el('span', { text: 'Missing data is missing, not zero; counts for the affected periods may be too low.' }), ul);
}

function legendFor(markers) { // markers: true for the line chart (circle / diamond), false for bars
  const items = [['modis', 'MODIS (Terra + Aqua)', 'dot'], ['viirs', 'VIIRS Suomi NPP', 'diamond']];
  return el('div', { class: 'legend', role: 'group', 'aria-label': 'Legend' }, ...items.map(([k, label, shape]) =>
    el('span', { class: 'legend-item' }, el('i', { class: `sw ${k}${markers ? ` ${shape}` : ''}`, 'aria-hidden': 'true' }), el('span', { text: label }))));
}

function gapTable(ev) {
  const g = ev.gap;
  const row = (label, a, b) => el('tr', {}, el('th', { scope: 'row', text: label }), el('td', { text: a }), el('td', { text: b }));
  const range = (r, d) => (r.min == null ? 'n/a' : `${r.min.toFixed(d)} ${EN} ${r.max.toFixed(d)}`);
  return el('div', { class: 'table-wrap ev-gap' }, el('table', {},
    el('caption', { class: 'sr-only', text: 'Raw detections compared with 1 km cell-days' }),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: 'Raw detections (pixels)' }), el('th', { scope: 'col', text: '1 km cell-days' }))),
    el('tbody', {},
      row('Median VIIRS ÷ MODIS ratio, per year', num(g.rawRatio.median, 1), num(g.cellRatio.median, 2)),
      row('Range of that ratio across years', range(g.rawRatio, 1), range(g.cellRatio, 2)),
      row('Held-out test: median error predicting each year’s VIIRS count from MODIS with one scale factor fitted on the other years', pct(g.heldOutRaw.median), pct(g.heldOutCells.median)))));
}

function annualTable(ev) {
  const head = ['Year', 'MODIS detections', 'VIIRS SNPP detections', 'MODIS cell-days', 'VIIRS SNPP cell-days', 'All-sensor cell-days*', 'MODIS index (% of avg)', 'VIIRS SNPP index (% of avg)'];
  const rows = ev.annual.map((a, i) => {
    const ix = ev.index[i];
    return [a.year, a.modisDet, a.snppDet, a.modisCells, a.snppCells, a.allCells, ix.modis == null ? '' : +ix.modis.toFixed(1), ix.snpp == null ? '' : +ix.snpp.toFixed(1)];
  });
  return { head, rows };
}
function downloadCsv(id, t) {
  const blob = new Blob([[t.head.join(','), ...t.rows.map((r) => r.join(','))].join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `ember-almanac_${id}_annual.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function card(title, ...kids) { return el('div', { class: 'card ev-card' }, el('div', { class: 'card-head' }, el('h3', { text: title })), ...kids); }

function render(scroll) {
  const { ex, ev } = state.cache.get(state.current);
  const box = $('evidence');
  box.hidden = false;
  const name = (ex.area && ex.area.name) || 'Example area';

  const picker = el('label', { class: 'ev-picker' }, el('span', { class: 'field-label', text: 'Example' }));
  const sel = el('select', { id: 'ev-picker', 'aria-label': 'Switch example' }, ...state.manifest.map((e) => el('option', { value: e.id, text: e.label, selected: e.id === state.current })));
  sel.addEventListener('change', () => selectExample(sel.value, false));
  picker.append(sel);
  const failedMsg = state.manifest.filter((e) => state.failed.has(e.id)).map((e) => el('p', { class: 'msg msg-warn', role: 'alert', text: state.failed.get(e.id) }));

  const head = el('div', { class: 'ev-head' },
    el('div', {}, el('h2', { id: 'ev-title', text: name }), el('p', { class: 'hint', text: provenance(ex, ev) })),
    state.manifest.length > 1 ? picker : null);
  const parts = [head, ...failedMsg, coverageWarning(ex)];

  if (ev.insufficient) {
    parts.push(el('p', { class: 'zero', text: describe(ev).insufficient }));
    box.replaceChildren(...parts.filter(Boolean));
    finish(box, scroll);
    return;
  }
  const t = describe(ev);
  parts.push(el('div', { class: 'ev-lede' }, el('p', { class: 'ev-headline', text: t.headline }), t.partial ? el('p', { class: 'ev-partial', text: t.partial }) : null));

  // Chart A
  const a = el('div', { class: 'ev-chart' });
  parts.push(card('Raw detections per year',
    el('p', { class: 'hint ev-ytitle', text: 'Detections (pixels) per year' }), legendFor(false), a,
    el('p', { class: 'ev-caption', text: t.rawCaption })));
  // Chart B
  const b = el('div', { class: 'ev-chart' });
  const base = `${ev.baselineYears[0]}${EN}${ev.baselineYears[ev.baselineYears.length - 1]}`;
  parts.push(card(`Same years, each sensor indexed to its own ${base} average`,
    el('p', { class: 'hint ev-ytitle', text: 'Cell-days with detected fire, percent of that sensor’s own average' }), legendFor(true), b,
    el('p', { class: 'ev-caption', text: t.indexCaption })));
  // Gap table
  parts.push(card('Does putting both on one grid help?', gapTable(ev),
    el('p', { class: 'hint', text: `Ratios compare VIIRS Suomi NPP with MODIS (Terra + Aqua), the same satellites in every year. Raw detections are pixel detections. A 1 km cell-day is one ~1 km cell with a detection on one day, summed over the year. Error = |predicted − actual| ÷ actual, median over ${ev.gap.heldOutCells.errors.length} held-out years.` }),
    el('p', { class: 'ev-caption', text: t.gapSentence }),
    el('p', { class: 'ev-caveat', text: GRID_CAVEAT })));
  // Heatmap
  const gridBox = el('div', { class: 'hm', tabindex: '-1' });
  const legBox = el('div', { class: 'legend' });
  const caveat = el('p', { class: 'ev-warn ev-fleet', role: 'status', text: FLEET_CAVEAT, hidden: state.sensor !== 'all' });
  const seg = el('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': 'Sensor for the historical calendar' },
    ...[['modis', 'MODIS'], ['snpp', 'VIIRS Suomi NPP'], ['all', 'All sensors']].map(([v, l]) =>
      el('label', {}, el('input', { type: 'radio', name: 'ev-sensor', value: v, checked: state.sensor === v }), el('span', { text: l }))));
  const draw = () => { drawHeatmap(gridBox, legBox, ev.weekly, state.sensor); caveat.hidden = state.sensor !== 'all'; };
  seg.addEventListener('change', (e) => { state.sensor = e.target.value; draw(); });
  parts.push(el('div', { class: 'card ev-card' }, el('div', { class: 'card-head' }, el('h3', { text: 'The historical calendar' }), seg), caveat, gridBox, legBox,
    el('p', { class: 'hint', text: `One square per 7-day block counted from January 1, so the last block of a year holds one or two days and the block containing the end of the data is partly observed. Quartile colour classes use all non-zero weeks shown. An outlined empty square means no data (the period is after the data end, or after Suomi NPP stopped), which is not the same as zero. ${ev.partial ? `${ev.partial.year} is an incomplete year. ` : ''}Arrow keys move between squares.` })));
  // Data table
  const at = annualTable(ev);
  const table = el('table', {}, el('caption', { class: 'sr-only', text: 'Annual counts by sensor' }),
    el('thead', {}, el('tr', {}, ...at.head.map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, ...at.rows.map((r) => el('tr', {}, el('th', { scope: 'row', text: String(r[0]) }), ...r.slice(1).map((v) => el('td', { text: v === '' ? 'n/a' : fmtInt(v) }))))));
  const csv = el('button', { type: 'button', class: 'btn', text: 'Download CSV' });
  csv.addEventListener('click', () => downloadCsv(state.current, at));
  parts.push(el('details', { class: 'card ev-card' }, el('summary', { text: 'Data table' }),
    el('div', { class: 'table-actions' }, csv, el('span', { class: 'hint', text: 'Complete calendar years only. Cell-days are distinct ~1 km cells with a detection, summed over days.' })),
    el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Annual data table' }, table),
    el('p', { class: 'hint', text: '* All-sensor counts are not comparable across years: the VIIRS fleet grew from one satellite to three. Index columns are percent of that sensor’s own average over the baseline years; they are rounded to the nearest percent in the table and to one decimal in the CSV.' })));

  box.replaceChildren(...parts.filter(Boolean));
  drawBars(a, ev.annual);
  drawIndex(b, ev.index, base);
  draw();
  finish(box, scroll);
}

function finish(box, scroll) {
  if (scroll) box.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
