import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publishingTemplateMarkdown, publishingTemplates } from '../lib/publishing-templates.js';

test('toolbar exposes every alert type and reusable authoring building block', () => {
  for (const kind of ['note', 'tip', 'important', 'caution', 'warning']) {
    assert.ok(publishingTemplates.some(item => item.id === `callout-${kind}`));
    assert.match(publishingTemplateMarkdown(`callout-${kind}`)!, new RegExp(`> \\[!${kind.toUpperCase()}\\]`));
  }
  for (const kind of ['tabs', 'selector', 'steps', 'image', 'metadata', 'include']) {
    assert.ok(publishingTemplates.some(item => item.id === `publishing-${kind}`));
  }
});

test('formatting selected text retains Markdown, code and literal replacement characters', () => {
  const selected = '**Keep this** and $& $1.\n\n```text\nretain <tags>\n```';
  const callout = publishingTemplateMarkdown('callout-note', selected)!;
  assert.equal(callout.split('\n').slice(1).map(line => line.slice(2)).join('\n'), selected);
  assert.ok(publishingTemplateMarkdown('publishing-tabs', selected)!.includes(selected));
  assert.ok(publishingTemplateMarkdown('publishing-selector', selected)!.includes(selected));
  assert.ok(publishingTemplateMarkdown('publishing-steps', selected)!.includes(selected));
  assert.equal(publishingTemplateMarkdown('unknown'), undefined);
});

test('local include access is document-scoped, explicitly granted and revocable', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(source, /handle\('publishing:allow-includes'/);
  assert.match(source, /properties: \['openDirectory'\]/);
  assert.match(source, /publishingRoots\.set\(String\(id\), root\)/);
  assert.match(source, /handle\('publishing:revoke-includes'/);
  assert.match(source, /publishingRoots\.delete\(String\(id\)\)/);
  assert.match(source, /preparePublishing\(content, currentPath, publishingRoots\.get\(String\(id\)\) \?\? null\)/);
});
