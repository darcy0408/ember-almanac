import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvidence, describe, spearman, heldOut, median, weekRange } from '../public/js/evidence-stats.js';

const MC = { 2020: 10, 2021: 20, 2022: 15, 2023: 30, 2024: 12 }; // MODIS cell-days per year
// Each complete year: half (rounded down) on Jan 5, the rest on Jul 10. VIIRS = 2x cells, 7x... detections: MODIS det 3x cells, VIIRS det 9x cells.
function example(over = {}) {
  const daily = {};
  const mc = over.mc || MC;
  const sc = over.sc || Object.fromEntries(Object.entries(mc).map(([y, v]) => [y, v * 2]));
  for (const y of Object.keys(mc)) {
    const a = Math.floor(mc[y] / 2), b = mc[y] - a, sa = Math.floor(sc[y] / 2), sb = sc[y] - sa;
    daily[`${y}-01-05`] = [a, a * 3, sa, sa * 9, a + sa, 0, 0, 0];
    daily[`${y}-07-10`] = [b, b * 3, sb, sb * 9, b + sb, 0, 0, 0];
  }
  daily['2025-01-05'] = [4, 12, 8, 36, 12, 0, 0, 0];
  daily['2025-03-03'] = [2, 6, 4, 18, 6, 0, 0, 0];
  daily['2025-06-25'] = [100, 300, 0, 0, 100, 0, 0, 0]; // after snppEnd - 1: must not enter the same-period sums
  return {
    start: '2020-01-01', end: '2025-06-30', snppEnd: '2025-06-20', tzOffsetHours: -7, cellSizeKm: 1,
    columns: [], daily, ...over.extra,
  };
}

test('annual sums and complete years', () => {
  const ev = computeEvidence(example());
  assert.deepEqual(ev.completeYears, [2020, 2021, 2022, 2023, 2024]);
  assert.equal(ev.headlineYear, 2024);
  assert.deepEqual(ev.baselineYears, [2020, 2021, 2022, 2023]);
  const a22 = ev.annual.find((a) => a.year === 2022);
  assert.equal(a22.modisCells, 15);
  assert.equal(a22.snppCells, 30);
  assert.equal(a22.modisDet, 45);
  assert.equal(a22.snppDet, 270);
  assert.equal(a22.allCells, 45);
});

test('partial year is compared with the same dates of earlier years only', () => {
  const ev = computeEvidence(example());
  assert.equal(ev.partial.year, 2025);
  assert.equal(ev.partial.through, '2025-06-19'); // day before snppEnd, earlier than end
  assert.equal(ev.partial.current.modisCells, 6); // Jan 5 + Mar 3 only
  assert.equal(ev.partial.current.snppCells, 12);
  const y20 = ev.partial.years.find((y) => y.year === 2020);
  assert.equal(y20.modisCells, 5); // Jan 5 half only, Jul 10 excluded
  assert.equal(ev.partial.compare.modis.mean, (5 + 10 + 7 + 15 + 6) / 5);
  assert.equal(ev.partial.compare.modis.state, 'below');
  assert.ok(ev.partial.compare.agree);
});

test('no partial year when the file ends on Dec 31', () => {
  const ex = example();
  ex.end = '2024-12-31'; ex.snppEnd = null; delete ex.daily['2025-01-05']; delete ex.daily['2025-03-03']; delete ex.daily['2025-06-25'];
  assert.equal(computeEvidence(ex).partial, null);
});

test('headline states, percent differences and agreement', () => {
  const ev = computeEvidence(example());
  assert.equal(ev.headline.modis.value, 12);
  assert.equal(ev.headline.modis.mean, 18.75);
  assert.ok(Math.abs(ev.headline.modis.pct - -36) < 1e-9);
  assert.equal(ev.headline.modis.state, 'below');
  assert.equal(ev.headline.snpp.state, 'below');
  assert.equal(ev.headline.agree, true);
  assert.equal(ev.smallCounts, true);
  const text = describe(ev);
  assert.match(text.headline, /^2024: MODIS saw 36% fewer cell-days with detected fire than its 2020–2023 average/);
  assert.match(text.headline, /The two sensors agree: below average\./);
  assert.match(text.headline, /Counts here are small/);
  assert.match(text.partial, /^Incomplete year: 2025, January 1/);
});

test('disagreement and "about average" band', () => {
  // headline year 2024: MODIS +40% vs baseline, VIIRS about average
  const mc = { 2020: 100, 2021: 100, 2022: 100, 2023: 100, 2024: 140 };
  const sc = { 2020: 200, 2021: 200, 2022: 200, 2023: 200, 2024: 204 };
  const ev = computeEvidence(example({ mc, sc }));
  assert.equal(ev.headline.modis.state, 'above');
  assert.equal(ev.headline.snpp.state, 'about'); // +2% is inside the 5% band
  assert.equal(ev.headline.agree, false);
  assert.equal(ev.smallCounts, false);
  const t = describe(ev).headline;
  assert.match(t, /sensors disagree, so the direction of change in 2024 is not established/);
  assert.match(t, /about as many cell-days with detected fire as its 2020–2023 average/);
  assert.doesNotMatch(t, /Counts here are small/);
});

