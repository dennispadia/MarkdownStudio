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
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(manifest.name, 'markdown-studio');
  assert.equal(manifest.build.appId, 'com.markdownstudio.desktop');
  assert.equal(manifest.build.productName, 'Lekh - Markdown editor');
  assert.equal(manifest.build.msi.shortcutName, 'Lekh');
  assert.equal(manifest.build.msi.upgradeCode, 'E2FD477D-ED35-561D-8A35-B75851090FE9');
  assert.equal(manifest.build.msi.artifactName, 'Lekh-Markdown-editor-${version}-${arch}.${ext}');
  assert.equal(manifest.build.msi.perMachine, false);
  assert.equal(manifest.build.msi.runAfterFinish, false);
  assert.equal(manifest.build.msi.createDesktopShortcut, true);
  assert.equal(manifest.build.msi.createStartMenuShortcut, true);
  assert.equal(manifest.build.msiProjectCreated, 'scripts\\configure-msi.cjs');
  for (const item of Object.values(lock.packages) as Array<{ resolved?: string }>) {
    if (item.resolved) assert.equal(new URL(item.resolved).origin, 'https://registry.npmjs.org');
  }
  assert.equal(lock.packages[''].engines.node, manifest.engines.node);
  const workflow = await readFile(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8');
  assert.match(workflow, /defaults:\s+run:\s+shell: powershell/);
  assert.match(workflow, /name: lekh-windows-x64/);
  const publisher = await readFile(new URL('../.github/workflows/publish-release.yml', import.meta.url), 'utf8');
  assert.ok(publisher.includes("a.name === 'lekh-windows-x64'"));
  assert.ok(publisher.includes('`Lekh-Markdown-editor-Setup-${version}-x64.exe`'));
  assert.ok(!publisher.includes('`Lekh-Markdown-editor-${version}-x64.msi`'));
  assert.ok(publisher.includes('`Lekh-${version}-source.zip`'));
  assert.ok(publisher.includes('asset.name !== name'));
  assert.doesNotMatch(manifest.build.msi.artifactName, /\s/, 'GitHub preserves release filenames without whitespace normalization');
  const sourcePackager = await readFile(new URL('../scripts/Export-Source.ps1', import.meta.url), 'utf8');
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(sourcePackager, /'diagram-export\.html'/);
  assert.ok(sourcePackager.includes('"Lekh-$($manifest.version)-source.zip"'));
  assert.ok(sourcePackager.includes("'lekh/'"));
  assert.match(vite, /diagramExport:\s*'diagram-export\.html'/);
  for (const name of ['LICENSE', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(manifest.build.extraFiles.some((file: { from: string }) => file.from === name));
  }
  for (const name of ['node_modules/', '.tools/', 'release/', 'dist/', 'build/', '.npmrc', '.env']) {
    assert.ok((await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).split(/\r?\n/).includes(name));
  }
});

