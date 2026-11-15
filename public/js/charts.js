// "Sensor agreement over time": one stacked bar per week (per day for short ranges). DOM-built, one y-axis.
import { bins, niceMax } from './analysis.js';
import { el, fmtInt, fmtShort, fmtMed, fmtMonth } from './util.js';
import { showTip, hideTip } from './tip.js';

const PLOT_H = 176;

export function renderAgreement(container, series) {
  const daily = series.length <= 45;
  const b = bins(series, daily);
  const totals = b.map((x) => x.both + x.modisOnly + x.viirsOnly);
  const max = niceMax(Math.max(...totals, 0));
  const unit = daily ? 'day' : 'week';

  const ticks = [0, 0.5, 1].map((f) => max * f);
  const yAxis = el('div', { class: 'agr-y', 'aria-hidden': 'true' });
  const plot = el('div', { class: 'agr-plot' });
  for (const t of ticks) {
    const pos = (t / max) * PLOT_H;
    const lab = el('span', { class: 'tick', text: fmtInt(t) });
    lab.style.bottom = `${pos}px`;
    yAxis.append(lab);
    if (t > 0) { const g = el('i', { class: 'grid' }); g.style.bottom = `${pos}px`; plot.append(g); }
  }
  const bars = el('div', { class: 'agr-bars' });
  const xAxis = el('div', { class: 'agr-x', 'aria-hidden': 'true' });
  const minGap = daily ? 7 : Math.max(3, Math.ceil(b.length / 11));
  let lastLabel = -99;

  b.forEach((x, i) => {
    const bar = el('div', { class: 'agr-bar' });
    for (const [k, cls] of [['both', 'both'], ['modisOnly', 'modis'], ['viirsOnly', 'viirs']]) {
      if (!x[k]) continue;
      const seg = el('i', { class: `seg ${cls}` });
      seg.style.height = `${Math.max(2, (x[k] / max) * PLOT_H)}px`;
      bar.append(seg);
    }
    const total = x.both + x.modisOnly + x.viirsOnly;
    const title = daily ? fmtMed(x.start) : `Week of ${fmtShort(x.start)} – ${fmtMed(x.end)}`;
    bar.addEventListener('pointerenter', () => showTip(bar, title, [
      [`Cell-days (${unit})`, fmtInt(total)],
      ['Both sensors', fmtInt(x.both), 'both'],
      ['MODIS only', fmtInt(x.modisOnly), 'modis'],
      ['VIIRS only', fmtInt(x.viirsOnly), 'viirs'],
      ['Agreement', total ? `${Math.round((x.both / total) * 100)}%` : 'n/a'],
    ]));
    bar.addEventListener('pointerleave', () => hideTip(bar));
    bars.append(bar);

    const first = daily ? i % 7 === 0 : (x.start.endsWith('-01') || (x.start.slice(8) <= '07' && (i === 0 || b[i - 1].start.slice(5, 7) !== x.start.slice(5, 7)))) || i === 0;
    if (first && i - lastLabel >= minGap) {
      const lab = el('span', { text: daily ? fmtShort(x.start) : fmtMonth(x.start) + (x.start.slice(5, 7) === '01' || i === 0 ? ` ${x.start.slice(2, 4)}` : '') });
      lab.style.left = `${((i + 0.5) / b.length) * 100}%`;
      xAxis.append(lab);
      lastLabel = i;
    }
  });
  plot.append(bars);

  const all = totals.reduce((a, c) => a + c, 0);
  const wrap = el('div', { class: 'agr', role: 'img',
    'aria-label': `Stacked bars of cell-days with detected fire per ${unit}, split into both sensors, MODIS only and VIIRS only. ${all} cell-days in total. The data table below lists every day.` },
  el('div', { class: 'agr-ytitle', text: `Cell-days with detected fire per ${unit}` }), yAxis, plot, el('span'), xAxis);
  container.replaceChildren(wrap);
}
