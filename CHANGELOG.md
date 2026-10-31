# Changelog

## 0.8.1

- Make all five alert types directly editable in Visual, including rich body content, type changes, natural paragraph entry/exit and undo/redo. Preserve unchanged source syntax and safely serialize edits.
- Refine alerts with GitHub/Learn-like leading borders, semantic icons, readable labels and theme-aware surfaces.
- Group Note, Tip, Important, Caution and Warning under **Alerts**. Add icons and descriptive help to all other Blocks tools.
- Keep variant controls inside their document's Visual or read-only Preview surface instead of spanning Visual + Source.
- Fix Dark tab-header and unresolved-content contrast; verify at least 4.5:1 for normal text in both themes.
- Update feature documentation and application screenshots. Welcome questions, bugs and enhancement requests through GitHub issues.
- Add guarded hosted validation for a genuine 0.8.0 upgrade and repair, with profile and installed-payload checks before publishing.

## 0.8.0

- Add universal publication-quality rendering with protected, source-preserving blocks, collapsed metadata, colored callouts, tabbed examples, document-wide variant selectors, structured steps, and described image directives. No platform-specific editor mode is required.
- Add **Blocks** toolbar shortcuts and matching Insert-menu commands. Formatting selected content into a callout, tab or variant preserves that content.
- Resolve bounded local includes only after a per-document project-folder grant; support explicit revocation. Keep all alternatives in static Word/PDF exports and visibly identify unsupported or unresolved directives.

- Add opt-in, on-device English grammar and punctuation checking with the bundled Harper engine. Review suggestions in Visual and Source, apply an undoable correction, or ignore it once or throughout the current document. Code, protected syntax, stale results and other tabs are guarded; no text is sent online.

- Establish independent Lekh application (`com.lekh.desktop`), npm (`lekh`), installer, and `%APPDATA%\Lekh` profile identities. No migration aliases or automatic removal of another product are included.
- Use a new stable MSI upgrade code, `DCBCF7FA-11DA-4F35-8D27-D066EEC6C582`, for future Lekh upgrades, with application files under `%LOCALAPPDATA%\lekh`.
- Use Lekh-only renderer storage keys, image protocol, diagram partition, preload bridge, and table-of-contents markers.
- Define explicit Segoe UI Heading 1–6 typography rather than relying on document-consumer defaults. Preserve bold, italic, strikethrough, and colored, underlined hyperlinks in DOCX/PDF exports.
- Add Word heading bookmarks and clickable internal heading/table-of-contents links; generate PDF document bookmarks and tagged accessibility.
- Export page-width fixed tables with Markdown column alignments, shaded repeating header rows, nested-list continuation paragraphs and numbering starts, and rendered task boxes.
- Preserve code syntax colors, blank lines, and tabs; constrain images to page bounds while preserving aspect ratio. Use A4 pages, 20 mm margins, and readable light print colors independently of the editor theme.
- Keep Word documents editable: Word reflow can differ from PDF pagination and is not pixel-identical. Math and footnotes remain without formatted rendering or structured export support; YAML is preserved as metadata rather than article text.
- Start with a fresh standalone profile and installation directory. Existing drafts/preferences are not automatically imported; saved Markdown files can be opened normally.
- Invite GitHub issues for bugs, enhancements, and requests. Preserve the MIT license.
- Update first-party attribution and current documentation; remove obsolete screenshots and compatibility narratives.

Published as **[Lekh 0.8.0](https://github.com/dennispadia/lekh/releases/tag/v0.8.0)** with an offline Windows EXE, matching source ZIP and checksums. The release includes the grammar engine and publishing improvements above; earlier published assets remain unchanged.
