// Pure data shaping: fill zero days, summary stats, class breaks, weekly bins.
import { addDays, diffDays, weekday } from './util.js';

export function buildSeries(result, start, end) {
  const map = new Map((result.days || []).map((d) => [d.date, d]));
  const n = diffDays(start, end) + 1;
  const series = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const d = map.get(date);
    series.push(d ? { ...d } : {
      date, cells: 0, both: 0, modisOnly: 0, viirsOnly: 0, frp: 0,
      modisDetections: 0, viirsDetections: 0, highConfCells: 0, nightCells: 0,
    });
  }
  return series;
}

export function summarize(series) {
  let active = 0, peak = null, cellDays = 0, frp = 0, both = 0;
  for (const d of series) {
    if (d.cells > 0) active++;
    if (d.cells > 0 && (!peak || d.cells > peak.cells)) peak = d;
    cellDays += d.cells; frp += d.frp || 0; both += d.both;
  }
  return { active, peak, cellDays, frp, agreement: cellDays ? both / cellDays : null, days: series.length };
}

/** 4 quantile breaks over non-zero values -> up to 5 classes. Returns {breaks, classes}. */
export function classBreaks(values, integer) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return { breaks: [], n: 0 };
  const q = (p) => {
    const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  let breaks = [0.2, 0.4, 0.6, 0.8].map(q).map((x) => (integer ? Math.ceil(x) : Math.round(x * 10) / 10));
  breaks = breaks.filter((b, i) => b < v[v.length - 1] && (i === 0 || b > breaks[i - 1]));
  // dedupe after the filter (filter above compares to the unfiltered previous)
  const uniq = [];
  for (const b of breaks) if (!uniq.length || b > uniq[uniq.length - 1]) uniq.push(b);
  return { breaks: uniq, n: uniq.length + 1 };
}

export function classOf(value, breaks) {
  if (!(value > 0)) return 0;
  let c = 1;
  for (const b of breaks) if (value > b) c++;
  return c; // 1..breaks.length+1
}

/** Map class index (1..n) onto ramp slots 1..5 so the darkest class is always the darkest ramp step. */
export function rampSlot(c, n) {
  if (c === 0) return 0;
  if (n <= 1) return 5;
  return 1 + Math.round(((c - 1) * 4) / (n - 1));
}

/** Weekly (Sunday-start) or daily bins of the three partitions. */
export function bins(series, daily) {
  if (daily) {
    return series.map((d) => ({ start: d.date, end: d.date, both: d.both, modisOnly: d.modisOnly, viirsOnly: d.viirsOnly, days: 1 }));
  }
  const out = [];
  let cur = null;
  for (const d of series) {
    if (!cur || weekday(d.date) === 0) {
      cur = { start: d.date, end: d.date, both: 0, modisOnly: 0, viirsOnly: 0, days: 0 };
      out.push(cur);
    }
    cur.end = d.date; cur.days++;
    cur.both += d.both; cur.modisOnly += d.modisOnly; cur.viirsOnly += d.viirsOnly;
  }
  return out;
}

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
