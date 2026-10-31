import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
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
    '(Get-FileHash -LiteralPath $newMsi -Algorithm SHA256).Hash -cne',
    'Assert-Absent $product.ProductCode',
    '[UpgradeVerificationInstaller]::RelatedProducts($upgradeCode)',
    'Test-Path -LiteralPath $installDirectory',
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
  assert.ok(cleanup.includes('Final installation absence check'));
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