test('public release contains only verified offline setup, source and checksums; MSI stays internal', async () => {
  const [workflow, publisher, checksums, exporter, packageText] = await Promise.all([
    readFile(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/publish-release.yml', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/Write-Checksums.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/Export-Source.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(packageText);
  assert.equal(manifest.scripts['build:setup'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\Build-Setup.ps1');
  assert.equal(manifest.scripts['verify:setup'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\Test-Setup.ps1');
  const stages = ['package:msi', 'verify:msi', 'build:setup', 'verify:setup', 'package:source', 'release:checksums'];
  let previous = -1;
  for (const stage of stages) {
    const position = workflow.indexOf(`run: npm run ${stage}`);
    assert.ok(position > previous, `${stage} must follow validation of its inputs`);
    previous = position;
  }
  const upload = workflow.slice(workflow.indexOf('      - name: Upload reviewed-download candidates'));
  assert.ok(upload.includes('release/Lekh-Markdown-editor-Setup-${{ steps.release.outputs.version }}-x64.exe'));
  assert.ok(upload.includes('release/Lekh-${{ steps.release.outputs.version }}-source.zip'));
  assert.ok(upload.includes('release/SHA256SUMS.txt'));
  assert.doesNotMatch(upload, /\.msi|\*/, 'internal MSI and stale version artifacts must not be uploaded');
  assert.ok(checksums.includes('"Lekh-Markdown-editor-Setup-$($manifest.version)-x64.exe"'));
  assert.ok(checksums.includes('"Lekh-$($manifest.version)-source.zip"'));
  assert.doesNotMatch(checksums, /\.msi/);
  assert.match(exporter, /\$folders = @\([^\r\n]*'installer'/);
  for (const extension of ['.cs', '.xaml', '.manifest']) assert.ok(exporter.includes(`'${extension}'`));
  assert.ok(publisher.includes('artifact.digest !== `sha256:'));
  assert.ok(publisher.includes("if (release && !release.draft) throw"));
  assert.ok(publisher.includes('Existing asset differs:'));
  assert.ok(publisher.includes("JSON.stringify(entries) !== JSON.stringify([...names].sort())"));
  assert.ok(publisher.includes('checked.size !== 2'));
  assert.ok(publisher.includes('asset.digest !== `sha256:'));
  assert.ok(publisher.indexOf('Uploaded asset verification failed:') < publisher.indexOf('draft: false'));
  assert.ok(publisher.includes('fresh per-user install/uninstall on a GitHub-hosted Windows runner'));
  assert.ok(publisher.includes('Genuine old-version upgrade and repair have not yet been verified.'));
});

test('native setup compilation embeds the exact offline payload and generates explicit build identity', async () => {
  const build = await readFile(new URL('../scripts/Build-Setup.ps1', import.meta.url), 'utf8');
  for (const option of ['/target:winexe', '/platform:x64', '/warnaserror+', '/win32manifest:', '/win32icon:']) {
    assert.ok(build.includes(option), `native build requires ${option}`);
  }
  assert.ok(build.includes('Microsoft.NET\\Framework64\\v4.0.30319'));
  for (const source of ['Engine.cs', 'Story.cs', 'EngineTests.cs', 'Setup.cs']) assert.ok(build.includes(`'${source}'`));
  for (const resource of ['Setup.Window.xaml', 'Setup.Logo.png', 'Setup.Payload.msi']) assert.ok(build.includes(resource));
  for (const reference of ['System.dll', 'System.Core.dll', 'System.Xaml.dll', 'WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll']) {
    assert.ok(build.includes(reference));
  }
  for (const constant of ['Version', 'PayloadHash', 'ProductName', 'ExecutableName', 'InstallDirectory']) {
    assert.match(build, new RegExp(`\\b${constant} = `));
  }
  assert.ok(build.includes('namespace Lekh.Setup'));
  assert.ok(build.includes('internal const string'));
  assert.ok(build.includes('[IO.File]::WriteAllText'));
  assert.ok(build.includes('[Text.UTF8Encoding]::new($false)'));
  assert.ok(build.includes('-Algorithm SHA256).Hash.ToLowerInvariant()'));
  assert.doesNotMatch(build, /npm (?:ci|install)|Invoke-WebRequest|DownloadFile/);
});

test('setup verification is non-destructive by default and exercises native accessible previews', async () => {
  const verify = await readFile(new URL('../scripts/Test-Setup.ps1', import.meta.url), 'utf8');
  assert.ok(verify.includes("@('--self-test', '--verify-payload')"));
  assert.ok(verify.includes('-ArgumentList $argument -PassThru -Wait'));
  for (const state of ['ready', 'open', 'preparing', 'installing', 'finishing', 'success', 'restart', 'error', 'stopping', 'cancelled']) {
    assert.ok(verify.includes(`'${state}'`));
  }
  for (const id of ['Primary', 'Heading', 'StoryPrevious', 'StoryNext', 'StoryPause', 'StoryCount', 'StoryTitle', 'StoryWritten']) {
    assert.ok(verify.includes(`'${id}'`));
  }
  assert.ok(verify.includes('[Windows.Automation.TreeWalker]::RawViewWalker'));
  assert.ok(verify.includes("Find-Control $Window 'StoryWritten' -Raw"));
  assert.ok(verify.includes("(Find-Control $Window 'StoryTitle').Current.Name.Trim()"));
  assert.doesNotMatch(verify, /StoryAccessible/, 'hidden layout copy is not a discoverable accessibility contract');
  assert.ok(verify.includes('[Windows.Automation.TextPattern]::Pattern'));
  assert.ok(verify.includes('[Windows.Automation.ValuePattern]::Pattern'));
  assert.ok(verify.includes('[Windows.Automation.WindowPattern]::Pattern'));
  assert.ok(verify.includes('$pattern.Close()'));
  assert.ok(verify.includes('Stop-Process -Id $preview.Id'));
  assert.ok(verify.includes('foreach ($page in @(1, 2, 3))'));
  assert.ok(verify.includes('progressive, genuinely typed story text'));
  assert.ok(verify.includes('$growth -ge 2'));
  assert.doesNotMatch(verify, /Remove-Item|Stop-Process -Name|Get-Process/);
  const defaultVerification = verify.slice(0, verify.indexOf('function Test-HostedInstallation'));
  assert.doesNotMatch(defaultVerification, /msiexec|\.Invoke\(\)/, 'default previews must not install or launch the app');
});

test('real setup installation is explicitly opted in on a clean hosted runner and precisely cleaned up', async () => {
  const [verify, workflow] = await Promise.all([
    readFile(new URL('../scripts/Test-Setup.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8'),
  ]);
  assert.ok(verify.startsWith('param([string]$SetupPath, [switch]$InstallOnHostedRunner)'));
  assert.ok(verify.includes("if ($InstallOnHostedRunner -and ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted'))"));
  const hosted = verify.slice(verify.indexOf('function Test-HostedInstallation'));
  assert.ok(hosted.includes("if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted')"));
  assert.ok(hosted.includes("Read-MsiProperty $database 'ProductCode'"));
  assert.ok(hosted.includes('refusing to replace or uninstall an existing application'));
  assert.ok(hosted.includes('[Windows.Automation.InvokePattern]::Pattern'));
  assert.ok(hosted.includes('$invoke.Invoke()'));
  assert.ok(hosted.includes("You're ready to write."));
  assert.ok(hosted.includes("'Lekh - Markdown editor.exe'"));
  assert.ok(hosted.includes('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$productCode'));
  assert.ok(hosted.includes("Join-Path $env:APPDATA 'Markdown Studio'"));
  assert.ok(hosted.includes("'/x', $productCode, '/qn', '/norestart'"));
  assert.ok(hosted.includes('if ($attempted -and $setupExited)'));
  assert.ok(hosted.includes('user profile sentinel preserved'));
  assert.ok(hosted.includes('if ($InstallOnHostedRunner) {\n    Test-HostedInstallation') ||
    hosted.includes('if ($InstallOnHostedRunner) {\r\n    Test-HostedInstallation'));
  assert.ok(workflow.includes('run: npm run verify:setup -- -InstallOnHostedRunner'));
});
