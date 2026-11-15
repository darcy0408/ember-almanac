// GitHub-style calendar heatmap: weeks are columns, Sun-Sat are rows.
import { addDays, diffDays, weekday, fmtLong, fmtMonth, fmtInt, fmtNum, el } from './util.js';
import { classBreaks, classOf, rampSlot } from './analysis.js';
import { showTip, hideTip } from './tip.js';

const METRICS = {
  cells: { key: 'cells', label: 'Cells with detected fire', unit: 'cells with detected fire', integer: true, value: (d) => d.cells },
  frp: { key: 'frp', label: 'FRP (MW)', unit: 'MW', integer: false, value: (d) => d.frp || 0 },
};
export { METRICS };

export function legendItems(series, metricKey) {
  const m = METRICS[metricKey];
  const { breaks, n } = classBreaks(series.map(m.value), m.integer);
  const f = m.integer ? fmtInt : fmtNum;
  const items = [{ slot: 0, label: 'No detections' }];
  if (!n) return { items, breaks, n };
  let lo = null;
  for (let c = 1; c <= n; c++) {
    const hi = c <= breaks.length ? breaks[c - 1] : null;
    let label;
    if (hi == null) label = lo == null ? 'any' : `> ${f(lo)}`;
    else if (c === 1) label = m.integer ? (hi > 1 ? `1–${f(hi)}` : '1') : `up to ${f(hi)}`;
    else label = m.integer ? (hi - lo > 1 ? `${f(lo + 1)}–${f(hi)}` : `${f(hi)}`) : `${f(lo)}–${f(hi)}`;
    if (hi == null && m.integer && lo != null) label = `${f(lo + 1)}+`;
    items.push({ slot: rampSlot(c, n), label });
    lo = hi;
  }
  return { items, breaks, n };
}

export function renderLegend(container, series, metricKey) {
  const { items } = legendItems(series, metricKey);
  container.replaceChildren(
    el('span', { class: 'legend-title', text: METRICS[metricKey].label + ' per day:' }),
    ...items.map((it) => el('span', { class: 'legend-item' }, el('i', { class: `sw r${it.slot}`, 'aria-hidden': 'true' }), el('span', { text: it.label }))),
  );
}

/**
 * opts: { series, metric, selected, tzOffsetHours, onSelect(date) }
 * The previous render is replaced in place (caller dims the container while loading).
 */
