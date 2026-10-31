import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offline grammar permits local WASM without enabling JavaScript eval or network connections', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(html, /'unsafe-eval'/);
  assert.match(html, /worker-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(vite, /worker:\s*\{\s*format:\s*'es'/);
});

test('grammar dependency and bundled runtime notices are explicitly delivered', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies['harper.js'], '2.13.0');
  for (const file of ['Harper-LICENSE.txt', 'fflate-LICENSE.txt', 'Harper-THIRD-PARTY-NOTICES.txt']) {
    assert.ok(manifest.build.extraFiles.some((entry: { to: string }) => entry.to === `licenses/${file}`));
  }
  const source = await readFile(new URL('../scripts/Export-Source.ps1', import.meta.url), 'utf8');
  assert.ok(source.includes('Harper-THIRD-PARTY-NOTICES.txt'));
  const notices = await readFile(new URL('../licenses/Harper-THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8');
  assert.match(notices, /MPL-2\.0/);
  assert.match(notices, /Unicode/);
  assert.match(notices, /https:\/\/static\.crates\.io/);
});
