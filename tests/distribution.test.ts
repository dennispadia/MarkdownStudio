import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configurePerUserMsi } = require('../scripts/configure-msi.cjs') as { configurePerUserMsi: (xml: string) => string };

test('MSI manifest is per-user, non-elevated, and rooted in local application data', () => {
  const original = '<Package Compressed="yes" InstallerVersion="500"/>\n<Property Id="ALLUSERS" Secure="yes" Value="2"/>\n<Directory Id="ProgramFiles64Folder"><Directory Id="APPLICATIONFOLDER"/></Directory>';
  const actual = configurePerUserMsi(original);
  assert.match(actual, /InstallScope="perUser"/);
  assert.match(actual, /Directory Id="LocalAppDataFolder"/);
  assert.doesNotMatch(actual, /ALLUSERS|ProgramFiles64Folder/);
  assert.match(actual, /Directory Id="APPLICATIONFOLDER"/);
  assert.throws(() => configurePerUserMsi('changed builder template'), /Unexpected MSI template/);
  assert.throws(() => configurePerUserMsi(original + original), /exactly one/);
});

test('distribution uses the public npm registry and ships notices without developer files', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.build.msi.perMachine, false);
  assert.equal(manifest.build.msi.runAfterFinish, false);
  assert.equal(manifest.build.msi.createDesktopShortcut, true);
  assert.equal(manifest.build.msi.createStartMenuShortcut, true);
  assert.equal(manifest.build.msiProjectCreated, 'scripts\\configure-msi.cjs');
  for (const item of Object.values(lock.packages) as Array<{ resolved?: string }>) {
    if (item.resolved) assert.equal(new URL(item.resolved).origin, 'https://registry.npmjs.org');
  }
  assert.equal(lock.packages[''].engines.node, manifest.engines.node);
  for (const name of ['LICENSE', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(manifest.build.extraFiles.some((file: { from: string }) => file.from === name));
  }
  for (const name of ['node_modules/', '.tools/', 'release/', 'dist/', 'build/', '.npmrc', '.env']) {
    assert.ok((await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).split(/\r?\n/).includes(name));
  }
});
