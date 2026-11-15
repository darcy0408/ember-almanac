// Hand-rolled charts for the evidence panel: grouped bars, indexed lines (SVG) and the year x week heatmap (DOM).
// Colours come only from CSS custom properties, so an entity keeps one colour across the page.
import { el, fmtInt, fmtCompact, fmtShort, fmtNum } from './util.js';
import { classBreaks, classOf, rampSlot } from './analysis.js';
import { legendItems } from './calendar.js';
import { showTip, hideTip } from './tip.js';
import { weekRange } from './evidence-stats.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
const stext = (attrs, text) => { const n = s('text', attrs); n.textContent = text; return n; };

const M = { l: 54, r: 14, t: 10, b: 28 };
const H = 260;

/** Nice tick step so there are about `target` intervals. */
function niceTicks(lo, hi, target = 4) {
  const span = Math.max(hi - lo, 1e-9);
  const raw = span / target, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, lo: a, hi: b };
}

/** Re-runs draw(width) whenever the container's width changes. */
export function responsive(container, draw) {
  let last = -1;
  const run = () => {
    const w = Math.max(280, Math.floor(container.clientWidth || 640));
    if (w === last) return;
    last = w; draw(w);
  };
  run();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(run)).observe(container);
}

/** One focusable overlay that maps pointer x / arrow keys to a category index. */
function scrub(svg, { x0, x1, y0, y1, n, label, onSelect, onClear }) {
  const over = s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'transparent', tabindex: 0, class: 'ev-overlay', role: 'group', 'aria-label': label });
  let idx = -1;
  const at = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    return Math.max(0, Math.min(n - 1, Math.floor(((px - x0) / (x1 - x0)) * n)));
  };
  const set = (i) => { idx = i; onSelect(i); };
  over.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' || e.buttons) set(at(e.clientX)); });
  over.addEventListener('pointerdown', (e) => set(at(e.clientX)));
  over.addEventListener('pointerleave', () => { if (document.activeElement !== over) { idx = -1; onClear(); } });
  over.addEventListener('focus', () => set(idx < 0 ? n - 1 : idx));
  over.addEventListener('blur', () => { idx = -1; onClear(); });
  over.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (e.key === 'Home') { e.preventDefault(); set(0); } else if (e.key === 'End') { e.preventDefault(); set(n - 1); } else if (d) { e.preventDefault(); set(Math.max(0, Math.min(n - 1, (idx < 0 ? n - 1 : idx) + d))); }
  });
  return over;
}

function frame(width, yAxis, years, xOf) {
  const g = s('g', { class: 'ev-axes' });
  for (const t of yAxis.ticks) {
    const y = yAxis.y(t);
    g.append(s('line', { x1: M.l, x2: width - M.r, y1: y, y2: y, class: t === yAxis.ticks[0] ? 'ev-base' : 'ev-grid' }));
    g.append(stext({ x: M.l - 8, y: y + 4, 'text-anchor': 'end', class: 'ev-tick' }, yAxis.fmt(t)));
  }
  const step = xOf.band >= 34 ? 1 : xOf.band >= 18 ? 2 : 3;
  years.forEach((yr, i) => { if (i % step === 0) g.append(stext({ x: xOf(i), y: H - 8, 'text-anchor': 'middle', class: 'ev-tick' }, String(yr))); });
  return g;
}

function bandX(width, n) {
  const band = (width - M.l - M.r) / n;
  const f = (i) => M.l + band * (i + 0.5);
  f.band = band;
  return f;
}

function roundedTop(x, y, w, h, r0) {
  const r = Math.min(r0, w / 2, h);
  return `M${x} ${y + h}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h}Z`;
}

