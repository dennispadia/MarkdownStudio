param([string]$SetupPath, [switch]$InstallOnHostedRunner)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

function Assert-HostedRunner {
    if (-not $InstallOnHostedRunner -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
        throw 'Upgrade verification requires -InstallOnHostedRunner on a GitHub-hosted Actions runner.'
    }
}
Assert-HostedRunner
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) {
    throw 'Upgrade verification requires 64-bit Windows PowerShell.'
}

# Deliberately bounded to this published lineage; neither asset nor identity is caller-selectable.
$oldSetupUrl = 'https://github.com/dennispadia/lekh/releases/download/v0.8.0/Lekh-Markdown-editor-Setup-0.8.0-x64.exe'
$oldSetupHash = '7e1b42622526fdfaa5aecb64d7394254a96f56469151396f019e18a1af3369fd'
$oldSetupBytes = 197504000L
$upgradeCode = '{DCBCF7FA-11DA-4F35-8D27-D066EEC6C582}'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -cne '0.8.1' -or $manifest.build.productName -cne 'Lekh - Markdown editor' -or
    $manifest.build.msi.upgradeCode -cne $upgradeCode.Trim('{}')) {
    throw 'This check supports only the genuine published 0.8.0 -> 0.8.1 Lekh upgrade.'
}
if (-not $SetupPath) { $SetupPath = Join-Path $root "release\Lekh-Markdown-editor-Setup-$($manifest.version)-x64.exe" }
$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
$installDirectory = Join-Path $env:LOCALAPPDATA 'lekh'
$profileDirectory = Join-Path $env:APPDATA 'Lekh'
$work = Join-Path $root ('build\setup\upgrade\' + [guid]::NewGuid().ToString('N'))
$sources = Join-Path $work 'sources'
$cleanRunnerVerified = $false
$attemptedProducts = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$ownedProducts = @{}
$profileHashes = @{}
$failure = $null
$cleanupErrors = [Collections.Generic.List[string]]::new()

# Microsoft API contracts: silent UI suppresses elevation too; NULL SID means current user.
# https://learn.microsoft.com/windows/win32/api/msi/nf-msi-msisetinternalui
# https://learn.microsoft.com/windows/win32/api/msi/nf-msi-msigetproductinfoexw
# https://learn.microsoft.com/windows/win32/api/msi/nf-msi-msienumrelatedproductsw
# https://learn.microsoft.com/windows/win32/api/msi/nf-msi-msiinstallproductw
# https://learn.microsoft.com/windows/win32/api/msi/nf-msi-msiconfigureproductexw
$nativeSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class UpgradeVerificationInstaller
{
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiEnumRelatedProductsW(string upgradeCode, uint reserved, uint index, StringBuilder productCode);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiGetProductInfoExW(string productCode, string userSid, uint context,
        string property, StringBuilder value, ref uint length);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiInstallProductW(string package, string properties);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiConfigureProductExW(string productCode, int level, int state, string properties);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiEnableLogW(uint mode, string path, uint attributes);
    [DllImport("msi.dll", ExactSpelling = true)]
    private static extern uint MsiSetInternalUI(uint level, IntPtr window);

    public static string[] RelatedProducts(string upgradeCode)
    {
        List<string> products = new List<string>();
        // All calls remain on this thread. Never treat enumeration errors as an empty family.
        for (uint index = 0; index < 256; index++)
        {
            StringBuilder product = new StringBuilder(39);
            uint result = MsiEnumRelatedProductsW(upgradeCode, 0, index, product);
            if (result == 259) return products.ToArray(); // ERROR_NO_MORE_ITEMS
            if (result != 0) throw new Win32Exception((int)result, "Cannot enumerate related MSI products.");
            products.Add(product.ToString());
        }
        throw new InvalidOperationException("Unexpectedly large related MSI product family.");
    }
    public static string ProductProperty(string productCode, uint context, string property)
    {
        uint length = 0;
        uint result = MsiGetProductInfoExW(productCode, null, context, property, null, ref length);
        if (result == 1605) return null; // Only ERROR_UNKNOWN_PRODUCT proves absence.
        if (result != 0 && result != 234) throw new Win32Exception((int)result, "Cannot query " + property);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            StringBuilder value = new StringBuilder(checked((int)length + 1));
            uint capacity = (uint)value.Capacity;
            result = MsiGetProductInfoExW(productCode, null, context, property, value, ref capacity);
            if (result == 1605) return null;
            if (result == 234) { length = capacity; continue; }
            if (result != 0) throw new Win32Exception((int)result, "Cannot query " + property);
            return value.ToString();
        }
        throw new InvalidOperationException("MSI property changed repeatedly: " + property);
    }
    public static uint Execute(string operation, string target, string log)
    {
        const string properties = "REBOOT=ReallySuppress MSIRESTARTMANAGERCONTROL=DisableShutdown";
        uint result = MsiEnableLogW(0x1fff, log, 3); // Append; flush each line for timeout diagnostics.
        if (result != 0) throw new Win32Exception((int)result, "Cannot enable MSI logging.");
        uint previousUI = MsiSetInternalUI(2, IntPtr.Zero); // INSTALLUILEVEL_NONE; never UACONLY.
        if (previousUI == 0) throw new InvalidOperationException("Cannot suppress MSI UI and elevation.");
        try
        {
            if (operation == "Install") return MsiInstallProductW(target, properties);
            if (operation == "Uninstall") return MsiConfigureProductExW(target, 0, 2, properties); // INSTALLSTATE_ABSENT
            throw new InvalidOperationException("Unsupported native MSI operation.");
        }
        finally
        {
            MsiSetInternalUI(previousUI, IntPtr.Zero);
            MsiEnableLogW(0, null, 0);
        }
    }
}
'@
Add-Type -TypeDefinition $nativeSource

