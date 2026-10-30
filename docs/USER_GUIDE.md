# Markdown Studio user guide

A local-first Windows desktop application for writing Markdown with a friendly visual editor and exporting to Word and PDF.

**Version note:** the layout, blank startup, and editable Visual + Source switch described below were introduced in 0.6.3. Version 0.6.2 uses the previous layout and separate Visual/Source controls.

## Open the application

Install the shared x64 MSI, then open **Markdown Studio** from your desktop or Start menu. It installs for your current Windows user without administrator access.

For a source checkout, double-click **Launch.cmd** in the project root. The developer build is **release\win-unpacked\Markdown Studio.exe**; keep that entire folder together.

No Microsoft Word, Pandoc, account, or internet connection is required to edit or export documents after setup. Images hosted on websites are deliberately not downloaded.

### If you need to rebuild

Double-click **Launch.cmd**. If the packaged app is missing, it runs **Setup.ps1**, downloads a private Node.js runtime from the official Node.js website, checks its SHA-256 checksum, installs the locked dependencies, and builds the app. Initial setup requires internet access and several hundred megabytes of disk space. It does not install Node.js system-wide or require administrator access.

To explicitly rebuild an existing copy, open PowerShell in this folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
```

The app is a local development build and is **not code-signed**. It is not a Microsoft Store app or a signed public installer.

## Your first document

1. Start writing in the blank **Untitled** document. Choose **New** for another blank page, or **Open** to edit an existing Markdown file. Launching with an Explorer file opens it directly, without an extra blank tab.
2. Write in **Visual** mode, just as you would in a word processor.
3. Use the toolbar for headings, bold, italics, strikethrough, lists, checklists, quotes, code, links, images, tables, and horizontal rules.
4. Choose **Save**, then select a name and location. The result is a normal UTF-8 `.md` file that other editors can open.
5. Choose **Export → Word document** or **Export → PDF document** to create a separate document.

Export uses the **active tab's** current text, including unsaved edits. Exporting does not save or replace the Markdown source.

### Working with multiple files

- If Markdown Studio is your Windows default for `.md` files, double-clicking a file in Explorer opens that document. Further files open as tabs in the existing window, which is restored if minimized. Reopening the same file focuses its tab without replacing unsaved edits.
- **Open file** and **New document** each open a new tab without replacing your other documents.
- Click a tab to switch documents. Each tab keeps its text, undo/redo history, Visual/Source mode, scroll position, and selection.
- A dot beside a tab's name means it has unsaved changes. Hover over the tab to see its full path.
- Opening an already-open file focuses its existing tab, preserving any unsaved edits.
- **Save** and **Export** apply to the active tab. Click the arrow beside **Save** for **Save all files** (Ctrl+Alt+S) and **Save as** (Ctrl+Shift+S). Save all saves every modified tab, asking for filenames for new documents. Canceling a save stops Save all; already saved documents remain saved.
- Click a tab's **x** or press **Ctrl+W** to close it. Unsaved documents offer Save, Discard, and Cancel. Closing the final tab closes the entire window. Cancel, including canceling Save As, keeps your tab and window open.
- **Ctrl+Tab** and **Ctrl+Shift+Tab** move between tabs. The tab strip also supports Left/Right Arrow, Home, and End when focused.
- Closing the app checks **every** unsaved tab, not just the visible document. Cancel leaves all tabs open, even those you previously chose to discard during that exit attempt.
- To avoid conflicting edits, Save As cannot overwrite a file open in another tab.

### Paired split tabs

- Choose **More (...) > Split with...**, **View > Split with...**, or right-click a tab and choose **Split with...**. An Edge-style grid shows thumbnail previews, filenames, and paths for the other unpaired open documents. Click a card to create the pair, or use Tab and Enter/Space. Cancel or Escape leaves your tabs unchanged.
- Previews show the beginning of each document rendered as Markdown, including current unsaved edits and supported local/embedded images, even for files in Source mode. A dot marks unsaved changes. Remote images are not downloaded. Previews do not change editing modes, undo history, or selections.
- The two files become **one paired tab** in the shared tab strip. For example, five open files become one pair plus three individual tabs.
- Click a normal tab to display that file alone. Click the paired tab to restore both documents, their editing modes, scroll positions, and divider size.
- Each side has its own **Visual/Source** controls, editor, selection, and undo/redo history. Click a side to make it active; the outline, formatting, Find, Save, and Export follow that side. **Save all** includes both sides and all other tabs.
- Drag the divider to resize. For keyboard resizing, focus the divider and use Left/Right; Home/End set the 25%/75% limits.
- **Unsplit**, also available from the pair's right-click menu and View menu, restores individual tabs in their original order without closing documents or losing edits.
- The pair's **x** closes both documents, checking unsaved changes in each before closing either. Cancel leaves both open. **Ctrl+W** or **Close active file** closes only that side and restores the remaining file as a normal tab.
- Pairing lasts while the app is open. Draft recovery preserves unsaved document contents, not split layouts.

### Editing features

- **Visual + Source:** turn on the switch in the toolbar to edit Visual on the left and Source on the right. Both represent the same document; edits update the other pane. Click the side you want to edit; toolbar formatting follows it. Turning the switch off keeps Visual and retains scroll offsets. The switch supports Space when focused. Each pane of a two-file pair has its own switch.
- **Single-editor views:** **More (...) > Visual only / Source only**, and **View > Visual / source** (Ctrl+/), retain the separate views. These mode changes reset undo history as before; simply showing Source alongside Visual does not recreate the editor. Visual edits can normalize Markdown syntax; use Source for exact syntax and unsupported constructs.
- **Adaptive toolbar:** outline icons expose names and shortcuts on hover. **More formatting and views (...)** contains advanced formatting, images, tables, code blocks, horizontal rules, and additional views. All commands remain available from the native menus. Save and Export keep their labels.
- **Document outline:** click a heading on the left to navigate.
- **Links (0.6.2):** in Visual, click a link to edit its **Link text** and **Link address**, then choose **Save changes**. The link toolbar button, **Ctrl+K**, and right-click **Edit link...** also edit an existing link. **Remove link** keeps its text and formatting; Cancel leaves the document unchanged. Changing only the address preserves formatting within the label. Each change can be undone in one step. Use **Ctrl+click** to open a web/email link through the existing confirmation dialog, including in read-only Preview. Generated table-of-contents links still navigate with an ordinary click. Supported addresses are HTTP, HTTPS, `mailto:`, and `#heading` anchors. In Source, Ctrl+K continues to insert Markdown link syntax around the selection.
- **Tables:** right-click and choose **Table > Insert table...** or **Insert > Table**, click the table toolbar button, or press **Ctrl+T**. Choose columns and rows, then **Insert table**. Rows include the header; the limits are 100 rows and 50 columns. Cancel leaves your text unchanged. The same dialog works in Visual and Source modes. Click inside an existing table for controls to add or remove rows and columns.
- **Find and replace:** click **Find** or press **Ctrl+F** to toggle the bar; Close/Escape dismiss it without clearing your text. Search Markdown using **Match case** (on by default), **Whole word** (Unicode letters/numbers/underscore), or **Regex**. Previous/Next wrap around; Enter/Shift+Enter in Find navigate. Matches are counted and highlighted in Source. **Replace** changes the current result (or first result); **Replace all** changes every result in one undo step. Regex replacement supports `$1`, named groups, `$&`, and `$$`; literal replacement treats dollar signs literally. Navigation/replacement switches Visual to Source. Regex runs off the UI thread, stops after two seconds, and reports invalid expressions. Above 10,000 results, narrow the search before replacing; replacements cannot exceed the document size limit.
- **Source + Preview:** choose **More (...) > Source + Preview (read-only)** or **View > Source + Preview** to edit Source alongside a read-only rendering. **Sync scrolling** proportionally links scroll positions in either direction and can be unchecked. This is distinct from editable Visual + Source and pairing two files; each paired pane can use it. Returning to Source keeps its undo history; entering Visual retains the existing mode-switch history-reset behavior.
- **Undo and redo:** supported in both modes, independently for each tab. Switching tabs preserves history; switching single-editor Visual/Source modes resets that tab's history. In editable Visual + Source, undo follows the active editor; a Visual edit clears earlier Source-only snapshots so Source undo cannot overwrite that Visual edit with an obsolete snapshot.
- **Spelling:** native spell-checking in the visual editor. Availability and dictionaries depend on Windows.
- **Themes:** click the theme action at the bottom of the sidebar to alternate **Light** and **Dark**. **View > Color theme** also remains available. Dark combines graphite writing surfaces, a midnight sidebar, and muted teal accents. Older Dark and GitHub Dark preferences automatically migrate to Dark. The sidebar icon uses the brighter variant in Dark; Light and the Windows application icon retain the original artwork.
- **Sidebar toggle:** use the upper-left hamburger, **View > Toggle sidebar**, or **Ctrl+Shift+B**. The collapsed rail keeps New, Open, theme, and keyboard shortcuts available while hiding the outline/recent list. Your sidebar preference and expanded width are remembered.
- **Sidebar width:** drag the sidebar's right edge to resize it. Or focus the edge with Tab and use Left/Right for 10-pixel steps; Home/End set the limits. Double-click the edge to reset to 220 pixels. Width is remembered between launches, including when the sidebar is hidden. Limits are 200–480 pixels, further constrained in narrow windows to leave at least 480 pixels for the editor. Widening the window restores your preferred width.
- **Focus mode:** use **View > Focus mode** or **F9** to hide the sidebar and formatting toolbar. Press Escape or F9 to return to your previous sidebar preference. **View > Toggle sidebar** can also leave Focus mode and show the sidebar.
- **Recent files:** click the chevron/heading to expand or collapse the recent list and see its file count. It starts collapsed, remembers your preference, and scrolls independently when expanded so the document outline gets priority. Collapsing does not clear history or close files.
- **Word count:** the quiet status bar shows the active file's approximate word count. Hover over it for character count and estimated reading time. Counts include Markdown syntax.
- **Clear recent files:** expand **RECENT FILES**, then click **Clear**, or use **File > Clear recent files**. This clears only the saved history, not your Markdown files, open tabs, or recovery drafts. Opening or saving a file adds it to the history again.

