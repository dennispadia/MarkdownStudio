$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$release = Join-Path $root 'release'
$names = @("Markdown-Studio-$($manifest.version)-x64.msi", "MarkdownStudio-$($manifest.version)-source.zip")
$lines = foreach ($name in $names) {
    $file = Join-Path $release $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Build the release artifact first: $name" }
    (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name
}
$lines | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding Ascii
Write-Host 'Created release\SHA256SUMS.txt for the MSI and clean source archive.'
