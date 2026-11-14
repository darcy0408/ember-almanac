import test from 'node:test';
import assert from 'node:assert/strict';
import { bboxOfGeometry, pointInGeometry, validateBbox, padBbox } from '../lib/geo.js';

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

test('polygon with a hole', () => {
  const g = { type: 'Polygon', coordinates: [sq(0, 0, 10, 10), sq(4, 4, 6, 6)] };
  assert.equal(pointInGeometry(2, 2, g), true);
  assert.equal(pointInGeometry(5, 5, g), false);
  assert.equal(pointInGeometry(11, 5, g), false);
  assert.deepEqual(bboxOfGeometry(g), [0, 0, 10, 10]);
});

test('multipolygon', () => {
  const g = { type: 'MultiPolygon', coordinates: [[sq(0, 0, 1, 1)], [sq(5, 5, 6, 6)]] };
  assert.equal(pointInGeometry(0.5, 0.5, g), true);
  assert.equal(pointInGeometry(5.5, 5.5, g), true);
  assert.equal(pointInGeometry(3, 3, g), false);
  assert.deepEqual(bboxOfGeometry(g), [0, 0, 6, 6]);
});

test('validateBbox and padBbox', () => {
  assert.equal(validateBbox([0, 0, 1, 1]), null);
  assert.ok(validateBbox([0, 0, 25, 1]));
  assert.ok(validateBbox([1, 0, 0, 1]));
  assert.ok(validateBbox('x'));
  assert.deepEqual(padBbox([0, 0, 1, 1], 0.5), [-0.5, -0.5, 1.5, 1.5]);
});
