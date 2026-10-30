# Forking and customization

This is an MIT-licensed open-source project for self-service use and independent forks. **Upstream contributions and support are not being solicited.** Please work in your fork rather than expecting feature requests, issues, or pull requests to be handled here.

## Suggested workflow

1. Fork the repository on GitHub and clone your fork.
2. Follow [BUILDING.md](docs/BUILDING.md).
3. Make one focused change at a time, optionally with an AI coding assistant.
4. Run unit tests, real desktop tests, and MSI validation before distributing your version.
5. Keep the MIT license and all applicable third-party notices.

## Give a distributed fork its own identity

Before sharing installers for a renamed or independently maintained fork, change:

- `name`, `author`, and `build.productName` in `package.json`.
- `build.appId` and `build.msi.upgradeCode` in `package.json`. The explicit MSI upgrade code retains the original product's identity: **do not reuse either identifier**, or a fork can replace the original installation.
- The Electron `app.setAppUserModelId` value in `electron/main.ts` to match the new app ID.
- The product constants and `userDataDirectory` in `lib/branding.ts`. The original profile directory is deliberately retained across the Lekh rebrand; an independent fork must use its own directory.
- Installer/shortcut/artifact names, the icon artwork where appropriate, and release documentation.
- Tests and distribution scripts that intentionally verify the original product identity.

Changing only the product name does **not** separate this application's explicitly retained user-data profile. Change the profile directory too. Test your fork alongside the original to ensure neither overwrites the other's application files, settings, or recovery data.

## Useful AI task prompt

> In my fork of Lekh, implement [a specific feature]. Read the architecture and build guide first. Preserve existing file-saving, draft recovery, per-tab undo, split-pane routing, and export behavior. Add focused regression tests, run the existing tests, and explain the changes and remaining limitations. Do not publish or install anything without my approval.

You are responsible for reviewing AI output and maintaining your fork. See [SUPPORT.md](SUPPORT.md).
