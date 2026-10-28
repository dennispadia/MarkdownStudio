import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configurePerUserMsi } = require('../scripts/configure-msi.cjs') as { configurePerUserMsi: (xml: string) => string };

const original = `<Product UpgradeCode="E2FD477D-ED35-561D-8A35-B75851090FE9">
<Package Compressed="yes" InstallerVersion="500"/>
<Property Id="ALLUSERS" Secure="yes" Value="2"/>
<Directory Id="ProgramFiles64Folder"><Directory Id="APPLICATIONFOLDER"/></Directory>
<ComponentGroup Directory="APPLICATIONFOLDER">
<Component><File Source="$(var.appDir)\\app.exe" KeyPath="yes" Id="mainExecutable">
<Shortcut Id="desktopShortcut" Directory="DesktopFolder" Advertise="yes"/>
<Shortcut Id="startMenuShortcut" Directory="ProgramMenuFolder" Advertise="yes"><ShortcutProperty Key="System.AppUserModel.ID" Value="com.markdownstudio.desktop"/></Shortcut>
</File></Component>
<Component><File Source="$(var.appDir)\\LICENSE.md" KeyPath="yes"/></Component>
<Component Directory="resources"><File Source="$(var.appDir)\\resources\\app.asar" KeyPath="yes"/></Component>
</ComponentGroup></Product>`;

test('MSI manifest is per-user, non-elevated, and rooted in local application data', () => {
  const actual = configurePerUserMsi(original);
  assert.match(actual, /InstallScope="perUser"/);
  assert.match(actual, /Directory Id="LocalAppDataFolder"/);
  assert.doesNotMatch(actual, /ALLUSERS|ProgramFiles64Folder/);
  assert.match(actual, /Directory Id="APPLICATIONFOLDER"/);
  assert.throws(() => configurePerUserMsi('changed builder template'), /Unexpected MSI template/);
  assert.throws(() => configurePerUserMsi(original + original), /exactly one/);
});

test('per-user components use stable HKCU key paths, folder cleanup and direct shortcuts', () => {
  const actual = configurePerUserMsi(original);
  assert.equal((actual.match(/<RegistryValue Root="HKCU"[^>]+KeyPath="yes"/g) ?? []).length, 3);
  assert.equal((actual.match(/<File[^>]+KeyPath="no"/g) ?? []).length, 3);
  const guids = actual.match(/Guid="[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}"/g) ?? [];
  assert.equal(guids.length, 3);
  assert.equal(new Set(guids).size, 3);
  assert.equal((actual.match(/<RemoveFolder /g) ?? []).length, 2);
  assert.match(actual, /Directory="APPLICATIONFOLDER" On="uninstall"/);
  assert.match(actual, /Directory="resources" On="uninstall"/);
  assert.equal((actual.match(/Advertise="no" Target="\[#mainExecutable\]"/g) ?? []).length, 2);
  assert.doesNotMatch(actual, /Advertise="yes"|<File[^>]*>[\s\S]*?<Shortcut[\s\S]*?<\/File>/);
  assert.match(actual, /ShortcutProperty Key="System.AppUserModel.ID" Value="com.markdownstudio.desktop"/);
  assert.equal(configurePerUserMsi(original), actual);
  const reordered = configurePerUserMsi(original.replace(
    '<Component><File Source="$(var.appDir)\\LICENSE.md" KeyPath="yes"/></Component>',
    '<Component><File Source="$(var.appDir)\\new.txt" KeyPath="yes"/></Component><Component><File Source="$(var.appDir)\\LICENSE.md" KeyPath="yes"/></Component>',
  ));
  for (const registry of actual.match(/<RegistryValue[^>]+\/>/g) ?? []) assert.ok(reordered.includes(registry));
  for (const guid of guids) assert.ok(reordered.includes(guid));
  const fork = configurePerUserMsi(original.replace('E2FD477D-ED35-561D-8A35-B75851090FE9', 'DB607F2E-1890-4740-9DA3-51B6EEDD16AE'));
  for (const guid of guids) assert.ok(!fork.includes(guid));
  assert.throws(() => configurePerUserMsi(original.replace('UpgradeCode=', 'Unknown=')), /upgrade identity/);
  assert.throws(() => configurePerUserMsi(original.replace('KeyPath="yes"', 'KeyPath="no"')), /keyed file/);
  assert.throws(() => configurePerUserMsi(original.replace('Advertise="yes"', 'Advertise="no"')), /advertised shortcut/);
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