### Formatting keyboard shortcuts

These work in both Visual and Source modes, including the active side of a split. Hover over a toolbar control to see its shortcut. **Help > Keyboard shortcuts** or **F1** opens the reference.

| Action | Shortcut |
| --- | --- |
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Strikethrough | Ctrl+Shift+X |
| Inline code | Ctrl+E |
| Bullet list | Ctrl+Shift+8 |
| Numbered list | Ctrl+Shift+7 |
| Task list | Ctrl+Shift+9 |
| Block quote | Ctrl+Shift+Q |
| Paragraph / Headings 1-6 | Ctrl+0 / Ctrl+1-6 |
| Insert / edit link | Ctrl+K |
| Open link (confirmation for web/email) | Ctrl+click |
| Insert image | Ctrl+Shift+I |
| Insert table | Ctrl+T |
| Code block | Ctrl+Shift+K |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |

Formatting shortcuts are scoped to document editors, not Find fields, dialogs, or the code-language search box. Existing file, tab, sidebar, and Focus-mode shortcuts are unchanged.

### Code blocks and languages

- Insert a code block with the **Code block** icon (under **More formatting** in narrow windows), Ctrl+Shift+K, or **Insert > Code fence**. In Visual mode, use the language selector at the bottom-right of each block.
- Search the offline language catalog by name or alias, such as **PowerShell**, **ps1**, **Python**, **JavaScript**, **C#**, **JSON**, or **YAML**. Arrow keys navigate results; Enter selects; Escape closes the picker.
- Choosing a language applies syntax colors immediately, with light/dark palettes matching your theme. It does **not** rewrite indentation, reformat, or run your code.
- **Plain text** disables highlighting. Existing unsupported language labels are preserved and displayed as plain text, never guessed.
- In Source mode, specify the language after the opening fence, for example three backticks followed by `powershell`. Languages and code contents survive saving, reopening, and tab/mode switches.
- **Copy** copies only the block's code, preserving its whitespace. PDF and Word exports include syntax colors using a print-friendly light palette, without the editor's buttons or language picker.

