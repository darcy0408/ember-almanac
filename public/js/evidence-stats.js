// Pure statistics + generated sentences for the evidence panel. No DOM; importable by Node tests.
// Input: the precomputed example (see public/data/example-08077.json). All text is built from computed values.
import { addDays, diffDays, fmtShort } from './util.js';

const COLS = ['modisCells', 'modisDetections', 'snppCells', 'snppDetections', 'allCells', 'allDetections', 'allFrp', 'allBoth'];
const SMALL = 30; // baseline mean annual cell-days below this => "counts are small"
const ABOUT = 5; // |difference| below this many percent counts as "about average"
export const EN = '–';

const sum = (a) => a.reduce((s, x) => s + x, 0);
export function median(a) {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const mean = (a) => (a.length ? sum(a) / a.length : null);
const ratio = (num, den) => (den > 0 ? num / den : null);
const pctDiff = (v, base) => (base > 0 ? ((v - base) / base) * 100 : null);
export function stateOf(pct) {
  if (pct == null) return 'none';
  if (Math.abs(pct) < ABOUT) return 'about';
  return pct > 0 ? 'above' : 'below';
}

function ranks(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
/** Spearman rank correlation (Pearson on average ranks). null when undefined. */
export function spearman(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const a = ranks(x), b = ranks(y);
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

function spread(vals) {
  const v = vals.filter((x) => x != null);
  return { median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, n: v.length };
}

/** Leave-one-year-out: one scale factor k (median snpp/modis over the other years) predicts each held-out year. */
export function heldOut(rows) { // rows: [{year, x: modis, y: snpp}]
  const errors = [];
  for (const r of rows) {
    if (!(r.y > 0)) continue;
    const k = median(rows.filter((o) => o !== r && o.x > 0).map((o) => o.y / o.x));
    if (k == null) continue;
    const predicted = k * r.x;
    errors.push({ year: r.year, predicted, actual: r.y, error: Math.abs(predicted - r.y) / r.y });
  }
  return { median: median(errors.map((e) => e.error)), errors };
}

/** Week index 0..52 of a day within its year (7-day blocks from Jan 1). */
export const weekOfYear = (date) => Math.floor(diffDays(`${date.slice(0, 4)}-01-01`, date) / 7);
export function weekRange(year, w) {
  const start = addDays(`${year}-01-01`, w * 7);
  const end = addDays(start, 6);
  const last = `${year}-12-31`;
  return { start, end: end > last ? last : end };
}

export function computeEvidence(ex) {
  const start = ex && ex.start, end = ex && ex.end;
  const daily = (ex && ex.daily) || {};
  const y0 = +String(start || '').slice(0, 4), y1 = +String(end || '').slice(0, 4);
  const completeYears = [];
  if (start && end) {
    for (let y = y0; y <= y1; y++) if (`${y}-01-01` >= start && `${y}-12-31` <= end) completeYears.push(y);
  }
  if (completeYears.length < 3) return { insufficient: true, completeYears };

  const headlineYear = completeYears[completeYears.length - 1];
  const baselineYears = completeYears.slice(0, -1);
  const lastYear = y1;
  const snppEnd = ex.snppEnd || null;

  // incomplete trailing year: compared only over the same month-days of earlier years
  let partial = null;
  if (lastYear > headlineYear) {
    let through = end;
    if (snppEnd) { const d = addDays(snppEnd, -1); if (d < through) through = d; }
    if (through >= `${lastYear}-01-01`) partial = { year: lastYear, through, md: through.slice(5) };
  }

  const zero = () => ({ modisDet: 0, snppDet: 0, modisCells: 0, snppCells: 0, allCells: 0 });
  const tot = new Map(), same = new Map();
  for (const y of completeYears) { tot.set(y, zero()); same.set(y, zero()); }
  if (partial) { same.set(partial.year, zero()); }
  for (const [date, row] of Object.entries(daily)) {
    const y = +date.slice(0, 4);
    const v = { modisCells: row[0] || 0, modisDet: row[1] || 0, snppCells: row[2] || 0, snppDet: row[3] || 0, allCells: row[4] || 0 };
    const t = tot.get(y);
    if (t) for (const k of Object.keys(v)) t[k] += v[k];
    const s = same.get(y);
    if (s && partial && date.slice(5) <= partial.md && !(y === partial.year && date > partial.through)) for (const k of Object.keys(v)) s[k] += v[k];
  }
  const annual = completeYears.map((year) => ({ year, ...tot.get(year) }));
  const by = (y) => annual.find((a) => a.year === y);

  const baseMean = (k) => mean(baselineYears.map((y) => by(y)[k]));
  const side = (k, value, base) => { const pct = pctDiff(value, base); return { value, mean: base, pct, state: stateOf(pct) }; };
  const hy = by(headlineYear);
  const headline = {
    modis: side('modisCells', hy.modisCells, baseMean('modisCells')),
    snpp: side('snppCells', hy.snppCells, baseMean('snppCells')),
  };
  headline.agree = headline.modis.state !== 'none' && headline.modis.state === headline.snpp.state;
  // small-count flag: baseline mean of annual cell-days under 30 for either sensor
  const smallCounts = headline.modis.mean < SMALL || headline.snpp.mean < SMALL;

  if (partial) {
    partial.years = completeYears.map((year) => ({ year, ...same.get(year) }));
    partial.current = same.get(partial.year);
    const m = (k) => mean(partial.years.map((r) => r[k]));
    partial.compare = {
      modis: side('modisCells', partial.current.modisCells, m('modisCells')),
      snpp: side('snppCells', partial.current.snppCells, m('snppCells')),
    };
    partial.compare.agree = partial.compare.modis.state !== 'none' && partial.compare.modis.state === partial.compare.snpp.state;
  }

  const bm = baseMean('modisCells'), bs = baseMean('snppCells');
  const index = annual.map((a) => ({ year: a.year, modis: bm > 0 ? (a.modisCells / bm) * 100 : null, snpp: bs > 0 ? (a.snppCells / bs) * 100 : null }));

  let agree = 0, total = 0;
  for (let i = 1; i < annual.length; i++) {
    const dm = Math.sign(annual[i].modisCells - annual[i - 1].modisCells);
    const ds = Math.sign(annual[i].snppCells - annual[i - 1].snppCells);
    total++; if (dm === ds) agree++;
  }
  const rank = spearman(annual.map((a) => a.modisCells), annual.map((a) => a.snppCells));

  const gap = {
    rawRatio: spread(annual.map((a) => ratio(a.snppDet, a.modisDet))),
    cellRatio: spread(annual.map((a) => ratio(a.snppCells, a.modisCells))),
    heldOutRaw: heldOut(annual.map((a) => ({ year: a.year, x: a.modisDet, y: a.snppDet }))),
    heldOutCells: heldOut(annual.map((a) => ({ year: a.year, x: a.modisCells, y: a.snppCells }))),
  };

  const weekly = [];
  for (let year = completeYears[0]; year <= lastYear; year++) {
    const weeks = [];
    for (let w = 0; w < 53; w++) {
      const ws = addDays(`${year}-01-01`, w * 7);
      if (ws > end) weeks.push(null);
      else weeks.push({ modis: 0, snpp: snppEnd && ws > snppEnd ? null : 0, all: 0 });
    }
    weekly.push({ year, weeks });
  }
  for (const [date, row] of Object.entries(daily)) {
    const y = +date.slice(0, 4);
    const r = weekly.find((x) => x.year === y);
    if (!r) continue;
    const cell = r.weeks[Math.min(52, weekOfYear(date))];
    if (!cell) continue;
    cell.modis += row[0] || 0;
    if (cell.snpp != null) cell.snpp += row[2] || 0;
    cell.all += row[4] || 0;
  }

  return { insufficient: false, smallCounts, completeYears, headlineYear, baselineYears, annual, partial, headline, index, direction: { agree, total }, rank, gap, weekly };
}

// ------------------------------------------------------------------ generated sentences
const yrs = (a) => (a.length > 1 ? `${a[0]}${EN}${a[a.length - 1]}` : String(a[0]));
const pctText = (p) => `${Math.round(Math.abs(p))}%`;
const signed = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.round(Math.abs(p))}%`;

function clause(h, ref) {
  if (h.state === 'none') return `could not be compared with ${ref} (no detections in the comparison period)`;
  if (h.state === 'about') return `about as many cell-days with detected fire as ${ref} (${signed(h.pct)})`;
  return `${pctText(h.pct)} ${h.state === 'above' ? 'more' : 'fewer'} cell-days with detected fire than ${ref}`;
}
const stateWord = (s) => (s === 'about' ? 'about average' : `${s} average`);

export function describe(ev) {
  if (ev.insufficient) return { insufficient: 'Not enough data: at least three complete calendar years are needed for this comparison.' };
  const out = {};
  const h = ev.headline, Y = ev.headlineYear, ref = `its ${yrs(ev.baselineYears)} average`;
  out.headline = `${Y}: MODIS saw ${clause(h.modis, ref)}; VIIRS (Suomi NPP) saw ${clause(h.snpp, ref)}. `
    + (h.agree ? `The two sensors agree: ${stateWord(h.modis.state)}.`
      : `The sensors disagree, so the direction of change in ${Y} is not established by these data.`)
    + (ev.smallCounts ? ' Counts here are small, so year-to-year percentages swing widely.' : '');

  if (ev.partial) {
    const p = ev.partial, c = p.compare;
    const ref2 = `its average for the same dates in ${yrs(ev.completeYears)}`;
    out.partial = `Incomplete year: ${p.year}, January 1${EN}${fmtShort(p.through)}. MODIS saw ${clause(c.modis, ref2)}; VIIRS (Suomi NPP) saw ${clause(c.snpp, ref2)}. `
      + (c.agree ? `The sensors agree: ${stateWord(c.modis.state)} so far.` : `The sensors disagree, so the direction so far is not established.`);
  }

  const r = ev.gap.rawRatio;
  out.rawCaption = r.median == null ? 'The VIIRS-to-MODIS detection ratio could not be computed.'
    : `VIIRS reports a median of ${r.median.toFixed(1)} detections for every MODIS detection (range ${r.min.toFixed(1)}${EN}${r.max.toFixed(1)}), mostly because its pixels are 375 m instead of 1 km.`;

  const d = ev.direction;
  out.indexCaption = `The sensors moved in the same direction in ${d.agree} of ${d.total} year-to-year changes; `
    + (ev.rank == null ? 'rank correlation could not be computed.' : `rank correlation ρ = ${ev.rank.toFixed(2)}.`);

  const a = ev.gap.heldOutRaw.median, b = ev.gap.heldOutCells.median;
  if (a == null || b == null) out.gapSentence = 'The held-out test could not be computed for both measures.';
  else {
    const pa = Math.round(a * 100), pb = Math.round(b * 100), diff = (a - b) * 100;
    if (Math.abs(diff) < 3) out.gapSentence = `Held out, the median error is similar for the two measures: ${pa}% for raw detections and ${pb}% for 1 km cell-days.`;
    else if (diff > 0) out.gapSentence = `Held out, 1 km cell-days gave the smaller median error: ${pb}% against ${pa}% for raw detections (${Math.abs(diff).toFixed(0)} percentage points lower).`;
    else out.gapSentence = `Held out, raw detections gave the smaller median error: ${pa}% against ${pb}% for 1 km cell-days (${Math.abs(diff).toFixed(0)} percentage points lower).`;
  }
  return out;
}

export { COLS };