/** Chart A: grouped bars, MODIS vs VIIRS Suomi NPP detections per year, one y axis. */
export function drawBars(container, annual) {
  responsive(container, (width) => {
    const n = annual.length;
    const max = Math.max(1, ...annual.map((a) => Math.max(a.modisDet, a.snppDet)));
    const nt = niceTicks(0, max);
    const y = Object.assign((v) => M.t + (1 - (v - nt.lo) / (nt.hi - nt.lo)) * (H - M.t - M.b), {});
    const xOf = bandX(width, n);
    const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, width, height: H, class: 'ev-svg', role: 'img',
      'aria-label': `Grouped bars of raw detections per year for MODIS and VIIRS Suomi NPP, ${annual[0].year} to ${annual[n - 1].year}. The data table below lists every value.` });
    svg.append(frame(width, { ticks: nt.ticks, y, fmt: (t) => fmtCompact(t) }, annual.map((a) => a.year), xOf));
    const hi = s('rect', { class: 'ev-hi', width: xOf.band, y: M.t, height: H - M.t - M.b, visibility: 'hidden' });
    svg.append(hi);
    const groupW = Math.min(xOf.band - 6, 44), bw = (groupW - 2) / 2;
    annual.forEach((a, i) => {
      const gx = xOf(i) - groupW / 2;
      for (const [k, cls, off] of [['modisDet', 'ev-bar-modis', 0], ['snppDet', 'ev-bar-viirs', bw + 2]]) {
        const h = y(0) - y(a[k]);
        if (h > 0) svg.append(s('path', { d: roundedTop(gx + off, y(a[k]), bw, h, 4), class: cls }));
      }
    });
    const anchor = s('rect', { width: 1, height: 1, fill: 'none', 'pointer-events': 'none' });
    svg.append(anchor);
    const over = scrub(svg, {
      x0: M.l, x1: width - M.r, y0: M.t, y1: H - M.b, n,
      label: 'Raw detections per year. Use the left and right arrow keys to move between years.',
      onSelect: (i) => {
        const a = annual[i];
        hi.setAttribute('x', xOf(i) - xOf.band / 2); hi.setAttribute('visibility', 'visible');
        anchor.setAttribute('x', xOf(i)); anchor.setAttribute('y', y(Math.max(a.modisDet, a.snppDet)));
        showTip(anchor, String(a.year), [['MODIS', fmtInt(a.modisDet), 'modis'], ['VIIRS Suomi NPP', fmtInt(a.snppDet), 'viirs']]);
      },
      onClear: () => { hi.setAttribute('visibility', 'hidden'); hideTip(anchor); },
    });
    svg.append(over);
    container.replaceChildren(svg);
  });
}

/** Chart B: each sensor's annual cell-days as % of its own baseline mean, two lines, crosshair + one tooltip. */
export function drawIndex(container, index, baselineLabel) {
  responsive(container, (width) => {
    const n = index.length;
    const vals = index.flatMap((d) => [d.modis, d.snpp]).filter((v) => v != null);
    if (!vals.length) { container.replaceChildren(el('p', { class: 'hint', text: 'No baseline to index against.' })); return; }
    const nt = niceTicks(Math.min(100, ...vals) * 0.95, Math.max(100, ...vals) * 1.05, 4);
    const y = (v) => M.t + (1 - (v - nt.lo) / (nt.hi - nt.lo)) * (H - M.t - M.b);
    const xOf = bandX(width, n);
    const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, width, height: H, class: 'ev-svg', role: 'img',
      'aria-label': `Lines of each sensor's cell-days with detected fire per year as a percent of its own ${baselineLabel} average, ${index[0].year} to ${index[n - 1].year}. The data table below lists every value.` });
    svg.append(frame(width, { ticks: nt.ticks, y, fmt: (t) => `${fmtNum(t)}%` }, index.map((d) => d.year), xOf));
    svg.append(s('line', { x1: M.l, x2: width - M.r, y1: y(100), y2: y(100), class: 'ev-ref' }));
    svg.append(stext({ x: width - M.r, y: y(100) - 5, 'text-anchor': 'end', class: 'ev-reflabel' }, '100% = own average'));
    const cross = s('line', { y1: M.t, y2: H - M.b, class: 'ev-cross', visibility: 'hidden' });
    svg.append(cross);
    for (const [k, cls, diamond] of [['modis', 'modis', false], ['snpp', 'viirs', true]]) {
      const pts = index.map((d, i) => (d[k] == null ? null : [xOf(i), y(d[k])]));
      let dpath = '', pen = false;
      for (const p of pts) { if (!p) { pen = false; continue; } dpath += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; pen = true; }
      svg.append(s('path', { d: dpath, class: `ev-line ev-line-${cls}` }));
      for (const p of pts) {
        if (!p) continue;
        svg.append(diamond
          ? s('rect', { x: p[0] - 4.6, y: p[1] - 4.6, width: 9.2, height: 9.2, transform: `rotate(45 ${p[0]} ${p[1]})`, class: `ev-mark ev-mark-${cls}` })
          : s('circle', { cx: p[0], cy: p[1], r: 5, class: `ev-mark ev-mark-${cls}` }));
      }
    }
    const anchor = s('rect', { width: 1, height: 1, fill: 'none', 'pointer-events': 'none' });
    svg.append(anchor);
    svg.append(scrub(svg, {
      x0: M.l, x1: width - M.r, y0: M.t, y1: H - M.b, n,
      label: 'Indexed cell-days per year. Use the left and right arrow keys to move between years.',
      onSelect: (i) => {
        const d = index[i];
        cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i)); cross.setAttribute('visibility', 'visible');
        anchor.setAttribute('x', xOf(i)); anchor.setAttribute('y', y(Math.max(d.modis ?? 0, d.snpp ?? 0)));
        const f = (v) => (v == null ? 'n/a' : `${Math.round(v)}%`);
        showTip(anchor, String(d.year), [['MODIS', f(d.modis), 'modis'], ['VIIRS Suomi NPP', f(d.snpp), 'viirs']], { valueFirst: true });
      },
      onClear: () => { cross.setAttribute('visibility', 'hidden'); hideTip(anchor); },
    }));
    container.replaceChildren(svg);
  });
}