### Right-click Markdown menu

Right-click inside the visual editor or Markdown source to access:

- **Cut, Copy, Paste, Select All, Delete selection, Undo, and Redo**, with spelling suggestions when available.
- **Edit link...:** shown when right-clicking a link in Visual, with its current text and address prefilled.
- **Copy / Paste As:** copy a selection or the full document as Markdown, paste as plain text, paste Markdown as formatted content in Visual mode, or explicitly **Paste image**.
- **Formatting:** bold, italic, strikethrough, inline code, quotes, bullet/numbered/task lists, and Clear formatting in Visual mode.
- **Paragraph:** Heading 1 through Heading 6, or normal Paragraph. The current style is checked.
- **Insert:** image, footnote, link, link reference, horizontal line, table, code fence, math block, table of contents, YAML front matter, and a paragraph before or after the current block (current line in Source mode).
- **Table:** **Insert table...** is always available, even before a table exists. Row/column controls are enabled only inside an existing table in Visual mode.

Paragraph and Insert commands are also available under the native **Edit** menu.

**Footnote, link reference, math block, and YAML** commands insert editable Markdown syntax in **Source mode**, as an initial implementation. From Visual mode they insert at the document's end (YAML goes at the top); from Source mode they use the current selection. YAML insertion refuses to duplicate an existing opening front-matter block. Footnotes and link references use unique reference numbers. Math, footnotes, and YAML do not have formatted rendering or structured export support yet; keep them in Source mode to preserve the syntax. Standard Markdown link references are resolved by the renderer/exporter.

