import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('native upgrade detection, truthful removal/install stages, same-version maintenance, cancellation and previews', {
  skip: process.platform !== 'win32',
}, async () => {
  const directory = join(root, 'build', 'tests', `native-installer-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    const info = join(directory, 'BuildInfo.cs');
    await writeFile(info, `namespace Lekh.Setup {
      internal static class BuildInfo {
        internal const string Version = "${manifest.version}";
        internal const string PayloadHash = "${'0'.repeat(64)}";
        internal const string ProductName = "Lekh - Markdown editor";
        internal const string ExecutableName = "Lekh - Markdown editor.exe";
        internal const string InstallDirectory = "lekh";
      }
    }`);
    const runner = join(directory, 'Runner.cs');
    await writeFile(runner, `namespace Lekh.Setup {
      internal static class TestRunner {
        [System.STAThread] public static int Main() { return EngineTests.Run(); }
      }
    }`);
    const framework = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
    const compiler = join(framework, 'csc.exe');
    const references = ['System.dll', 'System.Core.dll', 'System.Xaml.dll',
      'WPF\\WindowsBase.dll', 'WPF\\PresentationCore.dll', 'WPF\\PresentationFramework.dll']
      .map(reference => `/reference:${join(framework, reference)}`);
    const sources = ['Engine.cs', 'Story.cs', 'EngineTests.cs', 'Setup.cs'].map(source => join(root, 'installer', source));
    const resources = [
      `/resource:${join(root, 'installer', 'Setup.xaml')},Setup.Window.xaml`,
      `/resource:${join(root, 'assets', 'icon.png')},Setup.Logo.png`,
    ];
    const executable = join(directory, 'NativeTests.exe');
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/warnaserror+',
      '/main:Lekh.Setup.TestRunner', `/out:${executable}`, ...references, ...resources, ...sources, info, runner],
    { encoding: 'utf8', timeout: 30_000 });
    const output = execFileSync(executable, [], { encoding: 'utf8', timeout: 30_000 });
    assert.match(output, /PASS: \d+ native setup assertions\./);
    console.log(output.trim());
    // Compile the shipping entry point too, but never run a real installer or product.
    execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/warnaserror+',
      `/win32manifest:${join(root, 'installer', 'Setup.manifest')}`,
      `/out:${join(directory, 'SetupCompileOnly.exe')}`, ...references, ...resources, ...sources, info],
    { encoding: 'utf8', timeout: 30_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native setup never terminates the editor, restarts it, or performs a separate uninstall', async () => {
  const [engine, setup] = await Promise.all([
    readFile(join(root, 'installer', 'Engine.cs'), 'utf8'),
    readFile(join(root, 'installer', 'Setup.cs'), 'utf8'),
  ]);
  assert.doesNotMatch(engine + setup, /\.Kill\(|CloseMainWindow|MsiConfigureProduct|taskkill|MSIRMSHUTDOWN|Restart-Computer/i);
  for (const property of ['REBOOT=ReallySuppress', 'MSIRESTARTMANAGERCONTROL=DisableShutdown', 'MSIDISABLERMRESTART=1']) {
    assert.ok(engine.includes(property));
  }
  assert.ok(setup.indexOf('else RefreshReady();') < setup.indexOf('private async void Primary()'),
    'registration detection runs before the initial ready page, not only after Install');
  assert.ok(setup.includes('!InstalledProduct.Same(previousProduct, ProductDiscovery.Detect())'),
    'registration is rechecked immediately before extraction/installation');
  const launch = setup.indexOf('Process.Start(new ProcessStartInfo(SetupPolicy.AppPath)');
  assert.ok(setup.lastIndexOf('if (state == "success")', launch) >= 0, 'app launch remains an explicit success-page action only');
});
