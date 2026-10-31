$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$output = Join-Path $release "Lekh-$($manifest.version)-source.zip"
$files = @('.gitignore', '.gitattributes', '.editorconfig', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'diagram-export.html', 'Launch.cmd', 'Setup.ps1', 'README.md', 'LICENSE', 'SUPPORT.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'licenses\Harper-THIRD-PARTY-NOTICES.txt')
$folders = @('.github', 'assets', 'docs', 'electron', 'installer', 'lib', 'scripts', 'src', 'tests')
foreach ($folder in $folders) {
    $base = Join-Path $root $folder
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { throw "Required source folder is missing: $folder" }
    foreach ($file in (Get-ChildItem -LiteralPath $base -Recurse -File -Force)) {
        if ($file.Extension -notin @('.ts', '.css', '.json', '.html', '.svg', '.png', '.ico', '.mjs', '.cjs', '.ps1', '.md', '.yml', '.yaml', '.cmd', '.cs', '.xaml', '.manifest')) { throw "Review unexpected source file before exporting: $($file.FullName)" }
        $files += $file.FullName.Substring($root.Length + 1)
    }
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($output, [IO.FileMode]::Create, [IO.FileAccess]::Write)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in ($files | Sort-Object -Unique)) {
        $absolute = Join-Path $root $relative
        if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "Required source file is missing: $relative" }
        $entry = 'lekh/' + $relative.Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $absolute, $entry, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Host "Created $output with $($files.Count) source files; no runtime, dependencies, build output or private settings."
