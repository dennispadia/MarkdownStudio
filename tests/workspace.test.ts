import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPair, groupTabs, pairFor, splitRatio } from '../lib/workspace.js';

test('five files become one paired tab plus three individual tabs without changing document order', () => {
  const documents = ['a', 'b', 'c', 'd', 'e'];
  const pair = createPair(documents, [], 'a', 'b');
  const groups = groupTabs(documents, [pair]);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map(group => group.documentIds), [['a', 'b'], ['c'], ['d'], ['e']]);
  assert.deepEqual(documents, ['a', 'b', 'c', 'd', 'e']);
  pair.activeId = 'b';
  pair.ratio = 0.6;
  assert.equal(groupTabs(documents, [pair])[0].activeId, 'b');
  assert.equal(groupTabs(documents, [pair])[0].pair?.ratio, 0.6);
  assert.deepEqual(groupTabs(documents, []).map(group => group.documentIds), documents.map(id => [id]));
});

test('nonadjacent files pair in one shared strip and unpair to their original positions', () => {
  const documents = ['a', 'b', 'c', 'd', 'e'];
  const pair = createPair(documents, [], 'd', 'b');
  assert.deepEqual(groupTabs(documents, [pair]).map(group => group.documentIds), [['a'], ['d', 'b'], ['c'], ['e']]);
  assert.equal(pairFor([pair], 'b'), pair);
  assert.equal(pairFor([pair], 'd'), pair);
  assert.equal(pairFor([pair], 'c'), undefined);
  assert.deepEqual(groupTabs(documents, []).map(group => group.id), documents);
});

test('pairs contain exactly two distinct open files and cannot share a document', () => {
  const documents = ['a', 'b', 'c', 'd'];
  const first = createPair(documents, [], 'a', 'b');
  assert.throws(() => createPair(documents, [], 'a', 'a'), /different file/);
  assert.throws(() => createPair(documents, [], 'a', 'missing'), /no longer open/);
  assert.throws(() => createPair(documents, [first], 'c', 'b'), /Unsplit/);
  const second = createPair(documents, [first], 'c', 'd');
  assert.deepEqual(groupTabs(documents, [first, second]).map(group => group.documentIds), [['a', 'b'], ['c', 'd']]);
});

test('split divider positions remain finite and within keyboard/pointer resize limits', () => {
  for (const [value, expected] of [[0, 0.25], [0.25, 0.25], [0.5, 0.5], [0.6, 0.6], [0.75, 0.75], [1, 0.75]]) {
    assert.equal(splitRatio(value), expected);
  }
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => splitRatio(value), /finite/);
});
