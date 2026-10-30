# Changelog

## 0.6.3

- Apply the approved minimalist interface with enlarged original branding, compact tabs and actions, a centered Export label, and Graphite + Teal Dark colors. Preserve Light and saved theme preferences.
- Collapse the sidebar from its upper-left hamburger into a narrow action rail retaining New, Open, theme, and keyboard shortcuts. Keep the resizable expanded sidebar and remembered preferences.
- Start with one blank Untitled document instead of generated Welcome content. Explorer startup opens the requested file without a redundant blank tab; draft recovery remains available.
- Add an accessible Visual + Source on/off switch: editable Visual on the left, Source on the right, two-way document updates, and toolbar commands targeting the active editor. Preserve raw Source when simply rendering, per-tab view state, and Visual/Source scroll offsets when hiding or showing Source.
- Retain Source-only and read-only Source + Preview in More and native menus; retain independent two-file split tabs.

Known limitations: DOCX/PDF formatting-fidelity improvements and comprehensive cross-mode reading-position alignment remain separate pending work. The application and installer remain unsigned.

## 0.6.2

- Edit an existing Visual link's text and address by clicking it, using the link toolbar button or Ctrl+K, or choosing **Edit link...** from its right-click menu. Remove a link without removing its text.
- Use Ctrl+click to open web/email links through the existing confirmation dialog. Preserve normal navigation for generated table-of-contents links.
- Preserve the complete link range, mixed label formatting on address-only edits, single-step undo/redo, and split-pane targeting. Keep invalid-address errors in the dialog and prevent stale dialogs from editing another document.
- Insert Source-mode links around the captured selection without duplicating selected text, and escape parentheses and whitespace in addresses.

## 0.6.1

- Open Markdown files passed by Windows Explorer on startup. Reuse the existing application window for subsequent launches, opening new tabs or focusing an already-open file without replacing unsaved edits.
- Queue Explorer file requests until the editor is ready and while another operation is busy; report unreadable files without preventing other requested files from opening.

## 0.6.0

- Add same-document Source + Preview with read-only rendering and optional proportional scroll synchronization, including in either side of an existing two-file split.
- Extend Markdown Find/Replace with match-case, Unicode whole-word and regex options, capture replacements, Previous/Next, Replace/Replace all, counts and source highlights. Bound worker execution time and match count.
- Insert and update marked tables of contents without replacing surrounding source; retain the marked block during Visual editing.
- Choose embedded images or document-relative assets for image insertion, clipboard paste and drag/drop; validate formats and refuse unsafe or unsaved asset destinations.
- Render supported Mermaid diagrams offline in Visual/Preview, expose a starter template and explicit errors, and render diagrams independently in an isolated local export page for PDF/Word.

Published with a verified Windows MSI, source ZIP, and SHA-256 checksums. The application and installer remain unsigned while trusted code-signing approval is pending. Previous published releases remain unchanged.

## 0.5.1

- Resize the sidebar by dragging its right edge or using the keyboard; remember its preferred width between launches.
- Toggle Find open and closed with the Find button or Ctrl+F without losing search/replacement text.
- Choose a split partner from Edge-style thumbnail cards showing other unpaired open documents, including unsaved edits and local images.

Published with a verified Windows MSI, source ZIP, and SHA-256 checksums. The application and installer remain unsigned while free signing-provider approval is pending; Windows or browser warnings may still appear.

## 0.5.0

- Apple-inspired Light/Dark interface with teal accents and modern formatting icons.
- Browser-style paired split tabs with independent editing modes, histories and active-pane actions.
- Collapsible Recent Files and prioritized document outline space.
- Sidebar theme switch, adaptive toolbar and Save action dropdown.
- Formatting keyboard shortcuts in Visual and Source, menu/tooltips and F1 reference.
- Searchable code-language highlighting and local Word/PDF exports.
- Original multi-resolution quill branding.
- Per-user x64 MSI distribution, clean source archive, Windows CI, public documentation and fork-only/no-support policy.
- Validated per-user installer components, stable upgrade-scoped identities, direct shortcuts and uninstall folder cleanup; consistent Windows PowerShell verification in CI.

Earlier local builds preceded this public-source distribution. This project is supplied as-is; this changelog is not a maintenance or future-release commitment.