**Table of contents** inserts a list enclosed by `<!-- markdown-studio:toc -->` and `<!-- /markdown-studio:toc -->`. Choose **Insert > Update table of contents** (also under **More formatting**) after changing headings. Update replaces only that marked block, preserving surrounding source; duplicate heading names get distinct anchors. Visual editing preserves the block as a single contents node. Update requires exactly one well-formed marked block outside code fences; older unmarked lists must be replaced with a newly inserted marked contents list. Its links navigate within Visual and Preview/PDF; Word retains readable list text.

### Mermaid diagrams

Choose **Insert > Mermaid diagram** or **More formatting > Mermaid diagram** for a flowchart starter in Source + Preview. A fenced block labelled `mermaid` renders locally in Visual and Preview, without running code or using a cloud service. PDF and Word exports render diagrams independently in an isolated local page and include PNG images.

Supported diagram families are flowchart, sequence, class, state, entity-relationship, pie, journey, and timeline. Diagram configuration directives/front matter are ignored; links, HTML, external resources, callbacks and custom shapes are disabled. Limits include 12,000 source characters, 250 lines, 350 statements, 200 edges and 32 diagrams per preview/export. Export images are limited to 4096 pixels per dimension and eight million pixels. Unsupported/invalid diagrams show an error with the source retained; export fails explicitly rather than silently dropping a diagram. Math rendering is still unsupported.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New document | Ctrl+N |
| Open | Ctrl+O |
| Save | Ctrl+S |
| Save As | Ctrl+Shift+S |
| Save all modified tabs | Ctrl+Alt+S |
| Close tab | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Export PDF | Ctrl+P |
| Find and replace | Ctrl+F |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Visual / Source | Ctrl+/ |
| Focus mode | F9 |
| Toggle sidebar | Ctrl+Shift+B |
| Bold / italic in both modes | Ctrl+B / Ctrl+I |
| Keyboard shortcut reference | F1 |
| Heading 1 through 6 / Paragraph | Ctrl+1 through Ctrl+6 / Ctrl+0 |
| Insert image | Ctrl+Shift+I |
| Insert table | Ctrl+T |
| Code fence | Ctrl+Shift+K |
| Math block (Source) | Ctrl+Shift+M |

## Keeping your work safe

- You are asked to **Save, Discard, or Cancel** before closing a tab with unsaved edits. App exit checks all modified tabs.
- Saves use a temporary file in the destination folder followed by a rename. If a save fails, an error is displayed.
- If another application changes or deletes the current file, Save refuses to overwrite it. Use **Save As** with a different name to preserve your version, then compare it with the original.
- Local recovery drafts for **all unsaved tabs** are stored after roughly 700 ms of inactivity. On your next launch, use **Recover drafts** to restore each one in a new, unsaved tab. Save them to keep them. Recovery also supports drafts from the earlier single-file version.
- If recovery storage is full or unavailable, the application reports the problem. A pending recovery draft is retained until you recover or dismiss it.
- **Recovery is not autosave or a backup.** Save regularly and back up important documents. Recovery holds the current unsaved documents per application profile, not a document archive. The browser's storage quota applies to their combined size.
- Markdown files are limited to **10 MB** and must be valid UTF-8 text.

## Images and exports

**Insert image**, clipboard image paste, and image drag/drop offer **Embed in document** or **Save in this document's assets folder**. Embed is selected by default: it creates a portable data URL but increases Markdown/recovery size. Assets are available only after saving the Markdown file. Images get unique non-overwriting names under its `assets` folder and relative Markdown links. Unsafe asset folders (including links/junctions) and malformed images are rejected with an error. Cancellation does not insert an image. Drop one PNG, JPEG, GIF, or WebP at a time; the image limit is 20 MB, and embedded documents still have the 10 MB limit.

