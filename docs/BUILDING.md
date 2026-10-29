# Building and validating Markdown Studio

## Requirements

- Windows 10/11 x64.
- Node.js >=22.15.0 and npm. The setup script and CI use Node 22.22.0.
- Internet access for the first dependency, Electron runtime, and WiX tool downloads.

WiX is fetched by electron-builder; you do not need to install Word, Pandoc, or WiX manually. First builds can take several minutes. Windows corporate policy can restrict downloads or installer execution.

```powershell
npm.cmd ci --registry=https://registry.npmjs.org
npm.cmd test
npm.cmd run test:desktop
```

If you use the private runtime downloaded by `Setup.ps1`, first add it to the current shell:

```powershell
$env:PATH = "$PWD\.tools\node-v22.22.0-win-x64;$env:PATH"
```

Desktop tests need an interactive Windows desktop. They create temporary sample files and an isolated app profile, provide their own native-dialog selections and clipboard stubs through loopback debugging, and close their test process afterward. They do not use your real clipboard or documents.

## Build outputs

Close running copies before rebuilding. Do not run two packaging/build commands concurrently: Vite replaces `dist`, and the packager may still be reading it.

| Command | Result |
| --- | --- |
| `npm run build` | TypeScript checking, generated icons, and Vite application output |
| `npm run package` | Developer app in `release\win-unpacked` |
| `npm run package:msi` | Self-contained `release\Markdown-Studio-<version>-x64.msi` and unpacked app |
| `npm run verify:msi` | Checks MSI properties, per-user/limited scope, shortcuts, cabinet and upgrades; extracts its payload and runs the complete desktop suite against it |
| `npm run package:source` | Clean, allowlisted source ZIP, excluding tools, dependencies, output, and private configuration |
| `npm run release:checksums` | SHA-256 checksum list for the MSI and source ZIP |

`verify:msi` performs **administrative extraction**, not a product installation. It does not register/unregister the app or create user shortcuts. Test real installation, upgrade, repair, and uninstall in a disposable Windows VM before a wider release.

The desktop suite launches the application with a Markdown path, then starts real
secondary processes against an isolated profile. It checks startup loading,
one-window tab activation, relative paths with spaces/Unicode, preservation of
unsaved edits, minimized-window restoration, and file requests queued during a
busy Save As operation. It runs against both development and extracted MSI apps.

### Installer validation status and policy restrictions

Local MSI validation can be blocked by Windows system policy (`LGHT1105`), including when run with administrator approval. The hosted workflow runs validation without suppressing ICE checks. Per-user file components use stable HKCU registry key paths, non-advertised shortcuts, and uninstall folder cleanup to satisfy ICE38 and ICE64.

If you encounter this error, use a Windows build environment where your organization's policy permits Windows Installer validation, or ask your administrator for guidance. Do not disable security policy or suppress ICE validation. The included GitHub Actions workflow is another build option, but confirm that packaging and verification both succeed before sharing its artifacts.

The workflow uses Windows PowerShell, matching the npm distribution scripts. Verification and checksum scripts explicitly load their host's Utility module so `Get-FileHash` remains available even when launched from PowerShell 7 with an inherited module search path.

The installer is intentionally per-user only, uses LocalAppData rather than Program Files, creates desktop/Start menu shortcuts, and does not launch the app automatically. Its upgrade identity is derived from `build.appId`; keep that stable for original-product updates and change it for independent forks. The narrowly checked `configure-msi.cjs` hook adjusts the builder's dual-scope template to enforce the non-elevated scope and fails if an upstream template changes.

## Screenshots

To regenerate the README screenshots from the actual application with sample documents:

```powershell
$env:STUDIO_PUBLIC_SCREENSHOTS = '1'
npm.cmd run test:desktop
Remove-Item Env:\STUDIO_PUBLIC_SCREENSHOTS
```

They are written to `docs\images`. Review them before committing. Normal test runs do not overwrite these images.

## Project map

| Location | Role |
| --- | --- |
| `src` | Renderer UI, pane/tab routing, editing, sidebar and toolbar |
| `electron` | Native window, menus, narrow preload bridge, file and export operations |
| `lib` | Markdown helpers, exports, highlighting, themes, tables and pairing model |
| `assets` | Original quill SVG artwork and generated Windows icons |
| `scripts` | Desktop validation, icon generation, MSI configuration/verification and source packaging |
| `tests` | Unit and distribution configuration tests |
| `.github/workflows` | Windows CI and downloadable build artifacts; no automatic public release |

Source is TypeScript with strict checking. The preload bridge is intentionally narrow. Keep document save/recovery handling, file/image boundaries, per-tab histories and active-pane routing intact when changing features.

## Signing

This configuration does not code-sign binaries or installers. No certificate, private key, token, or publisher identity is included. Adding signing requires your own certificate/service, a review of the builder configuration, and protected CI secrets. Never commit signing material.