export function renderCalendar(container, opts) {
  const { series, metric, selected, onSelect } = opts;
  const m = METRICS[metric];
  const start = series[0].date, end = series[series.length - 1].date;
  const { breaks, n } = classBreaks(series.map(m.value), m.integer);
  const gridStart = addDays(start, -weekday(start));
  const weeks = Math.floor(diffDays(gridStart, end) / 7) + 1;
  const byDate = new Map(series.map((d) => [d.date, d]));

  const grid = el('div', { class: 'cal-grid', role: 'group', 'aria-label': `Daily ${m.label} calendar, ${fmtLong(start)} to ${fmtLong(end)}. Use arrow keys to move between days.` });
  const months = el('div', { class: 'cal-months', 'aria-hidden': 'true' });
  months.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;
  const wd = el('div', { class: 'cal-wd', 'aria-hidden': 'true' });
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, i) => wd.append(el('span', { text: i % 2 === 1 ? d : '' })));

  let tabbable = byDate.has(selected) ? selected : start;
  // default roving stop = peak day so keyboard users land on something interesting
  if (!byDate.has(selected)) {
    let best = null;
    for (const d of series) if (m.value(d) > 0 && (!best || m.value(d) > m.value(best))) best = d;
    if (best) tabbable = best.date;
  }

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(gridStart, i);
    const d = byDate.get(date);
    if (!d) { grid.append(el('span', { class: 'cal-pad', 'aria-hidden': 'true' })); continue; }
    const v = m.value(d);
    const slot = rampSlot(classOf(v, breaks), n);
    const label = `${fmtLong(date)}: ${v > 0 ? `${fmtInt(d.cells)} cells with detected fire, ${fmtNum(d.frp || 0)} MW FRP` : 'no detections'}`;
    const b = el('button', {
      type: 'button', class: `cal-cell r${slot}`, 'data-date': date,
      'aria-label': label, 'aria-pressed': date === selected ? 'true' : 'false',
      tabindex: date === tabbable ? '0' : '-1',
    });
    grid.append(b);
  }

  // month labels
  let lastCol = -10;
  let minGap = 3;
  let yearShown = false;
  for (let i = 0; i < series.length; i++) {
    const date = series[i].date;
    if (!(date === start || date.endsWith('-01'))) continue;
    const col = Math.floor(diffDays(gridStart, date) / 7);
    if (col - lastCol < minGap) continue;
    if (date === start && !date.endsWith('-01')) {
      // A partial first month too narrow for "Mon YYYY": let the next month carry the year.
      const d = new Date(date + 'T00:00:00Z');
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      if (Math.floor(diffDays(gridStart, next) / 7) - col < 5) continue;
    }
    // show the year only where it changes (first label and each January)
    const withYear = !yearShown || date.slice(5) === '01-01';
    yearShown = true;
    minGap = withYear ? 4 : 3; // a label carrying a year is wider
    const lab = el('span', { text: fmtMonth(date) + (withYear ? ' ' + date.slice(0, 4) : '') });
    lab.style.gridColumn = `${col + 1}`;
    months.append(lab);
    lastCol = col;
  }

  const inner = el('div', { class: 'cal-inner' }, el('span'), months, wd, grid);
  container.replaceChildren(inner);

  const rows = (d) => [
    ['Cells with detected fire', fmtInt(d.cells)],
    ['Both sensors', fmtInt(d.both), 'both'],
    ['MODIS only', fmtInt(d.modisOnly), 'modis'],
    ['VIIRS only', fmtInt(d.viirsOnly), 'viirs'],
    ['FRP', `${fmtNum(d.frp || 0)} MW`],
    ['MODIS detections', fmtInt(d.modisDetections)],
    ['VIIRS detections', fmtInt(d.viirsDetections)],
  ];
  const show = (btn) => {
    const d = byDate.get(btn.dataset.date);
    if (!d) return;
    if (d.cells === 0) showTip(btn, fmtLong(d.date), [['Cells with detected fire', 'none']]);
    else showTip(btn, fmtLong(d.date), rows(d));
  };
  const focusDate = (date) => {
    const t = grid.querySelector(`[data-date="${date}"]`);
    if (!t) return;
    grid.querySelectorAll('[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
    t.setAttribute('tabindex', '0');
    t.focus();
  };

  grid.addEventListener('pointerover', (e) => { const b = e.target.closest('.cal-cell'); if (b && e.pointerType !== 'touch') show(b); });
  grid.addEventListener('pointerout', (e) => { const b = e.target.closest('.cal-cell'); if (b && document.activeElement !== b) hideTip(b); });
  grid.addEventListener('focusin', (e) => { const b = e.target.closest('.cal-cell'); if (b) show(b); });
  grid.addEventListener('focusout', (e) => { const b = e.target.closest('.cal-cell'); if (b) hideTip(b); });
  grid.addEventListener('click', (e) => { const b = e.target.closest('.cal-cell'); if (b) onSelect(b.dataset.date); });
  grid.addEventListener('keydown', (e) => {
    const b = e.target.closest('.cal-cell');
    if (!b) return;
    const delta = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    let target = null;
    if (delta) target = addDays(b.dataset.date, delta);
    else if (e.key === 'Home') target = start;
    else if (e.key === 'End') target = end;
    if (!target) return;
    e.preventDefault();
    if (target < start) target = start;
    if (target > end) target = end;
    focusDate(target);
  });
  return { setSelected(date) {
    grid.querySelectorAll('.cal-cell').forEach((b) => b.setAttribute('aria-pressed', b.dataset.date === date ? 'true' : 'false'));
  } };
}
