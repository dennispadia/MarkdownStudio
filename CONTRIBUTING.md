# Contributing to Lekh

**[GitHub issues](https://github.com/dennispadia/lekh/issues)** are welcome for questions, bugs, enhancements, and requests. Describe the workflow or reproduction steps and avoid private documents or credentials. See [Help and feedback](SUPPORT.md).

## Development workflow

1. Follow [BUILDING.md](docs/BUILDING.md).
2. Make one focused change at a time, preserving file saving, draft recovery, per-tab undo, split-pane routing, and export behavior.
3. Add focused regression tests and run the relevant existing tests.
4. For desktop or distribution changes, also run the desktop suite and installer verification before proposing a release.
5. Keep the MIT license and all applicable third-party notices.

## Independently distributed derivatives

MIT permits modification and redistribution. An independently maintained derivative needs its own npm name, product name, application ID, MSI upgrade code, profile directory, renderer storage keys, image protocol, diagram partition, preload bridge, document markers, shortcut/artifact names, and artwork where appropriate.

Do not reuse Lekh's `com.lekh.desktop` application ID, `%APPDATA%\Lekh` profile, `%LOCALAPPDATA%\lekh` installation directory, or `DCBCF7FA-11DA-4F35-8D27-D066EEC6C582` MSI upgrade code for another product. Keep those identities stable for future releases of Lekh itself. Update installer policy, verification scripts, tests, and documentation together when creating a separate product, and verify side-by-side installation without overwriting either product's data.
