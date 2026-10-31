param([string]$SetupPath, [switch]$InstallOnHostedRunner)
$ErrorActionPreference = 'Stop'
if ($InstallOnHostedRunner -and ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted')) {
    throw 'Actual installation is allowed only on a GitHub-hosted Actions runner.'
}
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $SetupPath) { $SetupPath = Join-Path $root "release\Lekh-Markdown-editor-Setup-$($manifest.version)-x64.exe" }
$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
if (-not [Environment]::UserInteractive) { throw 'Setup preview verification requires an interactive Windows desktop.' }

# These switches verify the engine and embedded MSI without installing the application.
foreach ($argument in @('--self-test', '--verify-payload')) {
    $process = Start-Process -FilePath $SetupPath -ArgumentList $argument -PassThru -Wait
    try {
        if ($process.ExitCode -ne 0) { throw "Setup $argument failed (exit $($process.ExitCode))." }
    } finally {
        $process.Dispose()
    }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SetupVerificationDesktop
{
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadParameter(uint action, uint parameter, out int value, uint flags);
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteParameter(uint action, uint parameter, IntPtr value, uint flags);
    public static bool GetClientAreaAnimation()
    {
        int value;
        if (!ReadParameter(0x1042, 0, out value, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return value != 0;
    }
    public static void SetClientAreaAnimation(bool enabled)
    {
        if (!WriteParameter(0x1043, 0, new IntPtr(enabled ? 1 : 0), 2))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
function Set-HostedClientAreaAnimation([bool]$Enabled) {
    if (-not $InstallOnHostedRunner -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
        throw 'Desktop animation preferences may be changed only during opted-in GitHub-hosted verification.'
    }
    [SetupVerificationDesktop]::SetClientAreaAnimation($Enabled)
    if ([SetupVerificationDesktop]::GetClientAreaAnimation() -ne $Enabled) { throw 'Windows did not apply the requested animation test preference.' }
}
function Find-Control($Window, [string]$Id, [switch]$Raw) {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $Id)
    if (-not $Raw) { return $Window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition) }
    $walker = [Windows.Automation.TreeWalker]::RawViewWalker
    $pending = [Collections.Generic.Stack[Windows.Automation.AutomationElement]]::new()
    $pending.Push($Window)
    while ($pending.Count -gt 0) {
        $element = $pending.Pop()
        if ($element.Current.AutomationId -eq $Id) { return $element }
        $child = $walker.GetFirstChild($element)
        while ($null -ne $child) {
            $pending.Push($child)
            $child = $walker.GetNextSibling($child)
        }
    }
    return $null
}
function Wait-Until([scriptblock]$Probe, [int]$TimeoutSeconds = 15, [string]$Message = 'Setup UI timed out.') {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $result = & $Probe
        if ($result) { return $result }
        Start-Sleep -Milliseconds 50
    } while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds)
    throw $Message
}
function Read-StoryText($Control) {
    $text = [string]$Control.Current.Name
    $pattern = $null
    # StoryWritten explicitly publishes the live Run text in Name; its TextPattern may be stale.
    if ($Control.Current.AutomationId -ne 'StoryWritten' -and [string]::IsNullOrWhiteSpace($text)) {
        if ($Control.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
            $text = $pattern.DocumentRange.GetText(-1)
        } elseif ($Control.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            $text = $pattern.Current.Value
        }
    }
    # WPF TextPattern represents the trailing InlineUIContainer quill as an embedded object.
    return $text.Replace([string][char]0xfffc, '').Trim()
}
function Get-StoryPage($Window) {
    $control = Find-Control $Window 'StoryCount'
    if ($null -eq $control) { return 0 }
    if ($control.Current.Name -match '^\s*([123])\s*(?:/|of)\s*3\s*$') { return [int]$Matches[1] }
    return 0
}
function Get-StoryDiagnostic($Window) {
    try {
        $written = Find-Control $Window 'StoryWritten' -Raw
        $accessible = Find-Control $Window 'StoryAccessible' -Raw
        $pause = Find-Control $Window 'StoryPause'
        $count = Find-Control $Window 'StoryCount'
        $pattern = $null
        $patternLength = -1
        if ($null -ne $written -and $written.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
            $patternLength = $pattern.DocumentRange.GetText(-1).Length
        }
        return "Story diagnostic: animation=$([SetupVerificationDesktop]::GetClientAreaAnimation()); pause='$($pause.Current.Name)'; pauseEnabled=$($pause.Current.IsEnabled); partialNameLength=$(([string]$written.Current.Name).Length); partialReadLength=$((Read-StoryText $written).Length); textPatternLength=$patternLength; fullLength=$(([string]$accessible.Current.Name).Trim().Length); writtenId='$($written.Current.AutomationId)'; count='$($count.Current.Name)'."
    } catch { return "Story diagnostic unavailable: $($_.Exception.Message)" }
}
function Test-Story($Window, [switch]$ReducedMotion) {
    try {
        foreach ($id in @('StoryPrevious', 'StoryNext', 'StoryPause', 'StoryCount', 'StoryTitle')) {
            if ($null -eq (Find-Control $Window $id)) { throw "Installing preview is missing accessible story control $id." }
        }
        $written = Find-Control $Window 'StoryWritten' -Raw
        $accessible = Find-Control $Window 'StoryAccessible' -Raw
        if ($null -eq $written -or $null -eq $accessible) { throw 'Installing preview must expose StoryWritten and StoryAccessible in the raw UI Automation tree.' }
        [void](Wait-Until { (Get-StoryPage $Window) -eq 1 } 10 'Story did not begin at page 1.')
        $complete = $accessible.Current.Name.Trim()
        if ([string]::IsNullOrWhiteSpace($complete)) { throw 'StoryAccessible.Name must expose the exact complete paragraph without the title.' }
        if (-not (Find-Control $Window 'StoryTitle').Current.Name.Trim().EndsWith($complete, [StringComparison]::Ordinal)) {
            throw 'The screen-reader title does not contain the complete story paragraph.'
        }
        if ($ReducedMotion) {
            [void](Wait-Until { (Read-StoryText $written) -ceq $complete } 5 'Reduced-motion story did not immediately expose its complete paragraph.')
            $static = [Diagnostics.Stopwatch]::StartNew()
            while ($static.Elapsed.TotalMilliseconds -lt 2200) {
                if ((Get-StoryPage $Window) -ne 1 -or (Read-StoryText $written) -cne $complete) {
                    throw 'Reduced-motion story changed text or automatically advanced instead of staying static.'
                }
                Start-Sleep -Milliseconds 50
            }
            Write-Host 'PASS: reduced-motion story displays the complete, static paragraph. SKIP: motion-specific typing/autoplay UI measurement because client-area animation is disabled; engine story self-tests still ran.'
            return
        }
        $previousText = ''
        $growth = 0
        $typed = $false
        $sample = [Diagnostics.Stopwatch]::StartNew()
        while ($sample.Elapsed.TotalSeconds -lt 8 -and (Get-StoryPage $Window) -eq 1) {
            $text = Read-StoryText $written
            if ($text.Length -ge 3 -and $text.Length -lt $complete.Length -and $complete.StartsWith($text, [StringComparison]::Ordinal)) {
                if ($previousText.Length -ge 3 -and $text.Length -gt $previousText.Length -and
                    $text.StartsWith($previousText, [StringComparison]::Ordinal)) { $growth++ }
                $previousText = $text
                if ($growth -ge 2) { $typed = $true }
            }
            if ($typed) { break }
            Start-Sleep -Milliseconds 50
        }
        if (-not $typed) { throw 'Installing preview did not expose progressive, genuinely typed story text.' }
        foreach ($page in @(1, 2, 3)) {
            [void](Wait-Until { (Get-StoryPage $Window) -eq $page } 45 "Story did not automatically advance to page $page.")
            $fullText = $accessible.Current.Name.Trim()
            if ([string]::IsNullOrWhiteSpace($fullText)) { throw "Page $page has no complete accessible text." }
            # Allow 100 ms of sampling/scheduling tolerance around the two-second completed-page hold.
            [void](Wait-Until {
                if ((Get-StoryPage $Window) -ne $page) { throw "Page $page advanced before its complete text was observed." }
                $text = Read-StoryText $written
                if ($text -cne $fullText) { return $false }
                $hold = [Diagnostics.Stopwatch]::StartNew()
                while ($hold.Elapsed.TotalMilliseconds -lt 1900) {
                    if ((Get-StoryPage $Window) -ne $page) { throw "Page $page did not hold for two seconds after typing." }
                    if ((Read-StoryText $written) -cne $fullText) { throw "Page $page changed its completed paragraph during the hold." }
                    Start-Sleep -Milliseconds 25
                }
                return $true
            } 30 "Page $page never finished typing with a two-second hold.")
        }
        Write-Host 'PASS: story types progressively, automatically cycles 1 -> 2 -> 3, and holds completed pages for two seconds.'
    } catch {
        throw "$($_.Exception.Message) $(Get-StoryDiagnostic $Window)"
    }
}
function Test-SetupPreview([string]$State, [bool]$MotionEnabled) {
    $preview = Start-Process -FilePath $SetupPath -ArgumentList "--preview=$state" -PassThru
    $window = $null
    try {
        $window = Wait-Until {
            $preview.Refresh()
            if ($preview.HasExited) { throw "Preview $state exited before showing a window." }
            if ($preview.MainWindowHandle -ne [IntPtr]::Zero) {
                return [Windows.Automation.AutomationElement]::FromHandle($preview.MainWindowHandle)
            }
        } 15 "Preview $state did not show a native window."
        [void](Wait-Until {
            $heading = Find-Control $window 'Heading'
            $primary = Find-Control $window 'Primary'
            return $null -ne $heading -and -not [string]::IsNullOrWhiteSpace($heading.Current.Name) -and $null -ne $primary
        } 15 "Preview $state is missing Heading or Primary accessibility.")
        if ($window.Current.ProcessId -ne $preview.Id) { throw 'Preview window belongs to a different process.' }
        if ($state -eq 'installing') { Test-Story $window -ReducedMotion:(-not $MotionEnabled) }
        Write-Host "PASS: native accessible preview $state."
    } finally {
        if (-not $preview.HasExited) {
            try {
                if ($null -ne $window) {
                    $pattern = $window.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
                    $pattern.Close()
                }
            } catch { Write-Warning "Could not close preview $state through WindowPattern: $_" }
            if (-not $preview.WaitForExit(5000)) {
                Stop-Process -Id $preview.Id -Force -ErrorAction SilentlyContinue
                [void]$preview.WaitForExit(5000)
            }
        }
        $preview.Dispose()
    }
}
$originalAnimation = [SetupVerificationDesktop]::GetClientAreaAnimation()
Write-Host "Desktop client-area animation before verification: $originalAnimation."
try {
    if ($InstallOnHostedRunner) { Set-HostedClientAreaAnimation $true }
    $motionEnabled = [SetupVerificationDesktop]::GetClientAreaAnimation()
    foreach ($state in @('installing', 'ready', 'open', 'preparing', 'finishing', 'success', 'restart', 'error', 'stopping', 'cancelled')) {
        Test-SetupPreview $state $motionEnabled
    }
    if ($InstallOnHostedRunner) {
        Set-HostedClientAreaAnimation $false
        Test-SetupPreview 'installing' $false
    }
} finally {
    if ($InstallOnHostedRunner) {
        Set-HostedClientAreaAnimation $originalAnimation
        Write-Host "Restored desktop client-area animation: $originalAnimation."
    }
}
function Read-MsiProperty($Database, [string]$Name) {
    $view = $Database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
    $record = $null
    try {
        [void]$view.Execute()
        $record = $view.Fetch()
        if ($null -ne $record) { return $record.StringData(1) }
        return ''
    } finally {
        if ($null -ne $record) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        [void]$view.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    }
}
function Test-HostedInstallation {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
        throw 'Refusing installation outside a GitHub-hosted Actions runner.'
    }
    $msi = (Resolve-Path -LiteralPath (Join-Path $root "release\Lekh-Markdown-editor-$($manifest.version)-x64.msi")).Path
    $installer = $null
    $database = $null
    $setup = $null
    $window = $null
    $attempted = $false
    $sentinel = $null
    $failure = $null
    $cleanupErrors = [Collections.Generic.List[string]]::new()
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase($msi, 0)
        $productCode = Read-MsiProperty $database 'ProductCode'
        if ($productCode -notmatch '^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$') {
            throw 'Internal MSI does not declare a precise ProductCode.'
        }
        if ((Read-MsiProperty $database 'ProductName') -cne $manifest.build.productName -or
            (Read-MsiProperty $database 'ProductVersion') -notin @($manifest.version, "$($manifest.version).0") -or
            (Read-MsiProperty $database 'UpgradeCode').Trim('{}') -ne 'E2FD477D-ED35-561D-8A35-B75851090FE9' -or
            (Read-MsiProperty $database 'MSIINSTALLPERUSER') -ne '1' -or
            -not [string]::IsNullOrEmpty((Read-MsiProperty $database 'ALLUSERS'))) {
            throw 'Hosted installation requires the expected versioned, per-user MSI with the original upgrade identity.'
        }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
        $database = $null
        $installDirectory = Join-Path $env:LOCALAPPDATA 'markdown-studio'
        $executable = Join-Path $installDirectory 'Lekh - Markdown editor.exe'
        $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$productCode"
        $registryPaths = @($registryPath,
            "HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$productCode",
            "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$productCode",
            "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$productCode")
        if ((Test-Path -LiteralPath $installDirectory) -or $installer.ProductState($productCode) -ne -1) {
            throw 'Hosted installation requires a clean runner; refusing to replace or uninstall an existing application.'
        }
        foreach ($path in $registryPaths) {
            if (Test-Path -LiteralPath $path) { throw 'Existing product registration found; refusing destructive verification.' }
        }
        $profileDirectory = Join-Path $env:APPDATA 'Markdown Studio'
        New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
        $sentinel = Join-Path $profileDirectory ("setup-profile-sentinel-" + [guid]::NewGuid().ToString('N') + '.txt')
        $sentinelContent = 'Preserve user profile: ' + [guid]::NewGuid().ToString('N')
        [IO.File]::WriteAllText($sentinel, $sentinelContent, [Text.UTF8Encoding]::new($false))
        $setup = Start-Process -FilePath $SetupPath -PassThru
        $window = Wait-Until {
            $setup.Refresh()
            if ($setup.HasExited) { throw 'Hosted setup exited before showing its install window.' }
            if ($setup.MainWindowHandle -ne [IntPtr]::Zero) {
                return [Windows.Automation.AutomationElement]::FromHandle($setup.MainWindowHandle)
            }
        } 20 'Hosted setup did not show a native window.'
        if ($window.Current.ProcessId -ne $setup.Id) { throw 'Hosted setup window belongs to a different process.' }
        $primary = Wait-Until {
            $button = Find-Control $window 'Primary'
            if ($null -ne $button -and $button.Current.IsEnabled -and $button.Current.Name -match '^Install\b') {
                return $button
            }
        } 15 'Hosted setup did not offer an enabled Install primary action.'
        $invoke = $primary.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
        $attempted = $true
        $invoke.Invoke()
        [void](Wait-Until {
            if ($setup.HasExited) { throw 'Hosted setup exited before its success heading appeared.' }
            $heading = Find-Control $window 'Heading'
            return $null -ne $heading -and $heading.Current.Name.Replace([char]0x2019, [char]0x27) -ceq "You're ready to write."
        } 240 'Hosted setup never reached the ready-to-write success heading.')
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Installed executable is missing: $executable" }
        if (-not (Test-Path -LiteralPath $registryPath)) { throw 'Installed product is missing its exact per-user Apps registry entry.' }
        $registration = Get-ItemProperty -LiteralPath $registryPath
        if ($registration.DisplayName -cne $manifest.build.productName -or
            $registration.DisplayVersion -notin @($manifest.version, "$($manifest.version).0") -or
            $registration.WindowsInstaller -ne 1 -or $installer.ProductState($productCode) -ne 5) {
            throw 'Installed Apps identity, version or Windows Installer registration is incorrect.'
        }
        if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or [IO.File]::ReadAllText($sentinel) -cne $sentinelContent) {
            throw 'Installing modified or removed the user profile sentinel.'
        }
        Write-Host "PASS: hosted Primary Invoke installed $productCode per-user without launching the application."
    } catch {
        $failure = $_
    } finally {
        $setupExited = $true
        if ($null -ne $setup) {
            try {
                if (-not $setup.HasExited) {
                    if ($null -eq $window) { throw 'Cannot safely close a setup window that was never discovered.' }
                    $close = $window.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
                    $close.Close()
                    if (-not $setup.WaitForExit(120000)) { throw 'Hosted setup did not close; refusing concurrent uninstall.' }
                }
            } catch {
                $setupExited = $setup.HasExited
                $cleanupErrors.Add("Closing hosted setup: $_")
            }
        }
        if ($attempted -and $setupExited) {
            try {
                $logDirectory = Join-Path $root 'build\setup'
                New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
                $log = Join-Path $logDirectory 'hosted-uninstall.log'
                $uninstall = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\msiexec.exe') -ArgumentList @(
                    '/x', $productCode, '/qn', '/norestart', '/L*v', "`"$log`""
                ) -PassThru -Wait
                try {
                    if ($uninstall.ExitCode -notin @(0, 1605, 1614, 3010)) {
                        throw "Exact-product uninstall failed (exit $($uninstall.ExitCode)); see $log."
                    }
                } finally { $uninstall.Dispose() }
                if ((Test-Path -LiteralPath $executable) -or $installer.ProductState($productCode) -ne -1) {
                    throw 'Exact-product uninstall left the application executable or installed product behind.'
                }
                foreach ($path in $registryPaths) {
                    if (Test-Path -LiteralPath $path) { throw 'Exact-product uninstall left an Apps registry entry behind.' }
                }
                Write-Host "PASS: hosted exact-product uninstall removed $productCode and its executable/Apps registration."
            } catch { $cleanupErrors.Add("Uninstall verification: $_") }
        }
        if ($null -ne $sentinel) {
            try {
                if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or [IO.File]::ReadAllText($sentinel) -cne $sentinelContent) {
                    throw 'The profile sentinel was removed or modified; user data was not preserved.'
                }
                Write-Host "PASS: user profile sentinel preserved at $sentinel."
            } catch { $cleanupErrors.Add("Profile verification: $_") }
        }
        if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
        if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
        if ($null -ne $setup) { $setup.Dispose() }
    }
    if ($null -ne $failure) { Write-Error -ErrorAction Continue $failure }
    if ($cleanupErrors.Count -gt 0) { throw ($cleanupErrors -join "`n") }
    if ($null -ne $failure) { throw $failure }
}
if ($InstallOnHostedRunner) {
    Test-HostedInstallation
    Write-Host 'PASS: setup engine, offline payload, previews and hosted install/uninstall. The application was not launched.'
} else {
    Write-Host 'PASS: setup engine, offline payload, and native previews. No application was installed, uninstalled, launched or closed.'
}
