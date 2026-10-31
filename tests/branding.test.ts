import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { productName, productTitle, userDataDirectory } from '../lib/branding.js';
import { TOC_START, TOC_END } from '../lib/contents.js';
import { toDocx, toPrintHTML } from '../lib/export.js';
import { unzipEntries } from './zip.js';

test('Lekh has independent application, profile, document, and renderer identities', async () => {
  assert.equal(productName, 'Lekh');
  assert.equal(productTitle, 'Lekh: Markdown editor');
  assert.equal(userDataDirectory, 'Lekh');
  assert.equal(TOC_START, '<!-- lekh:toc -->');
  assert.equal(TOC_END, '<!-- /lekh:toc -->');
  const native = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.ok(native.includes("app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), userDataDirectory)"));
  assert.ok(native.includes("app.setPath('userData', profilePath)"));
  assert.ok(native.includes("app.setPath('sessionData', profilePath)"));
  assert.ok(native.indexOf("app.setPath('sessionData', profilePath)") < native.indexOf('app.requestSingleInstanceLock()'));
  assert.ok(native.includes("app.setAppUserModelId('com.lekh.desktop')"));
  assert.ok(native.includes("partition: 'lekh-diagrams'"));
  assert.ok(native.includes("scheme: 'lekh-image'"));
  assert.ok(native.includes('window.lekhRenderDiagram'));
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.ok(preload.includes("contextBridge.exposeInMainWorld('lekh',"));
  const bridge = await readFile(new URL('../src/bridge.ts', import.meta.url), 'utf8');
  assert.ok(bridge.includes('interface Window { lekh: LekhAPI }'));
  const renderer = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  for (const key of ['draft-v1', 'theme', 'sidebar-hidden', 'sidebar-width', 'recent-expanded']) {
    assert.ok(renderer.includes(`'lekh-${key}'`), `Fresh ${key} storage identity`);
  }
});

test('all current tracked text and paths are free of retired product names and aliases', async t => {
  const root = new URL('../', import.meta.url);
  let paths: string[];
  try {
    paths = execFileSync('git', ['ls-files', '-z'], {
      cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean);
  } catch {
    t.skip('Tracked-file audit requires a Git checkout; source archives have no Git inventory.');
    return;
  }
  const retiredName = new RegExp(['mark', 'down'].join('') + '[\\s_-]*' + ['stu', 'dio'].join(''), 'i');
  const retiredAlias = new RegExp('\\b' + ['stu', 'dio'].join('') + '(?:API|RenderDiagram|Contents|_|-|\\b)', 'i');
  const failures: string[] = [];
  for (const relativePath of paths) {
    if (retiredName.test(relativePath)) failures.push(`${relativePath}: path`);
    let bytes: Buffer;
    try {
      bytes = await readFile(new URL(relativePath, root));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; // Tracked deletion in a working tree.
      throw error;
    }
    if (/\.(?:png|ico)$/i.test(relativePath)) continue;
    const text = bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
    if (retiredName.test(text) || retiredAlias.test(text)) failures.push(`${relativePath}: text`);
  }
  assert.deepEqual(failures, [], 'Audit every tracked code, document, script, config, license, and text asset');
});

test('installer identity is consistently pinned for future Lekh upgrades without other-product aliases', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const upgradeCode = 'DCBCF7FA-11DA-4F35-8D27-D066EEC6C582';
  assert.equal(manifest.build.msi.upgradeCode, upgradeCode);
  for (const file of ['installer/Engine.cs', 'scripts/Test-Msi.ps1', 'scripts/Test-Setup.ps1',
    'README.md', 'CONTRIBUTING.md', 'docs/BUILDING.md', 'docs/PUBLISHING.md']) {
    assert.ok((await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).includes(upgradeCode), file);
  }
  const engine = await readFile(new URL('../installer/Engine.cs', import.meta.url), 'utf8');
  const detection = engine.slice(engine.indexOf('public static bool IsInstalledApp'), engine.indexOf('public static bool AppIsOpen'));
  assert.ok(detection.includes('String.Equals(full, AppPath, StringComparison.OrdinalIgnoreCase)'));
  assert.doesNotMatch(detection, /\blegacy\b|\|\|/i);
  assert.ok(engine.includes('Process.GetProcessesByName(Path.GetFileNameWithoutExtension(BuildInfo.ExecutableName))'));
  const verify = await readFile(new URL('../scripts/Test-Setup.ps1', import.meta.url), 'utf8');
  assert.ok(verify.includes("Join-Path $env:LOCALAPPDATA 'lekh'"));
  assert.ok(verify.includes("Join-Path $env:APPDATA 'Lekh'"));
});

test('support invites issues without response guarantees and preserves MIT warranty terms', async () => {
  for (const file of ['SUPPORT.md', 'CONTRIBUTING.md', 'README.md', 'docs/USER_GUIDE.md', '.github/workflows/publish-release.yml']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes('https://github.com/dennispadia/lekh/issues'), file);
    assert.match(text, /bugs?|enhancements?|requests?/i, file);
    assert.match(text, /not guaranteed|no guaranteed/i, file);
    assert.doesNotMatch(text, /without support|AI coding assistant|upstream contributions.*not|fork.*instead/i, file);
  }
  const publishing = await readFile(new URL('../docs/PUBLISHING.md', import.meta.url), 'utf8');
  assert.ok(publishing.includes('Issues enabled'));
  assert.doesNotMatch(publishing, /disable Issues|no-support/i);
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Lekh contributors/);
  assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'));
  assert.ok(license.includes('The above copyright notice and this permission notice shall be included in all'));
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
