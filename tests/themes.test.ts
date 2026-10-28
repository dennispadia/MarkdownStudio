import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTheme, restoreTheme, themes } from '../lib/themes.js';

test('only Light and GitHub-based Dark are offered, and old preferences migrate', () => {
  assert.deepEqual(themes.map(theme => [theme.id, theme.label]), [['light', 'Light'], ['dark', 'Dark']]);
  for (const theme of themes) assert.equal(isTheme(theme.id), true);
  for (const value of [null, undefined, '', 'system', 'GitHub Dark', 'github-dark', {}, 1]) assert.equal(isTheme(value), false);
  assert.equal(themes.find(theme => theme.id === 'dark')?.background, '#0d1117');
  assert.equal(restoreTheme('light'), 'light');
  assert.equal(restoreTheme('dark'), 'dark');
  assert.equal(restoreTheme('github-dark'), 'dark');
  for (const value of [null, undefined, 'system', {}, 1]) assert.equal(restoreTheme(value), null);
});
