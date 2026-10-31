$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unsupported setup version.' }
$release = Join-Path $root 'release'
$generated = Join-Path $root 'build\setup'
$payload = Join-Path $release "Lekh-Markdown-editor-$($manifest.version)-x64.msi"
$output = Join-Path $release "Lekh-Markdown-editor-Setup-$($manifest.version)-x64.exe"
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
foreach ($file in @($compiler, $payload, (Join-Path $root 'installer\Setup.manifest'), (Join-Path $root 'installer\Setup.xaml'), (Join-Path $root 'assets\icon.ico'), (Join-Path $root 'assets\icon.png'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required setup input is missing: $file" }
}
New-Item -ItemType Directory -Path $generated -Force | Out-Null
function ConvertTo-CSharpLiteral([string]$Value) {
    '"' + $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n') + '"'
}
$hash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
$constants = [ordered]@{
    Version = $manifest.version
    PayloadHash = $hash
    ProductName = $manifest.build.productName
    ExecutableName = "$($manifest.build.productName).exe"
    InstallDirectory = $manifest.name
}
$lines = @('namespace Lekh.Setup', '{', '    internal static class BuildInfo', '    {')
foreach ($name in $constants.Keys) {
    $lines += "        internal const string $name = $(ConvertTo-CSharpLiteral $constants[$name]);"
}
$lines += @('    }', '}')
$buildInfo = Join-Path $generated 'BuildInfo.cs'
[IO.File]::WriteAllText($buildInfo, ($lines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
$arguments = @('/nologo', '/target:winexe', '/platform:x64', '/warnaserror+', "/out:$output",
    "/win32manifest:$(Join-Path $root 'installer\Setup.manifest')", "/win32icon:$(Join-Path $root 'assets\icon.ico')")
foreach ($assembly in @('System.dll', 'System.Core.dll', 'System.Xaml.dll', 'WPF\WindowsBase.dll', 'WPF\PresentationCore.dll', 'WPF\PresentationFramework.dll')) {
    $reference = Join-Path $framework $assembly
    if (-not (Test-Path -LiteralPath $reference -PathType Leaf)) { throw "Required .NET Framework reference is missing: $reference" }
    $arguments += "/reference:$reference"
}
$arguments += @(
    "/resource:$(Join-Path $root 'installer\Setup.xaml'),Setup.Window.xaml",
    "/resource:$(Join-Path $root 'assets\icon.png'),Setup.Logo.png",
    "/resource:$payload,Setup.Payload.msi"
)
foreach ($source in @('Engine.cs', 'Story.cs', 'EngineTests.cs', 'Setup.cs')) {
    $arguments += Join-Path $root "installer\$source"
}
$arguments += $buildInfo
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw "Native setup compilation failed (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Compiler did not produce the setup executable.' }
Write-Host "Created $output with offline MSI payload SHA-256 $hash."
