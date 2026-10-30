import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productName, productTitle, userDataDirectory } from '../lib/branding.js';
import { TOC_START, TOC_END } from '../lib/contents.js';
import { toDocx, toPrintHTML } from '../lib/export.js';
import { unzipEntries } from './zip.js';

test('branding changes display names without changing existing profile or document identities', async () => {
  assert.equal(productName, 'Lekh');
  assert.equal(productTitle, 'Lekh: Markdown editor');
  assert.equal(userDataDirectory, 'Markdown Studio');
  assert.equal(TOC_START, '<!-- markdown-studio:toc -->');
  assert.equal(TOC_END, '<!-- /markdown-studio:toc -->');
  const native = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.ok(native.includes("app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), userDataDirectory)"));
  assert.ok(native.includes("app.setPath('userData', profilePath)"));
  assert.ok(native.includes("app.setPath('sessionData', profilePath)"));
  assert.ok(native.indexOf("app.setPath('sessionData', profilePath)") < native.indexOf('app.requestSingleInstanceLock()'));
  assert.ok(native.includes("partition: 'markdown-studio-diagrams'"));
  const renderer = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  for (const key of ['draft-v1', 'theme', 'sidebar-hidden', 'sidebar-width', 'recent-expanded']) {
    assert.ok(renderer.includes(`'markdown-studio-${key}'`), `Existing ${key} storage identity is preserved`);
  }
});

test('print exports identify Lekh without changing document contents', async () => {
  const html = await toPrintHTML('# Kept heading\n\nKept **formatting**.', null);
  assert.match(html, /<title>Lekh export<\/title>/);
  assert.match(html, /Kept heading/);
  assert.match(html, /<strong>formatting<\/strong>/);
  const docx = unzipEntries(await toDocx('# Kept heading', async () => { throw new Error('Unexpected image in branding fixture.'); }));
  assert.match(docx.get('docProps/core.xml')!.toString(), /<dc:creator>Lekh<\/dc:creator>/);
  assert.match(docx.get('word/document.xml')!.toString(), /Kept heading/);
});
