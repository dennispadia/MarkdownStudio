import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SEARCH_MATCHES, replaceSearchMatches, searchMarkdown } from '../lib/search.js';

const literal = { caseSensitive: true, wholeWord: false, regex: false };
test('search preserves literal defaults and supports Unicode whole words and case options', () => {
  assert.equal(searchMarkdown('Cat cat scatter cat_ 猫猫 猫', 'cat', literal).matches.length, 3);
  assert.equal(searchMarkdown('Cat cat scatter cat_', 'cat', { ...literal, wholeWord: true, caseSensitive: false }).matches.length, 2);
  assert.equal(searchMarkdown('猫猫 猫', '猫', { ...literal, wholeWord: true }).matches.length, 1);
  assert.equal(searchMarkdown('a.b axb', 'a.b', literal).matches.length, 1);
});
test('regex groups, zero-length results and replacement special characters work', () => {
  const text = 'one 12 two 34';
  const result = searchMarkdown(text, '(\\d)(\\d)', { ...literal, regex: true }, '$2$1 $$ $&');
  assert.equal(replaceSearchMatches(text, result.matches), 'one 21 $ 12 two 43 $ 34');
  const zero = searchMarkdown('ab', '(?=.)', { ...literal, regex: true }, '-');
  assert.equal(replaceSearchMatches('ab', zero.matches), '-a-b');
  assert.equal(replaceSearchMatches('a', searchMarkdown('a', 'a', literal, '$1').matches), '$1');
  assert.throws(() => searchMarkdown('a', '[', { ...literal, regex: true }), /Invalid regular expression/);
});
test('excessive matches and replacement size are explicit, not partial replace-all', () => {
  const result = searchMarkdown('a'.repeat(MAX_SEARCH_MATCHES + 1), 'a', literal);
  assert.equal(result.matches.length, MAX_SEARCH_MATCHES);
  assert.equal(result.truncated, true);
  assert.throws(() => replaceSearchMatches('a', [{ from: 0, to: 1, replacement: 'x'.repeat(10 * 1024 * 1024 + 1) }]), /10 MB/);
});
