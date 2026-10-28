param([string]$MsiPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $MsiPath) { $MsiPath = Join-Path $root "release\Markdown-Studio-$($manifest.version)-x64.msi" }
$MsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("markdown-studio-msi-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$installer = $null
$database = $null
function Read-MsiRows([string]$Query, [int]$Columns) {
    $view = $database.OpenView($Query)
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
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($MsiPath, 0)
    $properties = @{}
    foreach ($row in (Read-MsiRows 'SELECT `Property`, `Value` FROM `Property`' 2)) { $properties[$row[0]] = $row[1] }
    if ($properties.ProductName -ne $manifest.build.productName) { throw 'MSI product name mismatch.' }
    if ($properties.ProductVersion -notin @($manifest.version, "$($manifest.version).0")) { throw 'MSI version mismatch.' }
    if ($properties.ContainsKey('ALLUSERS') -or $properties.MSIINSTALLPERUSER -ne '1') { throw 'MSI is not restricted to the current user.' }
    $summary = $database.SummaryInformation(0)
    try {
        if (([int]$summary.Property(15) -band 8) -eq 0) { throw 'MSI requests elevated privileges instead of limited user privileges.' }
        if ($summary.Property(7) -notmatch '^x64;') { throw 'MSI is not an x64 package.' }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($summary) }
    $directories = @(Read-MsiRows 'SELECT `Directory_Parent` FROM `Directory` WHERE `Directory` = ''APPLICATIONFOLDER''' 1)
    if ($directories.Count -ne 1 -or $directories[0][0] -ne 'LocalAppDataFolder') { throw 'MSI application folder is not inside current-user LocalAppData.' }
    $shortcuts = @(Read-MsiRows 'SELECT `Directory_` FROM `Shortcut`' 1)
    $shortcutDirectories = @($shortcuts | ForEach-Object { $_[0] })
    if ('DesktopFolder' -notin $shortcutDirectories -or 'ProgramMenuFolder' -notin $shortcutDirectories) { throw 'MSI is missing desktop or Start menu shortcuts.' }
    $media = @(Read-MsiRows 'SELECT `Cabinet` FROM `Media`' 1)
    if ($media.Count -eq 0 -or @($media | Where-Object { $_[0] -notlike '#*' }).Count -gt 0) { throw 'MSI requires an external cabinet instead of being self-contained.' }
    $upgrades = @(Read-MsiRows 'SELECT `UpgradeCode` FROM `Upgrade`' 1)
    if ($upgrades.Count -eq 0 -or @($upgrades | Where-Object { $_[0] -ne $properties.UpgradeCode }).Count -gt 0) { throw 'MSI upgrade identity is missing or inconsistent.' }
    Write-Host 'PASS: MSI identity, version, x64, non-elevated per-user scope, user-data install path, desktop/Start menu shortcuts, embedded payload and upgrades.'
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
    $database = $null
    $payload = Join-Path $temporary 'payload'
    $log = Join-Path $temporary 'extraction.log'
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a', "`"$MsiPath`"", '/qn', "TARGETDIR=`"$payload`"", '/L*v', "`"$log`"") -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 30 | Write-Host }
        throw "MSI administrative extraction failed (exit $($process.ExitCode))."
    }
    $executables = @(Get-ChildItem -LiteralPath $payload -Filter 'Markdown Studio.exe' -Recurse -File)
    if ($executables.Count -ne 1) { throw 'Expected exactly one application executable in the MSI payload.' }
    $application = $executables[0]
    foreach ($file in @('resources\app.asar', 'LICENSE.md', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE.electron.txt', 'LICENSES.chromium.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $application.DirectoryName $file))) { throw "MSI payload is missing $file." }
    }
    $original = Join-Path $root 'release\win-unpacked\resources\app.asar'
    if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $application.DirectoryName 'resources\app.asar') -Algorithm SHA256).Hash) { throw 'MSI application differs from the packaged application.' }
    Write-Host 'PASS: MSI extracts without installing or registering the product; payload and notices verified.'
    & node (Join-Path $PSScriptRoot 'smoke.mjs') $application.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Desktop validation of the extracted MSI application failed.' }
} finally {
    if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
    if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
