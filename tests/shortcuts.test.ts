import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formattingShortcuts } from '../lib/shortcuts.js';

test('formatting shortcuts are unique, discoverable, and do not conflict with sidebar or insert commands', () => {
  assert.deepEqual(formattingShortcuts.map(item => item.command), ['bold', 'italic', 'strike', 'code', 'bullet', 'ordered', 'task', 'quote']);
  assert.equal(new Set(formattingShortcuts.map(item => item.accelerator)).size, formattingShortcuts.length);
  assert.equal(new Set(formattingShortcuts.map(item => `${item.code}:${item.shift}`)).size, formattingShortcuts.length);
  for (const item of formattingShortcuts) {
    assert.ok(item.label);
    assert.match(item.accelerator, /^CmdOrCtrl\+(Shift\+)?[A-Z0-9]$/);
    assert.equal(item.accelerator.includes('+Shift+'), item.shift);
    assert.ok(!['CmdOrCtrl+Shift+B', 'CmdOrCtrl+K', 'CmdOrCtrl+Shift+K', 'CmdOrCtrl+T'].includes(item.accelerator));
  }
});
