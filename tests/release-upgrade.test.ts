import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../scripts/Test-Upgrade.ps1', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const script = (await readFile(scriptUrl, 'utf8')).replace(/\r\n/g, '\n');
const workflow = (await readFile(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const nativeSource = /\$nativeSource = @'\r?\n([\s\S]*?)\r?\n'@/.exec(script)?.[1];

function inOrder(text: string, ...fragments: string[]) {
  let previous = -1;
  for (const fragment of fragments) {
    const position = text.indexOf(fragment, previous + 1);
    assert.ok(position > previous, `Expected ordered fragment: ${fragment}`);
    previous = position;
  }
}

test('real upgrade operations require explicit consent and both exact hosted-runner markers', () => {
  assert.match(script, /^param\(\[string\]\$SetupPath, \[switch\]\$InstallOnHostedRunner\)/);
  assert.ok(script.includes("if (-not $InstallOnHostedRunner -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted')"));
  inOrder(script, 'function Assert-HostedRunner', '\nAssert-HostedRunner\n', '$manifest =', 'New-Item -ItemType Directory -Path $sources');
  const operation = script.slice(script.indexOf('function Invoke-UpgradeMsi'), script.indexOf('\nNew-Item -ItemType Directory -Path $sources'));
  inOrder(operation, 'Assert-HostedRunner', '-not $cleanRunnerVerified', '-not $ownedProducts.ContainsKey($Product.ProductCode)', 'Assert-AppNotRunning', 'Start-Process');
  assert.ok(operation.includes('ExplicitOptIn = $InstallOnHostedRunner.IsPresent'));
  assert.ok(operation.includes('CleanRunnerVerified = $cleanRunnerVerified'));
  assert.ok(operation.includes("-not `$request.ExplicitOptIn -or -not `$request.CleanRunnerVerified"));
  assert.ok(operation.includes("`$env:GITHUB_ACTIONS -cne 'true' -or `$env:RUNNER_ENVIRONMENT -cne 'github-hosted'"));
  assert.doesNotMatch(script, /-Verb\s+RunAs|UACONLY\s*[,)]|AlwaysInstallElevated|DisableMSI|SuppressIces|SuppressValidation|taskkill|Stop-Process\s+-Name/i);
});

test('the only old installer is the immutable public 0.8.0 asset, verified before extraction', () => {
  assert.ok(script.includes("$oldSetupUrl = 'https://github.com/dennispadia/lekh/releases/download/v0.8.0/Lekh-Markdown-editor-Setup-0.8.0-x64.exe'"));
  assert.ok(script.includes("$oldSetupHash = '7e1b42622526fdfaa5aecb64d7394254a96f56469151396f019e18a1af3369fd'"));
  assert.ok(script.includes('$oldSetupBytes = 197504000L'));
  assert.ok(script.includes("$manifest.version -cne '0.8.1'"));
  const execution = script.slice(script.indexOf("\n    Write-Host 'Scope:"));
  inOrder(execution,
    'Invoke-WebRequest -UseBasicParsing -Uri $oldSetupUrl -OutFile $oldSetup -TimeoutSec 180 -UseDefaultCredentials:$false',
    '(Get-Item -LiteralPath $oldSetup).Length -ne $oldSetupBytes',
    '(Get-FileHash -LiteralPath $oldSetup -Algorithm SHA256).Hash.ToLowerInvariant() -cne $oldSetupHash',
    'Expand-EmbeddedMsi $oldSetup $oldMsi',
    'Expand-EmbeddedMsi $SetupPath $newMsi');
  assert.doesNotMatch(script, /GITHUB_TOKEN|GH_TOKEN|Authorization|UseDefaultCredentials:\$true|-Credential\b|SkipCertificateCheck/i);
  assert.ok(script.includes('[Reflection.Assembly]::LoadFile($Setup)'));
  assert.ok(script.includes("$assembly.GetManifestResourceStream('Setup.Payload.msi')"));
  assert.doesNotMatch(script, /EntryPoint\.Invoke|Start-Process -FilePath \$(?:oldSetup|SetupPath)/);
});

test('both embedded MSIs are validated for distinct identity, version and non-elevated per-user scope', () => {
  const validation = script.slice(script.indexOf('function Read-ValidatedMsi'), script.indexOf('function Test-Registration'));
  for (const field of ['ProductCode', 'ProductName', 'UpgradeCode', 'ProductVersion', 'MSIINSTALLPERUSER']) {
    assert.ok(validation.includes(`$properties.${field}`), `Missing ${field} validation`);
  }
  assert.ok(script.includes("$upgradeCode = '{DCBCF7FA-11DA-4F35-8D27-D066EEC6C582}'"));
  for (const guard of [
    "$properties.ContainsKey('ALLUSERS')",
    "$properties.ContainsKey('ARPSYSTEMCOMPONENT')",
    '([int]$summary.Property(15) -band 8) -eq 0',
    "$summary.Property(7) -notmatch '^x64;'",
    "'LocalAppDataFolder'",
    "-cne 'lekh'",
    'SELECT `UpgradeCode` FROM `Upgrade`',
    "$_[0] -ine $upgradeCode",
  ]) assert.ok(validation.includes(guard), `Missing package guard: ${guard}`);
  const execution = script.slice(script.indexOf("\n    Write-Host 'Scope:"));
  inOrder(execution, "Read-ValidatedMsi $oldMsi '0.8.0'", 'Read-ValidatedMsi $newMsi $manifest.version',
    '$old.ProductCode -ieq $new.ProductCode',
    '$newMsiHash = (Get-FileHash -LiteralPath $newMsi -Algorithm SHA256).Hash',
    '$newMsiHash -cne',
    'Assert-Absent $product.ProductCode',
    '[UpgradeVerificationInstaller]::RelatedProducts($upgradeCode)',
    'Assert-CleanApplicationDirectory $installDirectory $newMsiHash $manifest.version',
    '$cleanRunnerVerified = $true',
    "[void]$attemptedProducts.Add($old.ProductCode)");
});

test('registration checks distinguish absence from native errors and check all owned contexts', () => {
  assert.ok(nativeSource);
  assert.ok(nativeSource.includes('if (result == 259) return products.ToArray();'));
  assert.ok(nativeSource.includes('if (result != 0) throw new Win32Exception((int)result'));
  assert.ok(nativeSource.includes('MsiGetProductInfoExW(productCode, null, context, property, null, ref length)'));
  assert.ok(nativeSource.includes('MsiGetProductInfoExW(productCode, null, context, property, value, ref capacity)'));
  assert.ok(nativeSource.includes('if (result == 1605) return null;'));
  assert.ok(nativeSource.includes('if (result == 234) { length = capacity; continue; }'));
  assert.ok(nativeSource.includes('new StringBuilder(checked((int)length + 1))'));
  assert.ok(script.includes("ProductProperty($ProductCode, $Context, 'ProductName')"),
    'advertised products must block preflight and fail post-uninstall absence checks too');
  const absent = script.slice(script.indexOf('function Assert-Absent'), script.indexOf('function Assert-Installed'));
  assert.ok(absent.includes('foreach ($context in @(1, 2, 4))'));
  const installed = script.slice(script.indexOf('function Assert-Installed'), script.indexOf('function Assert-AppNotRunning'));
  assert.ok(installed.includes('foreach ($context in @(1, 4))'));
  for (const field of ['InstalledProductName', 'VersionString', 'LocalPackage']) {
    assert.ok(installed.includes(`ProductProperty($Product.ProductCode, 2, '${field}')`));
  }
  assert.ok(installed.includes('$related.Count -ne 1 -or $related[0] -ine $Product.ProductCode'));
});

test('the test upgrades a genuinely registered old product before real repair, without uninstalling old first', () => {
  const execution = script.slice(script.indexOf("\n    Write-Host 'Scope:"));
  inOrder(execution,
    "[IO.File]::WriteAllText($sentinel",
    "[IO.File]::WriteAllText($settings",
    "[void]$attemptedProducts.Add($old.ProductCode)",
    "Invoke-UpgradeMsi 'Install' $old 'old-install'",
    'Assert-Installed $old',
    'Assert-Absent $new.ProductCode',
    'Assert-ProfilePreserved',
    "[void]$attemptedProducts.Add($new.ProductCode)",
    "Invoke-UpgradeMsi 'Install' $new 'new-upgrade'",
    'Assert-Installed $new',
    'Assert-Absent $old.ProductCode',
    '$payloadHashes = Get-PayloadHashes',
    "'release\\win-unpacked'",
    'Assert-AppNotRunning',
    "Remove-Item -LiteralPath (Join-Path $installDirectory 'resources\\app.asar') -Force",
    "Invoke-UpgradeMsi 'Repair' $new 'new-repair'",
    '$repairedHashes = Get-PayloadHashes',
    '$repairedHashes.Count -ne $payloadHashes.Count',
    '$repairedHashes[$relative] -cne $payloadHashes[$relative]',
    'Assert-ProfilePreserved',
    '} finally {',
    "Invoke-UpgradeMsi 'Uninstall'");
  assert.ok(nativeSource?.includes('MsiInstallProductW(target, properties)'));
  assert.ok(nativeSource?.includes('MsiSetInternalUI(2, IntPtr.Zero)'));
  assert.ok(script.includes("@('/fomus', $Product.ProductCode, '/qn', '/norestart'"));
  assert.ok(script.includes('REBOOT=ReallySuppress MSIRESTARTMANAGERCONTROL=DisableShutdown'));
  assert.doesNotMatch(script, /MSIRMSHUTDOWN|MSIRESTARTMANAGERCONTROL=Disable(?:\s|['"])|Restart-Computer|\.exe['"]?\s+--/);
});

test('operations are bounded and cleanup cannot conceal the original failure or report false success', () => {
  assert.ok(script.includes('$process.WaitForExit(240000)'));
  assert.ok(script.includes('Stop-Process -Id $process.Id -Force -ErrorAction Stop'));
  assert.ok(script.includes('$process.WaitForExit(10000)'));
  assert.ok(script.includes('$process.ExitCode -notin @(0, 3010)'));
  assert.ok(script.includes("('build\\setup\\upgrade\\' + [guid]::NewGuid().ToString('N'))"));
  assert.doesNotMatch(script, /GetTempPath|Remove-Item -LiteralPath \$(?:sources|work|oldMsi|newMsi)\b/);
  const cleanup = script.slice(script.indexOf('    # Sources remain available'));
  inOrder(cleanup, 'Sort-Object Version -Descending', '$attemptedProducts.Contains($product.ProductCode)',
    "Invoke-UpgradeMsi 'Uninstall' $product", 'Assert-Absent $product.ProductCode',
    'Assert-ProfilePreserved', 'Stop-Transcript',
    'if ($null -ne $failure)', "$failure.Exception.Data['UpgradeCleanupErrors']", 'throw $failure',
    'if ($cleanupErrors.Count -gt 0) { throw', "Write-Host 'PASS: bounded genuine");
  assert.ok(nativeSource?.includes('MsiConfigureProductExW(target, 0, 2, properties)'),
    'uninstall must target the exact owned ProductCode, never a package path or a family-wide sweep');
  assert.ok(cleanup.includes('[UpgradeVerificationInstaller]::RelatedProducts($upgradeCode)'));
  assert.ok(cleanup.includes('Assert-CleanApplicationDirectory $installDirectory $newMsiHash $manifest.version'));
  assert.ok(cleanup.includes('Final installation absence check'));
});

test('clean-directory allowance is tied to the bootstrapper layout, not arbitrary pre-existing files', async () => {
  const [engine, setup, builder] = await Promise.all([
    readFile(new URL('../installer/Engine.cs', import.meta.url), 'utf8'),
    readFile(new URL('../installer/Setup.cs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/Build-Setup.ps1', import.meta.url), 'utf8'),
  ]);
  assert.ok(engine.includes('"Lekh", "SetupCache"'));
  assert.ok(engine.includes('Guid.NewGuid().ToString("N")'));
  assert.ok(engine.includes('Path.Combine(directory, "Lekh.msi")'));
  assert.ok(engine.includes('digest != BuildInfo.PayloadHash'));
  assert.ok(setup.includes('"Lekh", "SetupLogs", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")'));
  assert.ok(setup.includes('"setup.log"'));
  assert.ok(setup.includes('"windows-installer.log"'));
  assert.ok(setup.includes('Starting Lekh Setup " + BuildInfo.Version + ". Current-user, offline installation.'));
  assert.ok(setup.includes('if (package != null && (engine == null || !engine.Installed))'));
  assert.ok(builder.includes("PayloadHash = $hash"));
  const helper = script.slice(script.indexOf('function Assert-CleanApplicationDirectory'), script.indexOf('function Assert-ProfilePreserved'));
  assert.ok(helper.includes('[IO.FileAttributes]::ReparsePoint'));
  assert.ok(helper.includes('Get-ChildItem -LiteralPath $fullPath -Force'));
  assert.ok(helper.includes('Get-ChildItem -LiteralPath $entry.FullName -Force'));
  assert.ok(helper.includes('Get-ChildItem -LiteralPath $session.FullName -Force'));
  assert.ok(helper.includes('Get-FileHash -LiteralPath $files[0].FullName -Algorithm SHA256'));
  assert.doesNotMatch(helper, /Get-ChildItem[^\n]*-Recurse|Remove-Item|New-Item|Start-Process|Invoke-UpgradeMsi|UpgradeVerificationInstaller/);
});

test('directory guard accepts only empty roots or verified setup residue and rejects application, unknown and linked entries', {
  skip: process.platform !== 'win32',
}, async () => {
  const fixtureRoot = join(fileURLToPath(new URL('..', import.meta.url)), 'build', 'tests', `upgrade-directory-${randomUUID()}`);
  const cacheSession = '0123456789abcdef0123456789abcdef';
  const logSession = `20261031-020000-${cacheSession}`;
  const cacheBytes = Buffer.from('Directory guard fixture only. Not a Windows Installer package.');
  const expectedHash = createHash('sha256').update(cacheBytes).digest('hex');
  const fixtures: Array<{ name: string; path: string; error: string; hidden?: string }> = [];
  async function fixture(name: string, error = '') {
    const path = join(fixtureRoot, name, 'lekh');
    await mkdir(path, { recursive: true });
    const item: (typeof fixtures)[number] = { name, path, error };
    fixtures.push(item);
    return item;
  }
  async function cache(path: string) {
    const directory = join(path, 'SetupCache', cacheSession);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Lekh.msi'), cacheBytes);
    return directory;
  }
  async function logs(path: string) {
    const directory = join(path, 'SetupLogs', logSession);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'setup.log'), '2026-10-31T02:00:00.0000000+00:00 Starting Lekh Setup 0.8.1. Current-user, offline installation.\r\n');
    await writeFile(join(directory, 'windows-installer.log'), 'MSI fixture log; no installer was invoked.\r\n');
    return directory;
  }
  try {
    const missing = await fixture('missing');
    await rm(missing.path, { recursive: true });
    await fixture('empty-root');
    const empty = await fixture('empty-residue-roots');
    await mkdir(join(empty.path, 'SetupCache'));
    await mkdir(join(empty.path, 'SetupLogs'));
    const valid = await fixture('verified-cache-and-logs');
    await cache(valid.path);
    await logs(valid.path);
    const caseFolded = await fixture('case-insensitive-residue-names');
    const foldedCache = await cache(caseFolded.path);
    await rm(join(foldedCache, 'Lekh.msi'));
    await writeFile(join(foldedCache, 'LEKH.MSI'), cacheBytes);
    const cacheOnly = await fixture('verified-cache-only');
    await cache(cacheOnly.path);
    const logsOnly = await fixture('recognized-logs-only');
    await logs(logsOnly.path);

    const rootFile = await fixture('root-is-file', 'unexpected file/directory type');
    await rm(rootFile.path, { recursive: true });
    await writeFile(rootFile.path, 'not a directory');
    const executable = await fixture('application-executable', 'unexpected file/directory type');
    await writeFile(join(executable.path, 'Lekh - Markdown editor.exe'), 'Not an executable.');
    const unknown = await fixture('unknown-root-directory', 'unexpected root entry');
    await mkdir(join(unknown.path, 'resources'));
    const hidden = await fixture('hidden-root-file', 'unexpected file/directory type');
    hidden.hidden = join(hidden.path, 'unexpected-hidden-file');
    await writeFile(hidden.hidden, 'must not be ignored');
    const cacheFile = await fixture('cache-is-file', 'unexpected file/directory type');
    await writeFile(join(cacheFile.path, 'SetupCache'), 'not a directory');
    const logFile = await fixture('logs-is-file', 'unexpected file/directory type');
    await writeFile(join(logFile.path, 'SetupLogs'), 'not a directory');
    const unexpectedCache = await fixture('unknown-cache-session', 'unexpected setup cache layout');
    await mkdir(join(unexpectedCache.path, 'SetupCache', 'unknown'), { recursive: true });
    const emptyCache = await fixture('empty-cache-session', 'unexpected setup cache layout');
    await mkdir(join(emptyCache.path, 'SetupCache', cacheSession), { recursive: true });
    const extraCache = await fixture('extra-cache-file', 'unexpected setup cache layout');
    await writeFile(join(await cache(extraCache.path), 'unknown.dll'), 'Not a DLL.');
    const nestedCache = await fixture('nested-cache-directory', 'unexpected file/directory type');
    await mkdir(join(nestedCache.path, 'SetupCache', cacheSession, 'Lekh.msi'), { recursive: true });
    const corruptCache = await fixture('cache-hash-mismatch', 'setup cache checksum mismatch');
    await writeFile(join(await cache(corruptCache.path), 'Lekh.msi'), 'foreign or corrupted cache');
    const badLogSession = await fixture('unknown-log-session', 'unexpected setup log layout');
    await mkdir(join(badLogSession.path, 'SetupLogs', 'unknown'), { recursive: true });
    const emptyLogs = await fixture('empty-log-session', 'unexpected setup log layout');
    await mkdir(join(emptyLogs.path, 'SetupLogs', logSession), { recursive: true });
    const unknownLog = await fixture('unknown-log-file', 'unexpected setup log layout');
    await writeFile(join(await logs(unknownLog.path), 'unknown.exe'), 'Not an executable.');
    const renamedLog = await fixture('wrong-log-name', 'unexpected setup log file');
    const renamedLogs = await logs(renamedLog.path);
    await rm(join(renamedLogs, 'windows-installer.log'));
    await writeFile(join(renamedLogs, 'unknown.log'), 'not a setup log');
    const oldLog = await fixture('wrong-log-version', 'unrecognized setup log identity');
    await writeFile(join(await logs(oldLog.path), 'setup.log'), '2026-10-31T02:00:00.0000000+00:00 Starting Lekh Setup 0.8.0. Current-user, offline installation.\r\n');

    const target = await fixture('junction-target');
    await cache(target.path);
    await logs(target.path);
    const rootLink = await fixture('root-junction', 'reparse point');
    await rm(rootLink.path, { recursive: true });
    await symlink(target.path, rootLink.path, 'junction');
    const ancestorLink = await fixture('ancestor-junction', 'reparse point');
    await symlink(target.path, join(ancestorLink.path, 'linked-parent'), 'junction');
    ancestorLink.path = join(ancestorLink.path, 'linked-parent', 'missing-root');
    const cacheLink = await fixture('cache-root-junction', 'reparse point');
    await symlink(join(target.path, 'SetupCache'), join(cacheLink.path, 'SetupCache'), 'junction');
    const logLink = await fixture('log-root-junction', 'reparse point');
    await symlink(join(target.path, 'SetupLogs'), join(logLink.path, 'SetupLogs'), 'junction');
    const sessionLink = await fixture('cache-session-junction', 'reparse point');
    await mkdir(join(sessionLink.path, 'SetupCache'));
    await symlink(join(target.path, 'SetupCache', cacheSession), join(sessionLink.path, 'SetupCache', cacheSession), 'junction');
    const logSessionLink = await fixture('log-session-junction', 'reparse point');
    await mkdir(join(logSessionLink.path, 'SetupLogs'));
    await symlink(join(target.path, 'SetupLogs', logSession), join(logSessionLink.path, 'SetupLogs', logSession), 'junction');
    const cacheLeafLink = await fixture('cache-leaf-junction', 'reparse point');
    await mkdir(join(cacheLeafLink.path, 'SetupCache', cacheSession), { recursive: true });
    await symlink(target.path, join(cacheLeafLink.path, 'SetupCache', cacheSession, 'Lekh.msi'), 'junction');
    const logLeafLink = await fixture('log-leaf-junction', 'reparse point');
    const logLeafDirectory = await logs(logLeafLink.path);
    await rm(join(logLeafDirectory, 'windows-installer.log'));
    await symlink(target.path, join(logLeafDirectory, 'windows-installer.log'), 'junction');

    const command = `
      $ErrorActionPreference = 'Stop'
      $ProgressPreference = 'SilentlyContinue'
      Set-StrictMode -Version Latest
      Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1') -Force
      $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
      $tokens = $null; $errors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile($request.scriptPath, [ref]$tokens, [ref]$errors)
      if ($errors.Count -gt 0) { throw ($errors | Out-String) }
      $helper = $ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-CleanApplicationDirectory'
      }, $true)
      if ($null -eq $helper) { throw 'Directory guard definition not found.' }
      . ([scriptblock]::Create($helper.Extent.Text))
      foreach ($fixture in $request.fixtures) {
        if ($null -ne $fixture.PSObject.Properties['hidden']) {
          [IO.File]::SetAttributes($fixture.hidden, [IO.FileAttributes]::Hidden)
        }
        $failure = ''
        try { Assert-CleanApplicationDirectory $fixture.path $request.expectedHash '0.8.1' }
        catch { $failure = $_.Exception.Message }
        if ($fixture.error -eq '' -and $failure -ne '') { throw ($fixture.name + ': ' + $failure) }
        if ($fixture.error -ne '' -and $failure -notlike ('*' + $fixture.error + '*')) {
          throw ($fixture.name + ': expected refusal ' + $fixture.error + '; received ' + $failure)
        }
        Write-Output $fixture.name
      }
    `;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64')], {
      input: JSON.stringify({ scriptPath, expectedHash, fixtures }), encoding: 'utf8', timeout: 30_000,
    });
    assert.deepEqual(output.trim().split(/\r?\n/), fixtures.map(fixture => fixture.name));
    assert.deepEqual(await readFile(join(valid.path, 'SetupCache', cacheSession, 'Lekh.msi')), cacheBytes,
      'recognizing residue must never delete or alter the repair source');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('Windows packaging requires upgrade verification after fresh setup and before candidate publication', () => {
  inOrder(workflow,
    'npm run verify:setup -- -InstallOnHostedRunner',
    '.\\scripts\\Test-Upgrade.ps1 -InstallOnHostedRunner',
    'npm run package:source',
    'npm run release:checksums',
    'name: Upload reviewed-download candidates');
  assert.match(workflow, /name: Upload upgrade diagnostics on failure\s+if: failure\(\)\s+uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /name: lekh-upgrade-diagnostics\s+if-no-files-found: ignore\s+retention-days: 7\s+path: build\/setup\/upgrade\/\*\*\/\*\.log/);
});

test('PowerShell parses the script and compiles native declarations without invoking any installer', {
  skip: process.platform !== 'win32',
}, () => {
  assert.ok(nativeSource);
  const source64 = Buffer.from(nativeSource, 'utf8').toString('base64');
  const path64 = Buffer.from(scriptPath, 'utf8').toString('base64');
  const command = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $tokens = $null; $errors = $null
    $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'))
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw ($errors | Out-String) }
    Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source64}')))
    Write-Output 'Parsed and compiled; no product operations.'
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30_000 });
  assert.match(output, /Parsed and compiled; no product operations\./);
});

test('local execution refuses missing opt-in or either wrong hosted marker before reaching product work', {
  skip: process.platform !== 'win32',
}, () => {
  const cases = [
    { args: [], actions: 'true', runner: 'github-hosted' },
    { args: ['-InstallOnHostedRunner'], actions: 'true', runner: 'self-hosted' },
    { args: ['-InstallOnHostedRunner'], actions: 'false', runner: 'github-hosted' },
    { args: ['-InstallOnHostedRunner'], actions: 'True', runner: 'github-hosted' },
    { args: ['-InstallOnHostedRunner'], actions: 'true', runner: 'GitHub-Hosted' },
  ];
  for (const item of cases) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...item.args], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, GITHUB_ACTIONS: item.actions, RUNNER_ENVIRONMENT: item.runner },
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Upgrade verification requires -InstallOnHostedRunner on a GitHub-hosted Actions runner/);
  }
});
