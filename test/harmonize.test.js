import test from 'node:test';
import assert from 'node:assert/strict';
import { cellOf, harmonize } from '../lib/harmonize.js';

const det = (o) => ({ lat: 34.005, lon: -118.005, utc: Date.UTC(2025, 7, 10, 21, 30), sensor: 'VIIRS', satellite: 'NOAA-20', conf: 'nominal', frp: 1, daynight: 'D', source: 'X', ...o });

test('VIIRS cluster + MODIS pixel in one 1 km cell -> one cell, sensors both, FRP not double counted', () => {
  const c = cellOf(34.005, -118.005);
  const near = (dl, dn) => ({ lat: c.lat + dl, lon: c.lon + dn });
  const t = Date.UTC(2025, 7, 10, 21, 30);
  const dets = [
    det({ ...near(0.001, 0.001), sensor: 'VIIRS', satellite: 'NOAA-20', frp: 6, utc: t, conf: 'high' }),
    det({ ...near(-0.001, 0.001), sensor: 'VIIRS', satellite: 'NOAA-20', frp: 4, utc: t + 20000 }), // same minute: same overpass, adds
    det({ ...near(0, 0), sensor: 'VIIRS', satellite: 'NOAA-20', frp: 9, utc: t + 3600e3 }), // later overpass: max not sum
    det({ ...near(0, 0), sensor: 'MODIS', satellite: 'Terra', frp: 12, utc: t }),
  ];
  const { days, cells } = harmonize(dets, { tzOffsetHours: 0 });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].sensors, 'both');
  assert.equal(cells[0].modisN, 1);
  assert.equal(cells[0].viirsN, 3);
  assert.equal(cells[0].conf, 'high');
  assert.equal(cells[0].frp, 12); // max(VIIRS: max(6+4, 9) = 10, MODIS: 12)
  assert.equal(days[0].cells, 1);
  assert.equal(days[0].both, 1);
  assert.equal(days[0].frp, 12);
});

test('FRP: VIIRS overpass sum beats MODIS when larger; overpasses are not summed', () => {
  const t = Date.UTC(2025, 7, 10, 21, 30);
  const dets = [
    det({ frp: 6, utc: t }), det({ frp: 7, utc: t }),
    det({ frp: 9, utc: t + 2 * 3600e3 }),
    det({ sensor: 'MODIS', satellite: 'Aqua', frp: 5, utc: t }),
  ];
  const { cells } = harmonize(dets, { tzOffsetHours: 0 });
  assert.equal(cells[0].frp, 13);
});

test('local day shift: 02:00 UTC at tz -7 belongs to the previous local day', () => {
  const d = det({ utc: Date.UTC(2025, 7, 11, 2, 0) });
  assert.equal(harmonize([d], { tzOffsetHours: -7 }).days[0].date, '2025-08-10');
  assert.equal(harmonize([d], { tzOffsetHours: 0 }).days[0].date, '2025-08-11');
});

test('separate days and cells, day summaries sorted', () => {
  const dets = [
    det({ utc: Date.UTC(2025, 7, 12, 20, 0), lat: 35, daynight: 'N', conf: 'high' }),
    det({ utc: Date.UTC(2025, 7, 10, 20, 0) }),
    det({ utc: Date.UTC(2025, 7, 10, 20, 0), lat: 36, sensor: 'MODIS', satellite: 'Aqua' }),
  ];
  const { days, cells } = harmonize(dets, { tzOffsetHours: 0 });
  assert.deepEqual(days.map((d) => d.date), ['2025-08-10', '2025-08-12']);
  assert.equal(days[0].cells, 2);
  assert.equal(days[0].viirsOnly, 1);
  assert.equal(days[0].modisOnly, 1);
  assert.equal(days[1].highConfCells, 1);
  assert.equal(days[1].nightCells, 1);
  assert.equal(cells.length, 3);
});

test('agreement tolerates one cell of geolocation error, but not more', () => {
  const mk = (lat, lon, sensor) => ({
    lat, lon, utc: Date.UTC(2026, 7, 1, 20), sensor, satellite: sensor, conf: 'nominal', frp: 5, daynight: 'D',
  });
  const { cells, days } = harmonize(
    [mk(40.005, -105.005, 'MODIS'), mk(40.015, -105.02, 'VIIRS'), mk(40.2, -105.2, 'VIIRS')],
    { tzOffsetHours: -7 },
  );
  assert.deepEqual(cells.map((c) => c.sensors).sort(), ['both', 'both', 'viirs']);
  assert.equal(days[0].cells, 3); // neighbours agree but are still counted as separate cells
  assert.equal(days[0].both, 2);
  assert.equal(days[0].viirsOnly, 1);
});
