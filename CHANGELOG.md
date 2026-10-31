# Changelog

## 0.7.0

- Rebrand Markdown Studio as Lekh: Markdown editor, using the mixed-case Lekh wordmark with smaller Sanskrit लेख, Windows Segoe UI Light, and the refined quill in Graphite + Teal.
- Rename application titles, About information, export metadata, shortcuts, executable, MSI/source archives, and build artifacts. The executable is `Lekh - Markdown editor.exe`; MSI builds use the GitHub-safe download name `Lekh-Markdown-editor-0.7.0-x64.msi`.
- Retain every existing editing feature, original user-data and Chromium-storage profile, draft/preferences keys, recent-file history, diagram partition, and refreshable table-of-contents markers.
- Explicitly retain the original MSI upgrade code and AppUserModelId. Windows default-file associations and pinned shortcuts may need to be reselected because the executable filename changes.
- Retain historical screenshots and copyright notices. Previous Markdown Studio release downloads have been retired; their Git tags and source history remain available.

The Lekh 0.7.0 installer is published, with successful Windows MSI and extracted-application validation and independently verified public downloads/checksums. Animated premium Setup.exe, installer-speed improvements, and early running-app prompts remain separate pending work. The application and MSI remain unsigned; real install/upgrade/repair/uninstall testing in a disposable VM is still pending.

## 0.6.6

- Use one shared Visual + Source switch for single and paired documents. In a split pair it reflects and changes only the active document; remove duplicate pane switches and mode bars.
- Adapt the single-row toolbar to available width by moving commands into More tools and views, restoring them when space returns, without horizontal scrolling.
- Shrink document tabs like browser tabs, keep the selected tab visible, and provide an Open documents dropdown for all tabs, including those that cannot fit.
- Insert Mermaid diagrams at the current Visual selection rather than switching to Source and using its unrelated caret. Preserve Visual mode, active split-pane targeting, following content, and single-step undo.

Known limitations: installer-speed and early running-app prompt improvements remain separate pending work, as do DOCX/PDF formatting fidelity and comprehensive cross-mode reading-position alignment. The application and installer remain unsigned.

## 0.6.5

- Ship the approved single-row editing toolbar in the actual desktop application, with direct formatting, lists, quotes, links, images, tables, code, rule, table-of-contents, and Mermaid controls. Narrow windows scroll horizontally instead of hiding editing commands.
- Put Split directly beside Visual + Source, distinguishing two-document pairing from two editable views of one document.
- Ship the compact right-click menu with twelve direct editing buttons, Copy / Paste As, Paragraph, Insert, and Table choices. Preserve spelling suggestions, undo/redo, formatting state, link editing, image operations, and native menus for other inputs.
- Preserve selection and active-pane targeting, support keyboard invocation/navigation and focus restoration, and keep menus within the viewport.
- Retain the readable outline labels, five recent files, zoom controls, and filename-specific save confirmations from 0.6.4.

Known limitations: installer-speed and early running-app prompt improvements remain separate pending work, as do DOCX/PDF formatting fidelity and comprehensive cross-mode reading-position alignment. The application and installer remain unsigned.

## 0.6.4

- Show readable heading descriptions in the document outline and its tooltips instead of Markdown link syntax or destination URLs. Preserve document links, heading navigation, and existing anchors.
- Limit Recent Files to the five most recently used files, newest first, including existing saved history.
- Add status-bar zoom-out, percentage/reset, and zoom-in controls synchronized with native View-menu and keyboard zoom.
- Name the saved file in save confirmations, including the new filename after Save As.

Known limitations: the proposed single-row toolbar and compact right-click menu remain design previews, and installer-speed improvements remain pending. DOCX/PDF formatting-fidelity improvements and comprehensive cross-mode reading-position alignment are separate pending work. The application and installer remain unsigned.

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