test('direction counts, including unchanged pairs', () => {
  const ev = computeEvidence(example());
  assert.deepEqual(ev.direction, { agree: 4, total: 4 });
  // 2021->2022 MODIS flat while VIIRS moves: disagree. 2022->2023 both flat: agree.
  const mc = { 2020: 10, 2021: 20, 2022: 20, 2023: 20, 2024: 25 };
  const sc = { 2020: 20, 2021: 40, 2022: 41, 2023: 41, 2024: 50 };
  const e2 = computeEvidence(example({ mc, sc }));
  assert.deepEqual(e2.direction, { agree: 3, total: 4 });
});

test('index is each sensor as a percent of its own baseline mean', () => {
  const ev = computeEvidence(example());
  const i24 = ev.index.find((i) => i.year === 2024);
  assert.ok(Math.abs(i24.modis - 64) < 1e-9); // 12 / 18.75
  assert.ok(Math.abs(i24.snpp - 64) < 1e-9);
});

test('spearman on known series', () => {
  assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) - 0.8) < 1e-12);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null); // no variance
  assert.ok(Math.abs(spearman([1, 2, 2, 4], [10, 20, 20, 40]) - 1) < 1e-12); // ties
});

test('leave-one-year-out: exact constant ratio gives zero error', () => {
  const ev = computeEvidence(example());
  assert.equal(ev.gap.heldOutCells.median, 0);
  assert.ok(ev.gap.heldOutCells.errors.every((e) => e.error < 1e-12));
  assert.equal(ev.gap.cellRatio.median, 2);
  assert.equal(ev.gap.rawRatio.median, 6); // 270/45
  assert.equal(ev.gap.rawRatio.min, 6);
  assert.equal(ev.gap.rawRatio.max, 6);
});

test('leave-one-year-out: one outlier year only hurts its own prediction', () => {
  const rows = [10, 20, 15, 30, 12].map((x, i) => ({ year: 2020 + i, x, y: i === 2 ? 150 : x * 2 }));
  const r = heldOut(rows);
  assert.equal(r.errors.length, 5);
  const out = r.errors.find((e) => e.year === 2022);
  assert.ok(Math.abs(out.error - 0.8) < 1e-12); // k = 2, predicted 30, actual 150
  assert.equal(r.median, 0);
  assert.equal(r.errors.filter((e) => e.error > 1e-12).length, 1);
});

test('leave-one-year-out guards zero denominators', () => {
  const r = heldOut([{ year: 1, x: 0, y: 0 }, { year: 2, x: 5, y: 10 }, { year: 3, x: 6, y: 12 }]);
  assert.deepEqual(r.errors.map((e) => e.year), [2, 3]);
  assert.equal(median([]), null);
});

test('weekly: 53 entries, null after end, snpp null after snppEnd, zero is not null', () => {
  const ev = computeEvidence(example());
  assert.deepEqual(ev.weekly.map((r) => r.year), [2020, 2021, 2022, 2023, 2024, 2025]);
  for (const r of ev.weekly) assert.equal(r.weeks.length, 53);
  const w25 = ev.weekly[5].weeks;
  assert.deepEqual(w25[0], { modis: 4, snpp: 8, all: 12 }); // Jan 5 is in week 0
  assert.deepEqual(w25[1], { modis: 0, snpp: 0, all: 0 }); // observed, nothing detected: zero, not null
  assert.equal(w25[24].snpp, 0); // week starts Jun 18, before snppEnd
  assert.equal(w25[25].snpp, null); // week starts Jun 25, after snppEnd
  assert.equal(w25[25].modis, 100); // MODIS still observed
  assert.equal(w25[26], null); // starts Jul 2, after end
  assert.equal(w25[52], null);
  assert.notEqual(ev.weekly[0].weeks[52], null);
  assert.deepEqual(weekRange(2025, 52), { start: '2025-12-31', end: '2025-12-31' }); // 365-day year: last block has one day
  assert.deepEqual(weekRange(2024, 52), { start: '2024-12-30', end: '2024-12-31' });
});

test('too little data is reported as insufficient', () => {
  const ex = { start: '2023-01-01', end: '2025-06-30', snppEnd: null, daily: { '2024-02-02': [1, 1, 1, 1, 1, 1, 0, 0] } };
  const ev = computeEvidence(ex); // only 2023 and 2024 are complete
  assert.equal(ev.insufficient, true);
  assert.match(describe(ev).insufficient, /at least three complete/);
  assert.equal(computeEvidence({}).insufficient, true);
});
