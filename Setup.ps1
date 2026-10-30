$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$version = '22.22.0'
$runtime = Join-Path $PSScriptRoot ".tools\node-v$version-win-x64"
if (-not (Test-Path "$runtime\node.exe")) {
    New-Item -ItemType Directory -Force '.tools' | Out-Null
    $archive = "node-v$version-win-x64.zip"
    Write-Host 'Downloading Node.js from nodejs.org...'
    Invoke-WebRequest "https://nodejs.org/dist/v$version/$archive" -OutFile ".tools\$archive"
    $checksums = (Invoke-WebRequest "https://nodejs.org/dist/v$version/SHASUMS256.txt").Content
    $expected = (($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archive") }) -split '\s+')[0]
    $actual = (Get-FileHash ".tools\$archive" -Algorithm SHA256).Hash
    if (-not $expected -or $actual -ne $expected) { throw 'Node.js download checksum verification failed.' }
    Expand-Archive -LiteralPath ".tools\$archive" -DestinationPath '.tools'
    Remove-Item -LiteralPath ".tools\$archive"
}
$env:PATH = "$runtime;$env:PATH"
& "$runtime\npm.cmd" ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. See the error above.' }
& "$runtime\npm.cmd" run package
if ($LASTEXITCODE -ne 0) { throw 'Application build failed. See the error above.' }
Write-Host 'Ready! Open release\win-unpacked\Lekh - Markdown editor.exe.'
Read-Host 'Press Enter to finish'
