import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollAnchors, scrollPosition } from '../lib/scroll.js';

test('scroll mapping aligns content instead of using the entire-document percentage', () => {
  const anchors = scrollAnchors([{ source: 200, visual: 900 }, { source: 1400, visual: 1200 }], 2000, 3000);
  assert.equal(scrollPosition(200, anchors, 'source'), 900);
  assert.equal(scrollPosition(900, anchors, 'visual'), 200);
  assert.equal(scrollPosition(800, anchors, 'source'), 1050);
  assert.equal(scrollPosition(1050, anchors, 'visual'), 800);
});
test('both surfaces stay bounded at the start, end and across unanchored sections', () => {
  const anchors = scrollAnchors([], 500, 1500);
  assert.equal(scrollPosition(-10, anchors, 'source'), 0);
  assert.equal(scrollPosition(1000, anchors, 'source'), 1500);
  assert.equal(scrollPosition(750, anchors, 'visual'), 250);
});
test('hidden alternatives and duplicate/non-monotonic points cannot produce reverse scrolling', () => {
  const anchors = scrollAnchors([{ source: 200, visual: 500 }, { source: 100, visual: 100 }, { source: 200, visual: 1000 }, { source: 300, visual: 200 }], 500, 1500);
  assert.deepEqual(anchors, [{ source: 0, visual: 0 }, { source: 100, visual: 100 }, { source: 200, visual: 500 }, { source: 500, visual: 1500 }]);
  for (let source = 0; source < 500; source += 10) assert.ok(scrollPosition(source + 10, anchors, 'source') >= scrollPosition(source, anchors, 'source'));
});
test('invalid measurements report errors and short documents still have safe endpoints', () => {
  assert.throws(() => scrollAnchors([], NaN, 1), /finite/);
  assert.throws(() => scrollPosition(Infinity, [{ source: 0, visual: 0 }, { source: 1, visual: 1 }], 'source'), /finite/);
  assert.deepEqual(scrollAnchors([], 0, 0), [{ source: 0, visual: 0 }, { source: 1, visual: 1 }]);
});
