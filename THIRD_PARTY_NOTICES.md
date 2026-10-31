# Third-party software

Lekh's original application code and artwork are provided under the MIT license, with copyright attributed to Lekh contributors. Its text is named `LICENSE.md` in installed distributions and `LICENSE` in the source repository.

Segoe UI Light and Nirmala UI are used from Windows when available; their font files are not bundled or redistributed with this application.

The application depends on separately licensed open-source software, including:

| Component | Purpose | License |
| --- | --- | --- |
| Electron | Desktop runtime | MIT, with additional Chromium and bundled-component notices |
| Tiptap / ProseMirror | Visual editing | MIT |
| markdown-it | Markdown parsing for exports | MIT |
| docx | Word document generation | MIT |
| highlight.js | Syntax highlighting | BSD-3-Clause |
| lowlight | Syntax-highlight integration | MIT |
| Mermaid | Offline diagram parsing and rendering | MIT |
| Harper / harper.js 2.13.0 | On-device English grammar checking, bundled WebAssembly engine | Apache-2.0 |
| fflate | Decompression of the bundled grammar engine | MIT |

Harper is developed by Elijah Potter and contributors: <https://github.com/Automattic/harper>.
Its full license is installed as `licenses/Harper-LICENSE.txt`; fflate's license is installed as `licenses/fflate-LICENSE.txt`.
The grammar engine is bundled locally and is not modified. No hosted grammar service is used.
`licenses/Harper-THIRD-PARTY-NOTICES.txt` accompanies both source and installed distributions.
It preserves the embedded runtime/Unicode notices and source-access information for MPL-2.0 components.

This is an overview, not a replacement for the individual license texts. Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` are distributed alongside the executable. Dependency license files are retained in the packaged application archive where supplied by those packages. Development tools have their own licenses and are not all shipped with the application.

Exact dependency versions and integrity hashes are recorded in `package-lock.json`. Preserve applicable notices when redistributing the application or a fork, and review the licenses of any dependencies you add.