function Read-MsiRows($Database, [string]$Query, [int]$Columns) {
    $view = $Database.OpenView($Query)
    try {
        [void]$view.Execute()
        while ($record = $view.Fetch()) {
            try {
                $values = @()
                for ($index = 1; $index -le $Columns; $index++) { $values += $record.StringData($index) }
                ,$values
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        }
    } finally { [void]$view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
}
function Expand-EmbeddedMsi([string]$Setup, [string]$Destination) {
    # Resource-only inspection: never execute either EXE or its entry point.
    $assembly = [Reflection.Assembly]::LoadFile($Setup)
    $resource = $assembly.GetManifestResourceStream('Setup.Payload.msi')
    if ($null -eq $resource) { throw 'Setup is missing its embedded Setup.Payload.msi.' }
    try {
        $output = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try { $resource.CopyTo($output) } finally { $output.Dispose() }
    } finally { $resource.Dispose() }
}
function Read-ValidatedMsi([string]$Path, [string]$Version) {
    $installer = $null
    $database = $null
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase($Path, 0)
        $properties = @{}
        foreach ($row in (Read-MsiRows $database 'SELECT `Property`, `Value` FROM `Property`' 2)) {
            $properties[$row[0]] = $row[1]
        }
        if ($properties.ProductCode -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$' -or
            $properties.ProductName -cne $manifest.build.productName -or $properties.UpgradeCode -ine $upgradeCode -or
            $properties.ProductVersion -notin @($Version, "$Version.0") -or $properties.MSIINSTALLPERUSER -cne '1' -or
            $properties.ContainsKey('ALLUSERS') -or
            ($properties.ContainsKey('ARPSYSTEMCOMPONENT') -and $properties.ARPSYSTEMCOMPONENT -eq '1')) {
            throw "Unexpected MSI identity, version or per-user scope for $Version."
        }
        $summary = $database.SummaryInformation(0)
        try {
            if (([int]$summary.Property(15) -band 8) -eq 0 -or $summary.Property(7) -notmatch '^x64;') {
                throw 'MSI must be x64 and explicitly non-elevated.'
            }
        } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($summary) }
        $directories = @(Read-MsiRows $database 'SELECT `Directory_Parent`, `DefaultDir` FROM `Directory` WHERE `Directory` = ''APPLICATIONFOLDER''' 2)
        if ($directories.Count -ne 1 -or $directories[0][0] -cne 'LocalAppDataFolder' -or
            ($directories[0][1] -split '\|')[-1] -cne 'lekh') { throw 'Unexpected per-user application directory.' }
        $media = @(Read-MsiRows $database 'SELECT `Cabinet` FROM `Media`' 1)
        if ($media.Count -eq 0 -or @($media | Where-Object { $_[0] -notlike '#*' }).Count -gt 0) {
            throw 'Upgrade validation requires self-contained embedded MSI cabinets.'
        }
        $upgrades = @(Read-MsiRows $database 'SELECT `UpgradeCode` FROM `Upgrade`' 1)
        if ($upgrades.Count -eq 0 -or @($upgrades | Where-Object { $_[0] -ine $upgradeCode }).Count -gt 0) {
            throw 'MSI upgrade table has an unexpected upgrade identity.'
        }
        return [pscustomobject]@{ Path = $Path; ProductCode = $properties.ProductCode; Version = $Version }
    } finally {
        if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
        if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
    }
}
function Test-Registration([string]$ProductCode, [uint32]$Context) {
    return $null -ne [UpgradeVerificationInstaller]::ProductProperty($ProductCode, $Context, 'ProductName')
}
function Assert-Absent([string]$ProductCode) {
    foreach ($context in @(1, 2, 4)) {
        if (Test-Registration $ProductCode $context) { throw "Product $ProductCode remains registered in context $context." }
    }
}
function Assert-Installed($Product) {
    foreach ($context in @(1, 4)) {
        if (Test-Registration $Product.ProductCode $context) { throw "Product unexpectedly registered in context $context." }
    }
    $name = [UpgradeVerificationInstaller]::ProductProperty($Product.ProductCode, 2, 'InstalledProductName')
    $version = [UpgradeVerificationInstaller]::ProductProperty($Product.ProductCode, 2, 'VersionString')
    $cached = [UpgradeVerificationInstaller]::ProductProperty($Product.ProductCode, 2, 'LocalPackage')
    if ($name -cne $manifest.build.productName -or $version -notin @($Product.Version, "$($Product.Version).0") -or
        [string]::IsNullOrWhiteSpace($cached) -or -not (Test-Path -LiteralPath $cached -PathType Leaf)) {
        throw "Incorrect current-user USERUNMANAGED registration for $($Product.ProductCode)."
    }
    $related = @([UpgradeVerificationInstaller]::RelatedProducts($upgradeCode))
    if ($related.Count -ne 1 -or $related[0] -ine $Product.ProductCode) { throw 'Unexpected related product registrations.' }
    if (-not (Test-Path -LiteralPath (Join-Path $installDirectory "$($manifest.build.productName).exe") -PathType Leaf)) {
        throw 'Registered product is missing its installed executable.'
    }
}
function Assert-AppNotRunning {
    if (@(Get-Process -Name 'Lekh - Markdown editor' -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'Lekh is running; refusing to close it or perform maintenance.'
    }
}
function Assert-ProfilePreserved {
    foreach ($path in $profileHashes.Keys) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $profileHashes[$path]) {
            throw "Profile data was changed or removed: $path"
        }
    }
}
function Get-PayloadHashes {
    $hashes = @{}
    foreach ($file in (Get-ChildItem -LiteralPath $installDirectory -Recurse -File)) {
        $relative = $file.FullName.Substring($installDirectory.Length + 1)
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    if ($hashes.Count -lt 2 -or -not $hashes.ContainsKey('resources\app.asar')) { throw 'Incomplete installed payload.' }
    return $hashes
}
function Invoke-UpgradeMsi([ValidateSet('Install', 'Repair', 'Uninstall')][string]$Operation, $Product, [string]$Label) {
    Assert-HostedRunner
    if (-not $cleanRunnerVerified -or -not $ownedProducts.ContainsKey($Product.ProductCode) -or
        $ownedProducts[$Product.ProductCode].Path -cne $Product.Path) { throw 'Refusing unowned MSI operation.' }
    Assert-AppNotRunning
    $log = Join-Path $work "$Label.log"
    if ($Operation -eq 'Repair') {
        # /fomus is real maintenance, not another fresh installation.
        # https://learn.microsoft.com/windows/win32/msi/reinstallmode
        $program = Join-Path $env:WINDIR 'System32\msiexec.exe'
        $arguments = @('/fomus', $Product.ProductCode, '/qn', '/norestart',
            'REBOOT=ReallySuppress', 'MSIRESTARTMANAGERCONTROL=DisableShutdown', '/L*vx', "`"$log`"")
    } else {
        $request = @{
            Operation = $Operation
            Target = $(if ($Operation -eq 'Install') { $Product.Path } else { $Product.ProductCode })
            Log = $log
            ExplicitOptIn = $InstallOnHostedRunner.IsPresent
            CleanRunnerVerified = $cleanRunnerVerified
        } | ConvertTo-Json -Compress
        $request64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
        $native64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($nativeSource))
        $command = @"
`$ErrorActionPreference = 'Stop'
`$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$request64')) | ConvertFrom-Json
if (-not `$request.ExplicitOptIn -or -not `$request.CleanRunnerVerified -or
    `$env:GITHUB_ACTIONS -cne 'true' -or `$env:RUNNER_ENVIRONMENT -cne 'github-hosted') { throw 'Refusing unapproved MSI worker.' }
Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$native64')))
exit [int][UpgradeVerificationInstaller]::Execute(`$request.Operation, `$request.Target, `$request.Log)
"@
        $program = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arguments = @('-NoProfile', '-NonInteractive', '-EncodedCommand',
            [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))
    }
    $process = $null
    try {
        $process = Start-Process -FilePath $program -ArgumentList $arguments -PassThru `
            -RedirectStandardOutput (Join-Path $work "$Label.stdout.log") -RedirectStandardError (Join-Path $work "$Label.stderr.log")
        $null = $process.Handle
        if (-not $process.WaitForExit(240000)) {
            # Only this owned caller may be stopped; never kill an application or MSI service.
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            if (-not $process.WaitForExit(10000)) { throw "$Label caller could not be stopped; sources retained at $sources." }
            throw "$Label exceeded 240 seconds; owned caller stopped, MSI sources retained at $sources."
        }
        if ($process.ExitCode -notin @(0, 3010)) {
            throw "$Label failed (exit $($process.ExitCode)); see $log and its stderr log."
        }
        if ($process.ExitCode -eq 3010) { Write-Host "$Label requested a restart; restart suppressed, checking registration and bytes without rebooting." }
    } finally {
        if ($null -ne $process) { $process.Dispose() }
    }
}

New-Item -ItemType Directory -Path $sources -Force | Out-Null
Start-Transcript -Path (Join-Path $work 'verification.log') | Out-Null
try {
    Write-Host 'Scope: pinned public 0.8.0 -> manifest 0.8.1, then genuine repair and exact-product uninstall. No other lineage is covered.'
    $oldSetup = Join-Path $sources 'Lekh-Markdown-editor-Setup-0.8.0-x64.exe'
    Invoke-WebRequest -UseBasicParsing -Uri $oldSetupUrl -OutFile $oldSetup -TimeoutSec 180 -UseDefaultCredentials:$false
    if ((Get-Item -LiteralPath $oldSetup).Length -ne $oldSetupBytes -or
        (Get-FileHash -LiteralPath $oldSetup -Algorithm SHA256).Hash.ToLowerInvariant() -cne $oldSetupHash) {
        throw 'Published 0.8.0 setup length or pinned SHA-256 mismatch; refusing extraction.'
    }
    $oldMsi = Join-Path $sources 'old-0.8.0.msi'
    $newMsi = Join-Path $sources 'new-0.8.1.msi'
    Expand-EmbeddedMsi $oldSetup $oldMsi
    Expand-EmbeddedMsi $SetupPath $newMsi
    $old = Read-ValidatedMsi $oldMsi '0.8.0'
    $new = Read-ValidatedMsi $newMsi $manifest.version
    if ($old.ProductCode -ieq $new.ProductCode) { throw 'Major upgrade must have different old and new ProductCodes.' }
    $builtMsi = Join-Path $root "release\Lekh-Markdown-editor-$($manifest.version)-x64.msi"
    if ((Get-FileHash -LiteralPath $newMsi -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $builtMsi -Algorithm SHA256).Hash) { throw 'New EXE embeds a different MSI from the verified build.' }
    foreach ($product in @($old, $new)) {
        Assert-Absent $product.ProductCode
        $ownedProducts[$product.ProductCode] = $product
    }
    if (@([UpgradeVerificationInstaller]::RelatedProducts($upgradeCode)).Count -ne 0) {
        throw 'Existing related MSI registration; refusing upgrade validation on a non-clean runner.'
    }
    if (Test-Path -LiteralPath $installDirectory) { throw 'Existing application directory; refusing to replace an installation.' }
    Assert-AppNotRunning
    $settings = Join-Path $profileDirectory 'settings.json'
    if (Test-Path -LiteralPath $settings) { throw 'Existing profile settings; refusing to overwrite user data.' }
    $cleanRunnerVerified = $true
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
    $sentinel = Join-Path $profileDirectory ('upgrade-profile-sentinel-' + [guid]::NewGuid().ToString('N') + '.txt')
    [IO.File]::WriteAllText($sentinel, ('Preserve upgrade profile: ' + [guid]::NewGuid().ToString('N')), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($settings, '{"theme":"light","fontSize":18,"upgradeValidation":"0.8.0-to-0.8.1"}', [Text.UTF8Encoding]::new($false))
    foreach ($path in @($sentinel, $settings)) { $profileHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    [void]$attemptedProducts.Add($old.ProductCode)
    Invoke-UpgradeMsi 'Install' $old 'old-install'
    Assert-Installed $old
    Assert-Absent $new.ProductCode
    Assert-ProfilePreserved
    Write-Host "PASS: genuine published 0.8.0 installed and registered as $($old.ProductCode)."

    # The preceding fresh-setup workflow step already exercises the new EXE's real UIA Install action.
    # Here exercise its embedded MSI through the same MsiInstallProduct API, without uninstalling old first.
    [void]$attemptedProducts.Add($new.ProductCode)
    Invoke-UpgradeMsi 'Install' $new 'new-upgrade'
    Assert-Installed $new
    Assert-Absent $old.ProductCode
    Assert-ProfilePreserved
    $payloadHashes = Get-PayloadHashes
    foreach ($relative in @("$($manifest.build.productName).exe", 'resources\app.asar')) {
        $packaged = Join-Path (Join-Path $root 'release\win-unpacked') $relative
        if ($payloadHashes[$relative] -cne (Get-FileHash -LiteralPath $packaged -Algorithm SHA256).Hash) {
            throw "Upgraded $relative differs from the current packaged application."
        }
    }
    Write-Host "PASS: 0.8.1 exact registration and current executable/app.asar bytes; old registration removed by the upgrade."
    Assert-AppNotRunning
    # Remove only a validated installed application file so repair must actually restore missing payload.
    Remove-Item -LiteralPath (Join-Path $installDirectory 'resources\app.asar') -Force
    Invoke-UpgradeMsi 'Repair' $new 'new-repair'
    Assert-Installed $new
    Assert-Absent $old.ProductCode
    $repairedHashes = Get-PayloadHashes
    if ($repairedHashes.Count -ne $payloadHashes.Count) { throw 'Repair changed the installed payload file set.' }
    foreach ($relative in $payloadHashes.Keys) {
        if (-not $repairedHashes.ContainsKey($relative) -or $repairedHashes[$relative] -cne $payloadHashes[$relative]) {
            throw "Repair failed to preserve/restore current payload bytes: $relative"
        }
    }
    Assert-ProfilePreserved
    Write-Host 'PASS: genuine /fomus repair restored missing app.asar; all current payload bytes and seeded profile settings/sentinel preserved.'
} catch {
    $failure = $_
    Write-Host "FAIL: $($_.Exception.Message)"
} finally {
    # Sources remain available through every maintenance and cleanup call, including failure/timeout paths.
    foreach ($product in @($ownedProducts.Values | Sort-Object Version -Descending)) {
        if (-not $attemptedProducts.Contains($product.ProductCode)) { continue }
        try {
            if (Test-Registration $product.ProductCode 2) { Invoke-UpgradeMsi 'Uninstall' $product ("uninstall-" + $product.Version) }
            Assert-Absent $product.ProductCode
            Write-Host "PASS: exact product $($product.ProductCode) is absent in all current-user/machine contexts."
        } catch { $cleanupErrors.Add("Cleanup $($product.ProductCode): $_") }
    }
    if ($attemptedProducts.Count -gt 0) {
        try {
            if (@([UpgradeVerificationInstaller]::RelatedProducts($upgradeCode)).Count -ne 0) { throw 'Related MSI registration remains after cleanup.' }
            if (Test-Path -LiteralPath (Join-Path $installDirectory "$($manifest.build.productName).exe")) { throw 'Installed executable remains after cleanup.' }
        } catch { $cleanupErrors.Add("Final installation absence check: $_") }
    }
    try {
        Assert-ProfilePreserved
        if ($profileHashes.Count -gt 0) { Write-Host 'PASS: seeded profile sentinel and settings remain byte-identical after uninstall.' }
    } catch { $cleanupErrors.Add("Final profile preservation check: $_") }
    foreach ($cleanupError in $cleanupErrors) { Write-Warning $cleanupError }
    try { Stop-Transcript | Out-Null } catch { $cleanupErrors.Add("Closing verification transcript: $_") }
}
if ($null -ne $failure) {
    if ($cleanupErrors.Count -gt 0) { $failure.Exception.Data['UpgradeCleanupErrors'] = $cleanupErrors -join "`n" }
    throw $failure
}
if ($cleanupErrors.Count -gt 0) { throw ($cleanupErrors -join "`n") }
Write-Host 'PASS: bounded genuine 0.8.0 -> 0.8.1 upgrade, repair and exact-product cleanup. No application was launched or forcibly closed.'
