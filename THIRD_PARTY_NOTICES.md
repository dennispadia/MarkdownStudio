# Third-party software

Markdown Studio's original application code and artwork are provided under the MIT license. Its text is named `LICENSE.md` in installed distributions and `LICENSE` in the source repository.

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

This is an overview, not a replacement for the individual license texts. Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` are distributed alongside the executable. Dependency license files are retained in the packaged application archive where supplied by those packages. Development tools have their own licenses and are not all shipped with the application.

Exact dependency versions and integrity hashes are recorded in `package-lock.json`. Preserve applicable notices when redistributing the application or a fork, and review the licenses of any dependencies you add.