**Clipboard images and screenshots:** copy an image or capture a screenshot, then use **Ctrl+V**, **Edit → Paste**, or right-click **Paste**. A clipboard bitmap becomes PNG; choosing embedding in Source produces `![Image](data:image/png;base64,...)`, while choosing assets produces a relative file link. Image-file paste events also support JPEG, GIF, and WebP. Right-click an image and choose **Copy image** to copy its bitmap for use in another document or application. Copy/cut of an individually selected image is also supported. Clipboard bitmaps do not preserve GIF animation. Remote HTML image links are not downloaded.

Embedded pasted images remain inside the saved Markdown file and can be reopened or exported to Word/PDF, with no separate folder to manage. For assets, keep the `assets` folder with the document when copying or sharing it. The 10 MB document limit still applies.

Existing relative image paths, such as `assets/photo.png`, are supported when the image is inside the saved Markdown file's folder or one of its subfolders. Access outside that folder, absolute file paths, and remote downloads are blocked. To use an image elsewhere, insert it using the toolbar. Moving a document with relative images requires copying its image folders, too; Save As warns when changing folders.

- **Word:** headings, bold/italic/strikethrough, inline and fenced code, lists, quotes, links, tables, and PNG/JPEG/GIF images. Image aspect ratios are preserved. WebP images must be converted to PNG or JPEG before Word export.
- **PDF:** A4 pages with 20 mm margins, readable typography, tables, code, links, and embedded images, including WebP. Page breaks are automatic.
- Missing, unreadable, or unsupported export images cause an explicit error instead of silently disappearing.
- Raw HTML is treated as text during export, not executed.

## First-version boundaries

Visual editing can normalize Markdown syntax and may not preserve unsupported constructs. Use **Source mode** for exact editing of YAML front matter, raw HTML, math, footnotes, or custom Markdown extensions. Simply opening, switching modes, and saving without edits preserves the original text.

Not included yet: a folder workspace, cloud sync, automatic updates, custom export templates, advanced pagination, interactive Word form checkboxes, and LaTeX rendering. Task lists export as readable text, not interactive form controls. Paired side-by-side editing and syntax highlighting are supported. The new Source + Preview, enhanced search, refreshable contents, image storage choice, and Mermaid features are source changes awaiting a future installer release; they are not in the published 0.5.1 installer.

## Privacy

The app does not upload documents or collect analytics. Local images are read only as needed. Opening a web/email link requires confirmation and uses your default external application, which may access the internet. Development/setup tools need network access for downloads.

Recent file paths, theme preference, and recovery data are stored in the application's local Electron user-data profile. Documents themselves remain where you choose to save them.

## Development and validation

See the [build guide](BUILDING.md) for MSI packaging and development. The application uses Electron, TypeScript, Vite, Tiptap, markdown-it, and docx. Dependencies are locked in `package-lock.json`.

If using the private runtime installed by setup:

```powershell
$env:PATH = "$PWD\.tools\node-v22.22.0-win-x64;$env:PATH"
npm.cmd test
npm.cmd run test:desktop
npm.cmd run package
```

- `npm test`: unit tests for Markdown helpers, DOCX contents, print HTML, image boundaries, and safe file writes.
- `npm run test:desktop`: builds and launches the real desktop app with an isolated temporary profile. Exercises visual typing, formatting, actual native right-click menus, source-only insertions, table-of-contents links, checkbox alignment (within 1 px of the first text line, including wrapped/nested tasks), per-tab state and undo, duplicate-file handling, Save All, closing tabs/app with unsaved work, native file handlers, exact source preservation, find/replace, external-change protection, DOCX/PDF generation, themes, and multi-tab draft recovery. Native dialog selections and clipboard contents are supplied through a test-only debugger connection; production code has no dialog bypass, and tests do not alter your real clipboard.
- `npm run package`: creates `release\win-unpacked`.
- `npm run generate:icon`: regenerates the multi-resolution Windows icon and window PNG from the original Enchanted Quill artwork in `assets/icon.svg`: an ivory feather and gold writing stroke on emerald, without a crescent. Builds run this automatically. The application remains unsigned; icon and version resources are embedded without code signing.
- To test the packaged executable: `node scripts\smoke.mjs "release\win-unpacked\Markdown Studio.exe"`.

Desktop tests enable loopback debugging only for the test process and close it afterward. The normal launcher does not enable debugging.