// ------------------------------------------------------------------ heatmap
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SENSORS = { modis: 'MODIS', snpp: 'VIIRS Suomi NPP', all: 'All sensors' };

/**
 * weekly: [{year, weeks:[{modis,snpp,all}|null]}]; sensor: 'modis'|'snpp'|'all'.
 * Returns nothing; replaces the grid and legend contents.
 */
export function drawHeatmap(gridBox, legendBox, weekly, sensor) {
  const values = weekly.flatMap((r) => r.weeks.map((w) => (w ? w[sensor] : null)).filter((v) => v != null));
  const { breaks, n } = classBreaks(values, true);
  const months = el('div', { class: 'hm-months', 'aria-hidden': 'true' });
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = 0;
  MONTHS.forEach((m, i) => { const lab = el('span', { text: m }); lab.style.gridColumn = String(Math.floor(doy / 7) + 1); months.append(lab); doy += dim[i]; });
  const years = el('div', { class: 'hm-years', 'aria-hidden': 'true' }, ...weekly.map((r) => el('span', { text: String(r.year) })));
  const grid = el('div', { class: 'hm-grid', role: 'group', 'aria-label': `Cell-days per week, ${SENSORS[sensor]}, one row per year. Use arrow keys to move between weeks and years.` });

  let peak = { v: -1, r: weekly.length - 1, c: 0 };
  weekly.forEach((r, ri) => r.weeks.forEach((w, ci) => { if (w && w[sensor] > peak.v) peak = { v: w[sensor], r: ri, c: ci }; }));

  const info = (r, c) => {
    const w = weekly[r].weeks[c], rg = weekRange(weekly[r].year, c);
    const range = `${fmtShort(rg.start)} – ${fmtShort(rg.end)}`;
    return { w, range, title: `${weekly[r].year}: ${range}` };
  };
  const nodata = (v) => v == null;
  weekly.forEach((r, ri) => r.weeks.forEach((w, ci) => {
    const v = w ? w[sensor] : null;
    const { range } = info(ri, ci);
    const cls = nodata(v) ? 'hm-cell nodata' : `hm-cell r${rampSlot(classOf(v, breaks), n)}`;
    grid.append(el('button', {
      type: 'button', class: cls, 'data-r': ri, 'data-c': ci, tabindex: ri === peak.r && ci === peak.c ? '0' : '-1',
      'aria-label': `${r.year}, ${range}: ${nodata(v) ? 'no data' : `${fmtInt(v)} cell-days with detected fire`}`,
    }));
  }));

  const show = (b) => {
    const ri = +b.dataset.r, ci = +b.dataset.c;
    const { w, title } = info(ri, ci);
    const f = (v) => (v == null ? 'no data' : fmtInt(v));
    showTip(b, title, w
      ? [['MODIS', f(w.modis), 'modis'], ['VIIRS Suomi NPP', f(w.snpp), 'viirs'], ['All sensors', f(w.all)]]
      : [['Data', 'none (after the end)']]);
  };
  grid.addEventListener('pointerover', (e) => { const b = e.target.closest('.hm-cell'); if (b && e.pointerType !== 'touch') show(b); });
  grid.addEventListener('pointerout', (e) => { const b = e.target.closest('.hm-cell'); if (b && document.activeElement !== b) hideTip(b); });
  grid.addEventListener('focusin', (e) => { const b = e.target.closest('.hm-cell'); if (b) show(b); });
  grid.addEventListener('focusout', (e) => { const b = e.target.closest('.hm-cell'); if (b) hideTip(b); });
  grid.addEventListener('keydown', (e) => {
    const b = e.target.closest('.hm-cell');
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!b || !d) return;
    e.preventDefault();
    const r = Math.max(0, Math.min(weekly.length - 1, +b.dataset.r + d[0])), c = Math.max(0, Math.min(52, +b.dataset.c + d[1]));
    const t = grid.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    grid.querySelectorAll('[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
    t.setAttribute('tabindex', '0'); t.focus();
  });

  gridBox.replaceChildren(el('div', { class: 'hm-inner' }, el('span'), months, years, grid));

  const { items } = legendItems(values.map((v) => ({ cells: v })), 'cells');
  legendBox.replaceChildren(
    el('span', { class: 'legend-title', text: 'Cell-days with detected fire per week:' }),
    ...items.map((it) => el('span', { class: 'legend-item' }, el('i', { class: `sw r${it.slot}`, 'aria-hidden': 'true' }), el('span', { text: it.label }))),
    el('span', { class: 'legend-item' }, el('i', { class: 'sw nodata', 'aria-hidden': 'true' }), el('span', { text: 'No data (not observed)' })),
  );
}
