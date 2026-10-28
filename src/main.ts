import { Editor, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from '@tiptap/markdown';
import { documentPreviewHTML, headingAnchor, headings, imageDisplayURL, isSafeLink, wordCount } from '../lib/markdown.js';
import { replaceSearchMatches, type SearchMatch, type SearchResult } from '../lib/search.js';
import { tableOfContents, updateTableOfContents } from '../lib/contents.js';
import type { Result } from './bridge.js';
import { isTheme, restoreTheme, themes, type Theme } from '../lib/themes.js';
import { createPair, DEFAULT_SIDEBAR_WIDTH, groupTabs, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, pairFor, sidebarWidth, splitRatio, type SplitPair } from '../lib/workspace.js';
import { formattingShortcuts } from '../lib/shortcuts.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, tableMarkdown, validateTableSize } from '../lib/tables.js';
import { syntaxCSS } from '../lib/highlight.js';
import { LanguageCodeBlock } from './code-block.js';
import { ContentsNode } from './contents-node.js';
import { renderMermaidBlocks } from './diagrams.js';
import './style.css';

const syntaxStyle = document.createElement('style');
syntaxStyle.textContent = [
  syntaxCSS('.tiptap'),
  syntaxCSS(':root[data-theme="dark"] .tiptap', true),
].join('\n');
document.head.append(syntaxStyle);

const welcome = `# A little space for big ideas

Welcome to **Markdown Studio**. A calm place to write, organize your thoughts, and turn them into something worth sharing.

## Make yourself at home

Write naturally here, or switch to **Source** to work directly with Markdown. Use the toolbar to add formatting without remembering any syntax.

- **Open** a Markdown file from your computer
- Add headings, links, images, and tables
- **Save** your work as a regular \`.md\` file
- Export a polished **Word document** or **PDF**

> Your words stay yours. Editing and exports happen on your computer, without an account or cloud service.

## A simple plan

| Step | What to do |
| --- | --- |
| 1 | Gather your ideas |
| 2 | Write a first draft |
| 3 | Make it your own |

### Try a checklist

- [ ] Start something new
- [ ] Find the right words
- [ ] Share the finished document

### A place for code, too

\`\`\`javascript
const idea = "Something wonderful";
console.log(idea);
\`\`\`

---

**Ready?** Choose **New document** for a blank page, or **Open file** to bring your own.
`;

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 8V5h7l2 3h9v12H3Z"/>',
  save: '<path d="M4 3h14l3 3v15H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  export: '<path d="M12 3v12M8 7l4-4 4 4M4 14v6h16v-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0) scale(.85)"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17v.1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bold: '<path d="M7 4v16h6a4 4 0 0 0 0-8H7m0-8h5a4 4 0 0 1 0 8"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  strike: '<path d="M17 7c-1-4-10-4-10 1 0 3 10 4 10 8 0 5-10 5-11 0M3 12h18"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
  bullet: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r=".7"/><circle cx="4" cy="12" r=".7"/><circle cx="4" cy="18" r=".7"/>',
  ordered: '<path d="M10 6h11M10 12h11M10 18h11M3 4l2-1v6M3 9h4M3 15c0-3 5-3 4 0l-4 5h4"/>',
  task: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="m7 12 3 3 7-7"/>',
  quote: '<path d="M4 13h5V6H3v8c0 3 2 4 4 4m9-5h5V6h-6v8c0 3 2 4 4 4"/>',
  codeblock: '<rect x="2" y="3" width="20" height="18" rx="4"/><path d="m9 9-3 3 3 3m6-6 3 3-3 3"/>',
  rule: '<path d="M3 12h18"/>',
};
type Icon = keyof typeof icons;
const icon = (name: Icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const button = (action: string, label: string, name?: Icon, className = '') => `<button type="button" data-action="${action}" class="${className}" title="${label}">${name ? icon(name) : ''}<span>${label}</span></button>`;
const formatButton = (command: Icon, label: string, optional = false) => `<button type="button" data-command="${command}" title="${label}" aria-label="${label}" class="${optional ? 'toolbar-optional' : ''}">${icon(command)}</button>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
const brandIcon = new URL('../assets/icon.svg', import.meta.url).href;
const brandDarkIcon = new URL('../assets/icon-dark.svg', import.meta.url).href;
app.innerHTML = `
  <aside class="sidebar" id="sidebar">
    <div class="brand"><div class="brand-mark"><img id="brand-icon" src="${brandIcon}" alt="" /></div><div>Markdown<span>STUDIO</span></div></div>
    ${button('new', 'New document', 'plus', 'new-button')}
    ${button('open', 'Open file', 'folder', 'sidebar-button')}
    <section class="outline-section"><div class="section-label">DOCUMENT OUTLINE</div><nav id="outline" aria-label="Document headings"></nav></section>
    <section class="recent-section"><div class="recent-header"><button id="recent-toggle" aria-expanded="false" aria-controls="recent" title="Expand recent files">${icon('chevron')}<span>RECENT FILES</span><span id="recent-count">(0)</span></button><button id="clear-recent" data-action="clear-recent" title="Clear recent file history" hidden disabled>Clear</button></div><div id="recent" hidden><p class="empty-note">Your opened files will appear here.</p></div></section>
    <div class="sidebar-bottom">
      ${button('help', 'Getting started', 'help', 'sidebar-button')}
      <div class="theme-switch" role="group" aria-label="Color theme">${themes.map(item => `<button type="button" data-theme-option="${item.id}" aria-pressed="false" title="${item.label} theme">${icon(item.id === 'light' ? 'sun' : 'moon')}<span>${item.label}</span></button>`).join('')}</div>
      <div class="privacy"><span class="status-dot"></span> Local files. Your space.</div>
    </div>
    <div id="sidebar-resizer" role="separator" tabindex="0" aria-label="Resize sidebar" aria-controls="sidebar" aria-orientation="vertical" title="Drag to resize; Left/Right keys resize, Home/End set limits; double-click to reset"></div>
  </aside>
  <main>
    <div class="tabs-bar"><div id="tabs" role="tablist" aria-label="Open documents"></div>${button('new', 'New tab', 'plus', 'icon-only')}</div>
    <header class="workspace-bar topbar">
      <div class="document-name sr-only"><span id="filename">Welcome</span><span id="dirty-indicator"></span></div>
      <div class="workspace-navigation"><button type="button" id="sidebar-toggle" data-action="sidebar" aria-controls="sidebar" aria-expanded="true" aria-label="Hide sidebar" title="Hide sidebar (Ctrl+Shift+B)">${icon('sidebar')}</button><div class="mode-switch global-modes" role="group" aria-label="Editor mode"><button id="visual-mode" data-action="visual" class="selected" aria-pressed="true">Visual</button><button id="source-mode" data-action="source" aria-pressed="false">Source</button><button id="preview-mode" data-action="preview" aria-pressed="false">Source + Preview</button></div></div>
      <div class="workspace-actions">
        ${button('find', 'Find', 'search', 'quiet')}
        ${button('split', 'Split with...', 'split', 'split-control')}
        <div class="save-control"><div class="save-button">${button('save', 'Save', 'save')}<button type="button" data-action="save-menu" aria-label="More save actions" title="More save actions" aria-haspopup="menu" aria-controls="save-menu" aria-expanded="false">${icon('chevron')}</button></div><div id="save-menu" class="dropdown" role="menu" hidden><button type="button" data-action="save-all" role="menuitem">Save all files<kbd>Ctrl+Alt+S</kbd></button><button type="button" data-action="save-as" role="menuitem">Save as...<kbd>Ctrl+Shift+S</kbd></button></div></div>
        <div class="export-control"><button type="button" data-action="export-menu" class="primary" title="Export document" aria-haspopup="menu" aria-controls="export-menu" aria-expanded="false">${icon('export')}<span>Export</span>${icon('chevron')}</button><div id="export-menu" class="dropdown" role="menu" hidden>${button('export-docx', 'Word document (.docx)')}${button('export-pdf', 'PDF document (.pdf)')}</div></div>
      </div>
    </header>
    <div class="toolbar" role="toolbar" aria-label="Text formatting">
      <select id="heading" aria-label="Paragraph style"><option value="0">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option><option value="4">Heading 4</option><option value="5">Heading 5</option><option value="6">Heading 6</option></select>
      <span class="divider"></span>
      ${formatButton('bold', 'Bold')}${formatButton('italic', 'Italic')}${formatButton('strike', 'Strikethrough')}${formatButton('code', 'Inline code')}
      <span class="divider"></span>
      ${formatButton('bullet', 'Bullet list')}${formatButton('ordered', 'Numbered list')}${formatButton('task', 'Task list')}${formatButton('quote', 'Block quote', true)}
      <span class="divider"></span>
      ${button('link', 'Insert link', 'link', 'icon-only')}${button('image', 'Insert image', 'image', 'icon-only toolbar-optional')}${button('table', 'Insert table', 'table', 'icon-only toolbar-optional')}
      ${formatButton('codeblock', 'Code block', true)}${formatButton('rule', 'Horizontal rule', true)}
      <div class="toolbar-more"><button type="button" data-action="format-menu" aria-label="More formatting" title="More formatting" aria-haspopup="menu" aria-controls="format-menu" aria-expanded="false">${icon('more')}</button><div id="format-menu" class="dropdown" role="menu" hidden><button type="button" data-command="quote" role="menuitem">${icon('quote')}<span>Block quote</span><kbd>Ctrl+Shift+Q</kbd></button>${button('image', 'Insert image', 'image')}${button('table', 'Insert table', 'table')}<button type="button" data-command="codeblock" role="menuitem">${icon('codeblock')}<span>Code block</span><kbd>Ctrl+Shift+K</kbd></button><button type="button" data-command="rule" role="menuitem">${icon('rule')}<span>Horizontal rule</span></button></div></div>
      <span class="toolbar-spacer"></span>
      ${button('undo', 'Undo', 'undo', 'icon-only')}${button('redo', 'Redo', 'redo', 'icon-only')}
    </div>
    <div id="table-tools" hidden><span>TABLE</span>${button('row', '+ Row')}${button('column', '+ Column')}${button('delete-row', 'Remove row')}${button('delete-column', 'Remove column')}${button('delete-table', 'Remove table')}</div>
    <section id="find-panel" hidden aria-label="Find and replace">
      <input id="find-text" aria-label="Find text" placeholder="Find Markdown text" />
      <input id="replace-text" aria-label="Replacement text" placeholder="Replace with" />
      <label><input id="find-case" type="checkbox" checked />Match case</label><label><input id="find-word" type="checkbox" />Whole word</label><label><input id="find-regex" type="checkbox" />Regex</label>
      ${button('find-previous', 'Previous')}${button('find-next', 'Find next')}${button('replace-one', 'Replace')}${button('replace-all', 'Replace all')}<span id="find-result" role="status"></span>${button('find-close', 'Close')}
    </section>
    <div id="recovery-banner" hidden>Unsaved drafts from your last session are available. ${button('recover', 'Recover drafts')}${button('dismiss-recovery', 'Dismiss')}</div>
    <div class="canvas" id="canvas"><article class="paper" id="visual-editor" aria-label="Visual Markdown editor"></article><textarea id="source-editor" aria-label="Markdown source" spellcheck="false" hidden></textarea></div>
    <footer><span id="word-count">0 words</span><span id="save-status" class="sr-only" aria-live="polite">Ready to write</span></footer>
  </main>
  <div id="notification" role="status" hidden></div>
  <dialog id="image-storage-dialog" aria-labelledby="image-storage-title"><form method="dialog">
    <h2 id="image-storage-title">Store this image</h2>
    <label><input type="radio" name="image-storage" value="embedded" checked />Embed in document (portable, larger Markdown file)</label>
    <label><input type="radio" name="image-storage" value="assets" />Save in this document's assets folder</label>
    <p id="image-storage-note">Save the document first to use an assets folder. Keep the folder with the document when sharing or moving it.</p>
    <div class="dialog-actions"><button value="cancel">Cancel</button><button value="insert" class="primary">Insert image</button></div>
  </form></dialog>
  <dialog id="link-dialog"><form method="dialog"><h2>Add a link</h2><label>Link text<input id="link-label" required /></label><label>Web address<input id="link-url" type="url" placeholder="https://example.com" required /></label><div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="insert" class="primary">Insert link</button></div></form></dialog>
  <dialog id="table-dialog" aria-labelledby="table-title"><form method="dialog" id="table-form">
    <h2 id="table-title">Insert table</h2>
    <div class="table-dimensions"><label>Columns<input id="table-columns" type="number" min="1" max="${MAX_TABLE_COLUMNS}" step="1" value="3" required autofocus /></label><label>Rows<input id="table-rows" type="number" min="1" max="${MAX_TABLE_ROWS}" step="1" value="4" required /></label></div>
    <p>Rows include the header. Up to ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLUMNS} columns.</p>
    <p id="table-error" role="alert" hidden></p>
    <div class="dialog-actions"><button id="table-cancel" type="button" value="cancel">Cancel</button><button value="insert" class="primary">Insert table</button></div>
  </form></dialog>
  <dialog id="split-dialog" aria-labelledby="split-title"><form method="dialog" id="split-form">
    <h2 id="split-title">Split with another file</h2>
    <p id="split-description"></p>
    <div id="split-documents" role="group" aria-label="Other open documents"></div>
    <p>These two files become one paired tab. Your other tabs stay independent.</p>
    <p id="split-error" role="alert" hidden></p>
    <div class="dialog-actions"><button id="split-cancel" type="button">Cancel</button></div>
  </form></dialog>
  <div id="tab-context-menu" popover="auto" role="menu" aria-label="Tab actions"></div>
  <dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title">
    <h2 id="shortcuts-title">Keyboard shortcuts</h2>
    <p>Formatting works in Visual and Source modes, in the active side of a split. Shortcuts do not format your document while you type in Find, dialogs, or the language picker.</p>
    <table class="shortcut-table"><tbody>
      ${formattingShortcuts.map(item => `<tr><th scope="row">${item.label}</th><td><kbd>${item.accelerator.replace('CmdOrCtrl', 'Ctrl')}</kbd></td></tr>`).join('')}
      <tr><th scope="row">Paragraph / Headings 1-6</th><td><kbd>Ctrl+0 / Ctrl+1-6</kbd></td></tr>
      <tr><th scope="row">Insert link</th><td><kbd>Ctrl+K</kbd></td></tr>
      <tr><th scope="row">Insert image</th><td><kbd>Ctrl+Shift+I</kbd></td></tr>
      <tr><th scope="row">Insert table</th><td><kbd>Ctrl+T</kbd></td></tr>
      <tr><th scope="row">Code block</th><td><kbd>Ctrl+Shift+K</kbd></td></tr>
      <tr><th scope="row">Undo / Redo</th><td><kbd>Ctrl+Z / Ctrl+Shift+Z</kbd></td></tr>
      <tr><th scope="row">Visual / Source</th><td><kbd>Ctrl+/</kbd></td></tr>
      <tr><th scope="row">Next / Previous tab</th><td><kbd>Ctrl+Tab / Ctrl+Shift+Tab</kbd></td></tr>
      <tr><th scope="row">Toggle sidebar</th><td><kbd>Ctrl+Shift+B</kbd></td></tr>
      <tr><th colspan="2" scope="colgroup">Files and navigation</th></tr>
      <tr><th scope="row">New / Open</th><td><kbd>Ctrl+N / Ctrl+O</kbd></td></tr>
      <tr><th scope="row">Save / Save as</th><td><kbd>Ctrl+S / Ctrl+Shift+S</kbd></td></tr>
      <tr><th scope="row">Save all files</th><td><kbd>Ctrl+Alt+S</kbd></td></tr>
      <tr><th scope="row">Close active file</th><td><kbd>Ctrl+W</kbd></td></tr>
      <tr><th scope="row">Find and replace</th><td><kbd>Ctrl+F</kbd></td></tr>
      <tr><th scope="row">Focus mode</th><td><kbd>F9</kbd></td></tr>
    </tbody></table>
    <form method="dialog"><button class="primary">Close</button></form>
  </dialog>
  <dialog id="help-dialog">
    <h2>Your writing desk, explained</h2>
    <p><b>Tabs:</b> Open and New keep other files open. Each tab keeps its edits and undo history. Click its x to close; a dot means unsaved changes. Save and Export use the active tab; Save all saves every modified tab.</p>
    <p><b>Split tabs:</b> choose <b>Split with...</b> or right-click a tab, then choose another open file from its thumbnail preview card. Previews include current unsaved edits. One paired tab displays exactly those two files side by side. Other tabs still open alone; clicking the pair restores both files. Each side keeps its own Visual/Source mode and undo. Click a side to target formatting, Find, Save, and Export. Drag the divider or focus it and use Left/Right to resize. <b>Unsplit</b> restores individual tabs without closing files. The pair's x closes both files with unsaved-change prompts; Ctrl+W closes only the active file.</p>
    <p><b>Themes:</b> choose Light or Dark at the bottom of the sidebar, or use View &gt; Color theme when the sidebar is hidden. Recent Files starts collapsed; expand its heading to browse history. This preference is remembered, and the outline gets the remaining space.</p>
    <p><b>Save:</b> the Save button saves the active file. Its arrow opens Save All and Save As. Hover over tools for their keyboard shortcuts, or open ${button('shortcuts', 'Keyboard shortcuts')} (F1). At narrower widths, More formatting keeps less-used tools available.</p>
    <p><b>Visual</b> works like a word processor. Type <code># </code> for a heading, <code>- </code> for a list, or use the toolbar.</p>
    <p><b>Code blocks</b> have a searchable language selector and Copy button at the bottom-right. Select PowerShell, Python, JSON, or another supported language for syntax colors. Code contents are never reformatted or executed. PDF and Word include the colors, not the controls.</p>
    <p><b>Sidebar</b>: drag its right edge to resize, or focus the edge and use Left/Right (Home/End set limits). Double-click the edge to reset. Width is remembered between launches and limited to leave room for editing. Use the button to the left of Visual/Source or Ctrl+Shift+B to toggle outline/recent files. <b>View &gt; Focus mode</b> or F9 also hides the document header; Escape restores your previous sidebar preference.</p>
    <p><b>Find</b>: click Find or press Ctrl+F to open or close the find bar. Close and Escape also dismiss it; the search and replacement text are retained.</p>
    <p><b>Right-click</b> for Formatting, Paragraph (Heading 1-6 or normal text), Insert, Copy / Paste As, and spelling suggestions. Choose <b>Table &gt; Insert table</b> or <b>Insert &gt; Table</b> to choose rows and columns. Row/column editing controls become available inside a table.</p>
    <p><b>Insert</b> includes images, links, tables, code fences, Mermaid, horizontal lines, a marked table of contents, and paragraphs before/after. Use <b>Update table of contents</b> after changing headings. Footnotes, link references, math, and YAML insert editable syntax in <b>Source mode</b>. From Visual mode these go at the end, except YAML at the top. Math, footnotes, and YAML do not yet have formatted rendering or structured export support.</p>
    <p><b>Source</b> lets you edit the exact Markdown text. Use it for advanced syntax or HTML the visual editor doesn't support. Visual editing may normalize Markdown syntax; switching Visual/Source modes resets that tab's undo history.</p>
    <p><b>Save</b> keeps a regular UTF-8 Markdown file. <b>Export</b> creates a separate Word or PDF document, including the active tab's unsaved edits.</p>
    <p>Insert, paste or drop an image, then choose embedding or a saved document's <b>assets</b> folder. Clipboard bitmaps become PNG. Right-click an image for <b>Copy image</b>. Embedded images travel with the Markdown; relative assets must be kept with its folder. Remote images are not fetched. Word supports PNG, JPEG, and GIF; PDF also supports WebP.</p>
    <p><b>Ctrl+N</b> New tab &nbsp; <b>Ctrl+O</b> Open &nbsp; <b>Ctrl+S</b> Save<br><b>Ctrl+W</b> Close tab &nbsp; <b>Ctrl+Tab</b> Next tab<br><b>Ctrl+Alt+S</b> Save all &nbsp; <b>Ctrl+P</b> PDF<br><b>Ctrl+0-6</b> Paragraph / Headings &nbsp; <b>Ctrl+T</b> Table<br><b>Ctrl+F</b> Find &nbsp; <b>Ctrl+/</b> Switch mode &nbsp; <b>F9</b> Focus</p>
    <p><b>Source + Preview</b> shows a read-only rendering beside your editable Markdown, with optional synchronized scrolling. Mermaid diagrams render locally. Use More formatting or Insert for a Mermaid template and to update a marked table of contents.</p>
    <p>Local draft recovery covers every unsaved tab. Save regularly; recovery is not a substitute for backups. Rendered math is not supported.</p>
    <form method="dialog"><button class="primary">Let's write</button></form>
  </dialog>
`;

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
element('format-menu').insertAdjacentHTML('beforeend', '<button type="button" role="menuitem" data-action="insert:toc">Insert table of contents</button><button type="button" role="menuitem" data-action="insert:toc-update">Update table of contents</button><button type="button" role="menuitem" data-action="insert:mermaid">Mermaid diagram</button>');
for (const shortcut of formattingShortcuts) {
  for (const control of document.querySelectorAll<HTMLElement>(`[data-command="${shortcut.command}"]`)) {
    control.title = `${shortcut.label} (${shortcut.accelerator.replace('CmdOrCtrl', 'Ctrl')})`;
    control.setAttribute('aria-keyshortcuts', shortcut.accelerator.replace('CmdOrCtrl', 'Control'));
  }
}
const actionShortcuts: Record<string, string> = {
  new: 'Ctrl+N', open: 'Ctrl+O', save: 'Ctrl+S', 'save-as': 'Ctrl+Shift+S', 'save-all': 'Ctrl+Alt+S',
  find: 'Ctrl+F', link: 'Ctrl+K', image: 'Ctrl+Shift+I', table: 'Ctrl+T',
  undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', shortcuts: 'F1',
};
for (const control of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  const shortcut = actionShortcuts[control.dataset.action!];
  if (!shortcut) continue;
  const label = control.querySelector('span')?.textContent ?? control.textContent ?? '';
  control.title = `${label.trim()} (${shortcut})`;
  control.setAttribute('aria-keyshortcuts', shortcut.replaceAll('Ctrl', 'Control'));
  if (control.closest('.dropdown') && !control.querySelector('kbd')) {
    const hint = document.createElement('kbd');
    hint.textContent = shortcut;
    control.append(hint);
  }
}
for (const control of document.querySelectorAll<HTMLElement>('[data-command="codeblock"]')) {
  control.title = 'Code block (Ctrl+Shift+K)';
  control.setAttribute('aria-keyshortcuts', 'Control+Shift+K');
}
let source = element<HTMLTextAreaElement>('source-editor');
let visual = element<HTMLElement>('visual-editor');
const initialPane = createPane(visual, source);
let documentId = '';
let markdown = welcome;
let savedMarkdown = welcome;
let documentPath: string | null = null;
let documentName = 'Welcome';
let mode: 'visual' | 'source' = 'visual';
let busy = false;
let sourceUndo: string[] = [];
let sourceRedo: string[] = [];
let searchMatches: SearchMatch[] = [];
let searchIndex = -1;
let searchTimer: ReturnType<typeof setTimeout>;
let searchRevision = 0;
let previewTimer: ReturnType<typeof setTimeout>;
let draftTimer: ReturnType<typeof setTimeout>;
let notificationTimer: ReturnType<typeof setTimeout>;
interface RecoveryDraft { content: string; name: string }
let recovery: RecoveryDraft[] = [];
interface DocumentTab {
  id: string;
  markdown: string;
  savedMarkdown: string;
  name: string;
  path: string | null;
  mode: 'visual' | 'source';
  editor: Editor;
  visual: HTMLElement;
  undo: string[];
  redo: string[];
  selection: [number, number];
  sourceScroll: number;
  canvasScroll: number;
  source: HTMLTextAreaElement;
  pane: HTMLElement;
  viewport: HTMLElement;
  preview?: boolean;
  previewMarkdown?: string;
}
const tabs: DocumentTab[] = [];
const pairs: SplitPair[] = [];
let activeTab: DocumentTab | undefined;
let untitledCount = 0;
let contextImageSource: string | null = null;
const draftKey = 'markdown-studio-draft-v1';
const themeKey = 'markdown-studio-theme';
const sidebarKey = 'markdown-studio-sidebar-hidden';
const sidebarWidthKey = 'markdown-studio-sidebar-width';
const recentExpandedKey = 'markdown-studio-recent-expanded';
let sidebarHidden = false;
let preferredSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
let recentExpanded = false;
let theme: Theme = 'light';
let tableDocumentId: string | null = null;
let linkDocumentId: string | null = null;
let splitDocumentId: string | null = null;
try {
  const savedTheme = restoreTheme(localStorage.getItem(themeKey));
  if (savedTheme) theme = savedTheme;
  sidebarHidden = localStorage.getItem(sidebarKey) === 'true';
  recentExpanded = localStorage.getItem(recentExpandedKey) === 'true';
  const raw = localStorage.getItem(draftKey);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    const drafts = parsed && typeof parsed === 'object' && 'documents' in parsed ? parsed.documents : [parsed];
    if (!Array.isArray(drafts) || !drafts.every((draft: unknown): draft is RecoveryDraft => Boolean(
      draft && typeof draft === 'object' && 'content' in draft && typeof draft.content === 'string' && 'name' in draft && typeof draft.name === 'string',
    ))) throw new Error('The saved drafts are not valid.');
    recovery = drafts;
    element('recovery-banner').hidden = !recovery.length;
  }
} catch (error) { notify(`Draft/settings storage could not be read: ${String(error)}`, true); }
try {
  const storedWidth = localStorage.getItem(sidebarWidthKey);
  if (storedWidth !== null) {
    if (!storedWidth.trim() || !Number.isFinite(Number(storedWidth))) throw new Error('The saved sidebar width is not valid.');
    preferredSidebarWidth = sidebarWidth(Number(storedWidth), MAX_SIDEBAR_WIDTH + 480);
  }
} catch (error) { notify(`Sidebar width could not be read: ${String(error)}`, true); }
updateThemeUI();
updateSidebar();
updateSidebarWidth();
setFindOpen(false);
updateRecentDisclosure();

function updateThemeUI(): void {
  document.documentElement.dataset.theme = theme;
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-theme-option]')) {
    const selected = control.dataset.themeOption === theme;
    control.classList.toggle('selected', selected);
    control.setAttribute('aria-pressed', String(selected));
  }
  element<HTMLImageElement>('brand-icon').src = theme === 'light' ? brandIcon : brandDarkIcon;
}

function updateRecentDisclosure(): void {
  element('recent').hidden = !recentExpanded;
  element('clear-recent').hidden = !recentExpanded;
  const toggle = element<HTMLButtonElement>('recent-toggle');
  toggle.setAttribute('aria-expanded', String(recentExpanded));
  toggle.title = `${recentExpanded ? 'Collapse' : 'Expand'} recent files`;
}

function updateSidebar(): void {
  const visible = !sidebarHidden && !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('sidebar-hidden', sidebarHidden);
  element('sidebar').hidden = !visible;
  const control = element<HTMLButtonElement>('sidebar-toggle');
  control.setAttribute('aria-expanded', String(visible));
  control.setAttribute('aria-label', visible ? 'Hide sidebar' : 'Show sidebar');
  control.title = `${visible ? 'Hide' : 'Show'} sidebar (Ctrl+Shift+B)`;
}

function setFocusMode(enabled: boolean): void {
  document.body.classList.toggle('focus-mode', enabled);
  updateSidebar();
}

function updateSidebarWidth(): void {
  const width = sidebarWidth(preferredSidebarWidth, window.innerWidth);
  element('sidebar').style.width = `${width}px`;
  const divider = element('sidebar-resizer');
  divider.setAttribute('aria-valuemin', String(MIN_SIDEBAR_WIDTH));
  divider.setAttribute('aria-valuemax', String(sidebarWidth(MAX_SIDEBAR_WIDTH, window.innerWidth)));
  divider.setAttribute('aria-valuenow', String(width));
  divider.setAttribute('aria-valuetext', `${width} pixels`);
}

function rememberSidebarWidth(): void {
  try { localStorage.setItem(sidebarWidthKey, String(preferredSidebarWidth)); }
  catch (error) { notify(`Sidebar width changed, but could not be remembered: ${String(error)}`, true); }
}

function setFindOpen(open: boolean): void {
  const panel = element('find-panel');
  const returnToEditor = !open && panel.contains(document.activeElement);
  panel.hidden = !open;
  const control = document.querySelector<HTMLButtonElement>('[data-action="find"]')!;
  control.setAttribute('aria-controls', 'find-panel');
  control.setAttribute('aria-expanded', String(open));
  if (open) { element<HTMLInputElement>('find-text').focus(); scheduleSearch(); }
  else if (returnToEditor) {
    if (mode === 'source') source.focus();
    else editor.commands.focus();
  }
  if (!open) {
    searchRevision++;
    clearTimeout(searchTimer);
    for (const tab of tabs) tab.pane.querySelector('.source-highlights')?.replaceChildren();
  }
}

function refreshPreview(tab: DocumentTab): void {
  if (!tab.preview || tab.previewMarkdown === tab.markdown) return;
  const content = tab.viewport.querySelector<HTMLElement>('.document-preview')!;
  content.innerHTML = documentPreviewHTML(tab.markdown, tab.id);
  const used = new Map<string, number>();
  const outline = headings(tab.markdown);
  content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
    if (outline[index]) heading.id = headingAnchor(outline[index].text, used);
  });
  tab.previewMarkdown = tab.markdown;
  void renderMermaidBlocks(content).catch(error => notify(`Preview diagrams failed: ${String(error)}`, true));
}

function togglePreview(): void {
  if (!activeTab) return;
  const enabled = !activeTab.preview;
  if (mode !== 'source') switchMode('source');
  activeTab.preview = enabled;
  showMode();
  refreshPreview(activeTab);
  source.focus();
}

function searchKey(): string {
  return JSON.stringify([
    element<HTMLInputElement>('find-text').value,
    element<HTMLInputElement>('find-case').checked, element<HTMLInputElement>('find-word').checked,
    element<HTMLInputElement>('find-regex').checked, documentId,
  ]);
}
function searchText(): string { return markdown.replace(/\r\n/g, '\n'); }
let lastSearchKey = '';
let lastSearchText = '';

function requestSearch(text: string): Promise<SearchResult> {
  const worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Search exceeded two seconds. Simplify the regular expression or narrow the search.'));
    }, 2000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<Result<SearchResult>>) => {
      finish();
      if (event.data.ok) resolve(event.data.value);
      else reject(new Error(event.data.error));
    };
    worker.onerror = event => { finish(); reject(new Error(`Search worker failed: ${event.message}`)); };
    worker.postMessage({
      text, query: element<HTMLInputElement>('find-text').value,
      replacement: element<HTMLInputElement>('replace-text').value,
      options: {
        caseSensitive: element<HTMLInputElement>('find-case').checked,
        wholeWord: element<HTMLInputElement>('find-word').checked,
        regex: element<HTMLInputElement>('find-regex').checked,
      },
    });
  });
}

function paintSearch(): void {
  for (const tab of tabs) {
    const layer = tab.pane.querySelector<HTMLElement>('.source-highlights')!;
    layer.replaceChildren();
    if (tab !== activeTab || element('find-panel').hidden || !searchMatches.length) continue;
    let position = 0;
    for (const [index, match] of searchMatches.entries()) {
      layer.append(document.createTextNode(source.value.slice(position, match.from)));
      const mark = document.createElement('mark');
      mark.classList.toggle('current-match', index === searchIndex);
      mark.textContent = source.value.slice(match.from, match.to) || '\u200b';
      layer.append(mark);
      position = match.to;
    }
    layer.append(document.createTextNode(source.value.slice(position) + '\n'));
    layer.style.width = `${source.clientWidth}px`;
    layer.scrollTop = source.scrollTop;
    layer.scrollLeft = source.scrollLeft;
  }
}

async function refreshSearch(): Promise<SearchResult | null> {
  const revision = ++searchRevision;
  const text = searchText();
  const key = searchKey();
  try {
    const result = await requestSearch(text);
    if (revision !== searchRevision || key !== searchKey() || text !== searchText()) return null;
    if (lastSearchKey !== key || lastSearchText !== text) searchIndex = -1;
    lastSearchKey = key;
    lastSearchText = text;
    searchMatches = result.matches;
    element('find-result').textContent = `${searchIndex >= 0 ? `${searchIndex + 1} of ` : ''}${result.matches.length.toLocaleString()}${result.truncated ? '+' : ''} matches`;
    paintSearch();
    return result;
  } catch (error) {
    if (revision !== searchRevision) return null;
    searchMatches = [];
    paintSearch();
    throw error;
  }
}

function scheduleSearch(): void {
  clearTimeout(searchTimer);
  searchRevision++;
  searchTimer = setTimeout(() => {
    void refreshSearch().catch(error => {
      element('find-result').textContent = error instanceof Error ? error.message : String(error);
    });
  }, 180);
}

async function navigateSearch(backward = false): Promise<void> {
  clearTimeout(searchTimer);
  if (!element<HTMLInputElement>('find-text').value) throw new Error('Enter some text to find.');
  if (mode !== 'source') switchMode('source');
  const result = await refreshSearch();
  if (!result?.matches.length) return;
  searchIndex = (searchIndex + (backward ? (searchIndex < 0 ? 0 : -1) : 1) + result.matches.length) % result.matches.length;
  const match = result.matches[searchIndex];
  source.focus();
  source.setSelectionRange(match.from, match.to);
  source.scrollTop = Math.max(0, markdown.slice(0, match.from).split('\n').length * 24 - 100);
  element('find-result').textContent = `${searchIndex + 1} of ${result.matches.length.toLocaleString()}${result.truncated ? '+' : ''} matches`;
  paintSearch();
}

async function replaceFound(all: boolean): Promise<void> {
  clearTimeout(searchTimer);
  if (!element<HTMLInputElement>('find-text').value) throw new Error('Enter some text to find.');
  if (mode !== 'source') switchMode('source');
  const result = await refreshSearch();
  if (!result) throw new Error('The search changed. Try replacing again.');
  if (result.truncated) throw new Error('More than 10,000 matches. Narrow the search before replacing.');
  const matches = all ? result.matches : result.matches.slice(Math.max(0, searchIndex), Math.max(0, searchIndex) + 1);
  const text = replaceSearchMatches(searchText(), matches);
  source.value = text;
  changed(text);
  await refreshSearch();
  element('find-result').textContent = `${matches.length.toLocaleString()} replaced`;
}

async function applyTheme(value: Theme, persist = true): Promise<void> {
  theme = value;
  updateThemeUI();
  if (persist) {
    try { localStorage.setItem(themeKey, theme); }
    catch (error) { notify(`Theme changed, but could not be remembered: ${String(error)}`, true); }
  }
  unwrap(await window.studio.setTheme(theme));
}

function createEditor(content: string, id = documentId, host = visual): Editor {
  const LocalImage = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: element => element.getAttribute('data-studio-source') ?? element.getAttribute('src'),
        },
      };
    },
    renderHTML({ HTMLAttributes }) {
      const source = String(HTMLAttributes.src ?? '');
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: imageDisplayURL(source, id), 'data-studio-source': source })];
    },
  });
  return new Editor({
  element: host,
  extensions: [
    StarterKit.configure({ trailingNode: false, codeBlock: false, link: { openOnClick: false, protocols: ['https', 'http', 'mailto'] } }),
    LanguageCodeBlock.configure({
      copyCode: code => { void run(async () => { unwrap(await window.studio.writeClipboard(code)); notify('Code copied.'); }); },
      reportError: message => notify(message, true),
    }),
    LocalImage.configure({ allowBase64: true }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList, TaskItem.configure({ nested: true }), ContentsNode, Markdown,
  ],
  content,
  contentType: 'markdown',
  editorProps: { attributes: { 'aria-label': 'Document text', spellcheck: 'true' } },
  onUpdate: ({ editor: updated }) => {
    if (updated === editor && mode === 'visual') changed(updated.getMarkdown());
    else {
      const tab = tabs.find(tab => tab.id === id);
      if (tab?.mode === 'visual') {
        tab.markdown = updated.getMarkdown();
        update();
        scheduleDraft();
      }
    }
  },
  onSelectionUpdate: ({ editor: updated }) => { if (updated === editor) updateToolbar(); },
  });
}
let editor = createEditor(markdown);

function createPane(host: HTMLElement, text: HTMLTextAreaElement): { pane: HTMLElement; viewport: HTMLElement } {
  const pane = document.createElement('section');
  pane.className = 'document-pane';
  pane.setAttribute('role', 'region');
  const header = document.createElement('div');
  header.className = 'pane-header';
  header.hidden = true;
  header.innerHTML = '<span class="pane-title"></span><div class="pane-modes" role="group" aria-label="Editor mode"><button type="button" data-pane-mode="visual">Visual</button><button type="button" data-pane-mode="source">Source</button><button type="button" data-pane-mode="preview">Source + Preview</button></div>';
  const viewport = document.createElement('div');
  viewport.className = 'pane-content';
  text.classList.add('document-source');
  const surface = document.createElement('div');
  surface.className = 'source-surface';
  const highlights = document.createElement('pre');
  highlights.className = 'source-highlights';
  highlights.setAttribute('aria-hidden', 'true');
  surface.append(highlights, text);
  const preview = document.createElement('section');
  preview.className = 'live-preview';
  preview.setAttribute('aria-label', 'Read-only Markdown preview');
  preview.hidden = true;
  preview.innerHTML = '<div class="preview-heading">Preview (read-only)<label><input class="preview-sync" type="checkbox" checked />Sync scrolling</label></div><article class="document-preview"></article>';
  let synchronizing = false;
  const sync = (from: HTMLElement, to: HTMLElement) => {
    if (synchronizing || !preview.querySelector<HTMLInputElement>('.preview-sync')!.checked) return;
    synchronizing = true;
    to.scrollTop = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight) * Math.max(0, to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => { synchronizing = false; });
  };
  text.addEventListener('scroll', () => {
    highlights.scrollTop = text.scrollTop;
    highlights.scrollLeft = text.scrollLeft;
    if (!preview.hidden) sync(text, preview);
  });
  preview.addEventListener('scroll', () => sync(preview, text));
  viewport.append(host, surface, preview);
  pane.append(header, viewport);
  return { pane, viewport };
}

function visibleTabs(): DocumentTab[] {
  const pair = pairFor(pairs, documentId);
  const ids = pair ? [pair.leftId, pair.rightId] : [documentId];
  return ids.map(id => {
    const tab = tabs.find(tab => tab.id === id);
    if (!tab) throw new Error('A visible document is no longer open.');
    return tab;
  });
}

function resizeSplit(pair: SplitPair, ratio: number): void {
  pair.ratio = splitRatio(ratio);
  element('canvas').style.gridTemplateColumns = `minmax(0, ${pair.ratio}fr) 8px minmax(0, ${1 - pair.ratio}fr)`;
  element('canvas').querySelector('[role="separator"]')?.setAttribute('aria-valuenow', String(Math.round(pair.ratio * 100)));
}

function splitDivider(pair: SplitPair): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'split-divider';
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize split editors');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-valuemin', '25');
  divider.setAttribute('aria-valuemax', '75');
  divider.title = 'Drag to resize; Left/Right keys resize, Home/End set limits';
  let dragging = false;
  divider.addEventListener('pointerdown', event => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    divider.setPointerCapture(event.pointerId);
    divider.focus();
  });
  divider.addEventListener('pointermove', event => {
    if (!dragging || busy) return;
    const bounds = element('canvas').getBoundingClientRect();
    resizeSplit(pair, (event.clientX - bounds.left) / bounds.width);
  });
  divider.addEventListener('lostpointercapture', () => { dragging = false; });
  divider.addEventListener('pointerup', event => {
    dragging = false;
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!busy) resizeSplit(pair, event.key === 'Home' ? 0.25 : event.key === 'End' ? 0.75 : pair.ratio + (event.key === 'ArrowLeft' ? -0.05 : 0.05));
  });
  return divider;
}

function updatePaneHeaders(): void {
  const pair = pairFor(pairs, documentId);
  for (const tab of tabs) {
    tab.pane.classList.toggle('active-pane', tab === activeTab);
    tab.pane.setAttribute('aria-label', `${tab.name}${tab === activeTab ? ', active editor' : ''}`);
    const header = tab.pane.querySelector<HTMLElement>('.pane-header')!;
    header.hidden = !pair;
    header.querySelector<HTMLElement>('.pane-title')!.textContent = `${tab.name}${tab.markdown !== tab.savedMarkdown ? ' \u2022' : ''}`;
    for (const control of header.querySelectorAll<HTMLButtonElement>('[data-pane-mode]')) {
      const selected = control.dataset.paneMode === (tab.preview ? 'preview' : tab.mode);
      control.classList.toggle('selected', selected);
      control.setAttribute('aria-pressed', String(selected));
    }
  }
  const control = document.querySelector<HTMLButtonElement>('[data-action="split"]')!;
  const label = pair ? 'Unsplit' : 'Split with...';
  control.querySelector('span')!.textContent = label;
  control.title = label;
  control.setAttribute('aria-pressed', String(Boolean(pair)));
  control.disabled = !pair && !tabs.some(tab => tab.id !== documentId && !pairFor(pairs, tab.id));
}

function showWorkspace(): void {
  const root = element('canvas');
  const visible = visibleTabs();
  const pair = pairFor(pairs, documentId);
  root.classList.toggle('is-split', Boolean(pair));
  document.querySelector<HTMLElement>('.global-modes')!.hidden = Boolean(pair);
  if (pair) resizeSplit(pair, pair.ratio);
  else root.style.removeProperty('grid-template-columns');
  const mounted = [...root.querySelectorAll<HTMLElement>(':scope > .document-pane')];
  if (mounted.length !== visible.length || mounted.some((pane, index) => pane !== visible[index].pane)) {
    for (const tab of tabs) {
      if (tab.pane.parentElement === root) {
        tab.canvasScroll = tab.viewport.scrollTop;
        tab.sourceScroll = tab.source.scrollTop;
      }
    }
    root.replaceChildren(...(pair ? [visible[0].pane, splitDivider(pair), visible[1].pane] : [visible[0].pane]));
    for (const tab of visible) {
      tab.viewport.scrollTop = tab.canvasScroll;
      tab.source.scrollTop = tab.sourceScroll;
    }
  }
  for (const tab of tabs) {
    tab.visual.removeAttribute('id');
    tab.source.removeAttribute('id');
  }
  visual.id = 'visual-editor';
  source.id = 'source-editor';
  if (pair) resizeSplit(pair, pair.ratio);
  root.setAttribute('role', 'tabpanel');
  root.setAttribute('aria-labelledby', `tab-${pair?.leftId ?? documentId}`);
  showMode();
}

function captureTab(): void {
  if (!activeTab) return;
  Object.assign(activeTab, {
    markdown, savedMarkdown, name: documentName, path: documentPath, mode, editor, visual,
    undo: sourceUndo, redo: sourceRedo,
    selection: [source.selectionStart, source.selectionEnd],
    sourceScroll: source.scrollTop, canvasScroll: activeTab.viewport.scrollTop,
  });
}

function renderTabs(): void {
  captureTab();
  const list = element('tabs');
  list.replaceChildren();
  for (const group of groupTabs(tabs.map(tab => tab.id), pairs)) {
    const members = group.documentIds.map(id => tabs.find(tab => tab.id === id)!);
    const selected = group.documentIds.includes(documentId);
    const label = members.map(tab => `${tab.name}${tab.markdown !== tab.savedMarkdown ? ' \u2022' : ''}`).join(' | ');
    const wrapper = document.createElement('div');
    wrapper.className = `document-tab${selected ? ' selected' : ''}${group.pair ? ' paired-tab' : ''}`;
    wrapper.dataset.documentId = group.id;
    if (group.pair) wrapper.dataset.paired = 'true';
    const select = document.createElement('button');
    select.className = 'tab-select';
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(selected));
    select.id = `tab-${group.id}`;
    select.setAttribute('aria-controls', 'canvas');
    select.setAttribute('aria-label', `${group.pair ? 'Split pair: ' : ''}${members.map(tab => `${tab.name}${tab.markdown !== tab.savedMarkdown ? ', unsaved changes' : ''}`).join(' and ')}`);
    select.tabIndex = selected ? 0 : -1;
    select.title = members.map(tab => tab.path ?? tab.name).join(' | ');
    select.textContent = `${group.pair ? '\u25eb ' : ''}${label}`;
    select.addEventListener('click', () => { void run(async () => activateTab(group.pair?.activeId ?? group.id)); });
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '\u00d7';
    close.title = `Close ${members.map(tab => tab.name).join(' and ')}`;
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => { void run(async () => closeGroup(group.documentIds)); });
    wrapper.addEventListener('contextmenu', event => {
      event.preventDefault();
      showTabMenu(event, group.pair?.activeId ?? group.id);
    });
    wrapper.append(select, close);
    list.append(wrapper);
  }
}

function showMode(): void {
  source.hidden = mode !== 'source';
  source.closest<HTMLElement>('.source-surface')!.hidden = mode !== 'source';
  visual.hidden = mode !== 'visual';
  const preview = Boolean(activeTab?.preview && mode === 'source');
  activeTab?.viewport.classList.toggle('has-preview', preview);
  if (activeTab) activeTab.viewport.querySelector<HTMLElement>('.live-preview')!.hidden = !preview;
  for (const type of ['visual', 'source'] as const) {
    element(`${type}-mode`).classList.toggle('selected', mode === type && !preview);
    element(`${type}-mode`).setAttribute('aria-pressed', String(mode === type && !preview));
  }
  element('preview-mode').classList.toggle('selected', preview);
  element('preview-mode').setAttribute('aria-pressed', String(preview));
  document.querySelector('.toolbar')!.classList.toggle('source-toolbar', mode === 'source');
  if (activeTab) activeTab.mode = mode;
  updatePaneHeaders();
}

function activateTab(id: string): void {
  const next = tabs.find(tab => tab.id === id);
  if (!next) throw new Error('This tab is no longer open.');
  if (next === activeTab) return;
  captureTab();
  activeTab = next;
  documentId = next.id;
  markdown = next.markdown;
  savedMarkdown = next.savedMarkdown;
  documentName = next.name;
  documentPath = next.path;
  mode = next.mode;
  editor = next.editor;
  visual = next.visual;
  source = next.source;
  const pair = pairFor(pairs, id);
  if (pair) pair.activeId = id;
  sourceUndo = next.undo;
  sourceRedo = next.redo;
  showWorkspace();
  source.setSelectionRange(...next.selection);
  source.scrollTop = next.sourceScroll;
  next.viewport.scrollTop = next.canvasScroll;
  searchMatches = [];
  searchIndex = -1;
  element('find-result').textContent = '';
  editor.setEditable(!busy, false);
  source.readOnly = busy;
  update();
  element('tabs').querySelector<HTMLElement>('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function addTab(id: string, content: string, name: string, file: string | null, saved = true): void {
  if (tabs.some(tab => tab.id === id)) { activateTab(id); return; }
  const host = document.createElement('article');
  host.className = 'paper';
  host.setAttribute('aria-label', 'Visual Markdown editor');
  const text = document.createElement('textarea');
  text.setAttribute('aria-label', 'Markdown source');
  text.spellcheck = false;
  text.value = content;
  text.hidden = mode !== 'source';
  host.hidden = mode !== 'visual';
  const pane = createPane(host, text);
  pane.pane.dataset.documentId = id;
  const tab: DocumentTab = {
    id, markdown: content, savedMarkdown: saved ? content : '', name, path: file, mode,
    editor: createEditor(content, id, host), visual: host, undo: [], redo: [],
    selection: [0, 0], sourceScroll: 0, canvasScroll: 0,
    source: text, ...pane,
  };
  tabs.push(tab);
  activateTab(id);
  storeDraft();
}

async function newTab(): Promise<void> {
  const id = unwrap(await window.studio.newDocument());
  untitledCount++;
  addTab(id, '', untitledCount === 1 ? 'Untitled.md' : `Untitled ${untitledCount}.md`, null);
}

function unsplit(): void {
  const pair = pairFor(pairs, documentId);
  if (!pair) throw new Error('This tab is not a split pair.');
  captureTab();
  pairs.splice(pairs.indexOf(pair), 1);
  showWorkspace();
  update();
}

function openSplit(): void {
  if (pairFor(pairs, documentId)) { unsplit(); return; }
  const candidates = tabs.filter(tab => tab.id !== documentId && !pairFor(pairs, tab.id));
  if (!candidates.length) throw new Error('Open another unpaired file before creating a split.');
  splitDocumentId = documentId;
  captureTab();
  const list = element('split-documents');
  list.replaceChildren();
  for (const tab of candidates) {
    const card = document.createElement('button');
    card.type = 'submit';
    card.className = 'split-card';
    card.dataset.documentId = tab.id;
    const dirty = tab.markdown !== tab.savedMarkdown;
    card.setAttribute('aria-label', `Split with ${tab.name}${dirty ? ', unsaved changes' : ''}`);
    card.title = tab.path ?? tab.name;
    const thumbnail = document.createElement('span');
    thumbnail.className = 'split-preview';
    thumbnail.setAttribute('aria-hidden', 'true');
    thumbnail.inert = true;
    const page = document.createElement('div');
    page.className = 'split-preview-page';
    page.innerHTML = documentPreviewHTML(tab.markdown, tab.id);
    if (!page.textContent?.trim() && !page.querySelector('img, hr')) page.textContent = 'Empty document';
    thumbnail.append(page);
    const label = document.createElement('span');
    label.className = 'split-card-name';
    label.textContent = `${tab.name}${dirty ? ' \u2022' : ''}`;
    const location = document.createElement('span');
    location.className = 'split-card-path';
    location.textContent = tab.path ?? 'Unsaved document';
    card.append(thumbnail, label, location);
    list.append(card);
  }
  element('split-description').textContent = `Pair ${documentName} with another open file.`;
  element('split-error').hidden = true;
  element<HTMLDialogElement>('split-dialog').showModal();
  list.querySelector<HTMLButtonElement>('button')!.focus();
}

function showTabMenu(event: MouseEvent, id: string): void {
  const menu = element('tab-context-menu');
  const pair = pairFor(pairs, id);
  menu.replaceChildren();
  const choices: [string, () => Promise<void>][] = [
    [pair ? 'Unsplit' : 'Split with...', async () => { activateTab(id); openSplit(); }],
    [pair ? 'Close active file' : 'Close tab', async () => closeTab(id)],
  ];
  if (pair) choices.push(['Close both files', async () => closeGroup([pair.leftId, pair.rightId])]);
  for (const [label, operation] of choices) {
    const control = document.createElement('button');
    control.textContent = label;
    control.setAttribute('role', 'menuitem');
    control.addEventListener('click', event => {
      event.stopPropagation();
      menu.hidePopover();
      void run(operation);
    });
    menu.append(control);
  }
  menu.showPopover();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector<HTMLButtonElement>('button')!.focus();
}

async function closeGroup(ids: readonly string[]): Promise<void> {
  if (ids.length === 1) { await closeTab(ids[0]); return; }
  const originalId = documentId;
  for (const id of ids) {
    activateTab(id);
    if (!await mayDiscard()) { activateTab(originalId); return; }
  }
  if (ids.length === tabs.length) { finishClose(); return; }
  const index = tabs.findIndex(tab => tab.id === ids[0]);
  for (const id of ids) {
    const tab = tabs.find(tab => tab.id === id)!;
    unwrap(await window.studio.closeDocument(id));
    tab.editor.destroy();
    tab.pane.remove();
    tabs.splice(tabs.indexOf(tab), 1);
  }
  for (let index = pairs.length - 1; index >= 0; index--) {
    if (ids.includes(pairs[index].leftId) || ids.includes(pairs[index].rightId)) pairs.splice(index, 1);
  }
  activeTab = undefined;
  activateTab(tabs.some(tab => tab.id === originalId) ? originalId : tabs[Math.min(index, tabs.length - 1)].id);
  storeDraft();
}

async function closeTab(id: string): Promise<void> {
  activateTab(id);
  if (!await mayDiscard()) return;
  if (tabs.length === 1) { finishClose(); return; }
  const pair = pairFor(pairs, id);
  const partner = pair ? (pair.leftId === id ? pair.rightId : pair.leftId) : null;
  const index = tabs.findIndex(tab => tab.id === id);
  unwrap(await window.studio.closeDocument(id));
  editor.destroy();
  activeTab!.pane.remove();
  tabs.splice(index, 1);
  if (pair) pairs.splice(pairs.indexOf(pair), 1);
  activeTab = undefined;
  activateTab(partner ?? tabs[Math.min(index, tabs.length - 1)].id);
  update();
  storeDraft();
}

function finishClose(): void {
  clearTimeout(draftTimer);
  if (!recovery.length) localStorage.removeItem(draftKey);
  window.removeEventListener('beforeunload', storeDraft);
  window.studio.close();
}

function resetVisual(content: string): void {
  editor.destroy();
  visual.replaceChildren();
  editor = createEditor(content);
  if (activeTab) activeTab.editor = editor;
  if (busy) editor.setEditable(false, false);
}

function notify(message: string, error = false): void {
  const notification = element('notification');
  notification.textContent = message;
  notification.classList.toggle('error', error);
  notification.hidden = false;
  notification.setAttribute('role', error ? 'alert' : 'status');
  clearTimeout(notificationTimer);
  if (!error) notificationTimer = setTimeout(() => { notification.hidden = true; }, 5500);
}
element('notification').addEventListener('click', () => { element('notification').hidden = true; });

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function update(): void {
  renderTabs();
  updatePaneHeaders();
  const dirty = markdown !== savedMarkdown;
  element('filename').textContent = documentName;
  element('filename').title = documentPath ?? documentName;
  element('dirty-indicator').textContent = dirty ? ' \u2022' : '';
  document.title = `${dirty ? '* ' : ''}${documentName} - Markdown Studio`;
  window.studio.setDirty(tabs.some(tab => tab.markdown !== tab.savedMarkdown));
  const words = wordCount(markdown);
  element('word-count').textContent = `${words.toLocaleString()} words`;
  element('word-count').title = `${markdown.length.toLocaleString()} characters / ${Math.max(1, Math.ceil(words / 220))} min read`;
  element('save-status').innerHTML = `<span class="status-dot ${dirty ? 'unsaved' : ''}"></span>${dirty ? 'Unsaved changes' : documentPath ? 'All changes saved' : 'Ready to write'}`;
  const outline = element('outline');
  outline.replaceChildren();
  for (const [index, item] of headings(markdown).entries()) {
    const entry = document.createElement('button');
    entry.textContent = item.text || 'Untitled heading';
    entry.title = item.text;
    entry.style.paddingLeft = `${12 + (item.level - 1) * 12}px`;
    entry.addEventListener('click', () => {
      if (mode === 'source') {
        const offset = markdown.split('\n').slice(0, item.line).join('\n').length + (item.line > 0 ? 1 : 0);
        source.focus();
        source.setSelectionRange(offset, offset);
        source.scrollTop = Math.max(0, item.line * 24 - 50);
      } else {
        visual.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    outline.append(entry);
  }
  if (!outline.childElementCount) outline.innerHTML = '<p class="empty-note">Add a heading to give your ideas a little structure.</p>';
  updateToolbar();
  if (activeTab?.preview) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { if (activeTab) refreshPreview(activeTab); }, 120);
  }
  if (!element('find-panel').hidden) scheduleSearch();
}

function changed(content: string, record = true): void {
  if (content === markdown) return;
  if (mode === 'source' && record) {
    sourceUndo.push(markdown);
    if (sourceUndo.length > 100) sourceUndo.shift();
    sourceRedo.length = 0;
  }
  markdown = content;
  update();
  scheduleDraft();
}

function scheduleDraft(): void {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(storeDraft, 700);
}

function storeDraft(): void {
  if (recovery.length) return;
  captureTab();
  try {
    const documents = tabs.filter(tab => tab.markdown !== tab.savedMarkdown).map(tab => ({ content: tab.markdown, name: tab.name }));
    if (documents.length) localStorage.setItem(draftKey, JSON.stringify({ documents }));
    else localStorage.removeItem(draftKey);
  } catch (error) { notify(`Your draft could not be stored for recovery. Save your file now. ${String(error)}`, true); }
}

function switchMode(next: 'visual' | 'source'): void {
  if (activeTab) activeTab.preview = false;
  if (next === mode) { showMode(); return; }
  if (next === 'source') {
    source.value = markdown;
    sourceUndo.length = 0;
    sourceRedo.length = 0;
  }
  else resetVisual(markdown);
  mode = next;
  showMode();
  updateToolbar();
  if (next === 'source') source.focus();
  else editor.commands.focus();
}

function updateToolbar(): void {
  if (!editor) return;
  const names: Record<string, string> = { bold: 'bold', italic: 'italic', strike: 'strike', code: 'code', bullet: 'bulletList', ordered: 'orderedList', task: 'taskList', quote: 'blockquote', codeblock: 'codeBlock', rule: 'horizontalRule' };
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-command]')) {
    const active = mode === 'visual' && editor.isActive(names[control.dataset.command!] ?? '');
    control.classList.toggle('active', active);
    control.setAttribute('aria-pressed', String(active));
  }
  const sourceLineStart = source.selectionStart === 0 ? 0 : source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
  const level = mode === 'visual'
    ? editor.getAttributes('heading').level
    : source.value.slice(sourceLineStart).match(/^ {0,3}(#{1,6})[ \t]+/)?.[1].length;
  element<HTMLSelectElement>('heading').value = String(level ?? 0);
  element('table-tools').hidden = mode !== 'visual' || !editor.isActive('table');
  window.studio.setEditorContext({
    mode, heading: Number(level ?? 0), inTable: mode === 'visual' && editor.isActive('table'),
    active: mode === 'visual' ? Object.entries(names).filter(([, name]) => editor.isActive(name)).map(([command]) => command) : [],
  });
}

function setHeading(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 6) throw new Error('Unsupported heading level.');
  if (mode === 'source') {
    const start = source.selectionStart === 0 ? 0 : source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
    const endOfLine = source.value.indexOf('\n', source.selectionEnd);
    const end = endOfLine < 0 ? source.value.length : endOfLine;
    const text = source.value.slice(start, end).replace(/^ {0,3}#{1,6}[ \t]+/, '');
    source.setRangeText(`${'#'.repeat(value)}${value ? ' ' : ''}${text}`, start, end, 'select');
    source.focus();
    changed(source.value);
  } else if (value === 0) editor.chain().focus().setParagraph().run();
  else {
    const level = ([1, 2, 3, 4, 5, 6] as const).find(item => item === value);
    if (level) editor.chain().focus().setHeading({ level }).run();
  }
  updateToolbar();
}

function insertParagraph(after: boolean): void {
  if (mode === 'source') {
    const start = source.selectionStart === 0 ? 0 : source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
    const endOfLine = source.value.indexOf('\n', source.selectionEnd);
    const end = endOfLine < 0 ? source.value.length : endOfLine;
    const position = after ? end : start;
    source.setRangeText('\n\n', position, position, 'end');
    source.setSelectionRange(after ? position + 2 : position, after ? position + 2 : position);
    changed(source.value);
    source.focus();
  } else {
    const { $from, from, to } = editor.state.selection;
    const position = $from.depth ? (after ? $from.after(1) : $from.before(1)) : (after ? to : from);
    editor.chain().focus().insertContentAt(position, { type: 'paragraph' }).setTextSelection(position + 1).run();
  }
}

function insertAdvanced(kind: string): void {
  const wasVisual = mode === 'visual';
  switchMode('source');
  if (wasVisual) source.setSelectionRange(source.value.length, source.value.length);
  if (kind === 'frontmatter') {
    if (/^(?:\uFEFF)?---\r?\n/.test(source.value)) throw new Error('This document already starts with a front-matter block. Edit it in Source mode instead.');
    source.setSelectionRange(0, 0);
    insertSource('---\ntitle: Untitled\nauthor: ""\ndate: ""\n---\n\n');
  } else if (kind === 'math') insertSource('\n\n$$\nx^2 + y^2 = z^2\n$$\n\n');
  else if (kind === 'footnote') {
    let number = 1;
    while (source.value.includes(`[^${number}]`)) number++;
    const position = source.selectionStart;
    const marker = `[^${number}]`;
    const selected = source.value.slice(position, source.selectionEnd);
    const value = source.value.slice(0, position) + selected + marker + source.value.slice(source.selectionEnd);
    source.value = `${value}\n\n${marker}: Footnote text\n`;
    source.setSelectionRange(position + selected.length + marker.length, position + selected.length + marker.length);
    changed(source.value);
    source.focus();
  } else if (kind === 'reference') {
    let number = 1;
    while (source.value.includes(`[link-${number}]`)) number++;
    const position = source.selectionStart;
    const selected = source.value.slice(position, source.selectionEnd) || 'Link text';
    const marker = `[${selected.replace(/[[\]\\]/g, '\\$&')}][link-${number}]`;
    const value = source.value.slice(0, position) + marker + source.value.slice(source.selectionEnd);
    source.value = `${value}\n\n[link-${number}]: https://example.com\n`;
    source.setSelectionRange(position, position + marker.length);
    changed(source.value);
    source.focus();
  } else throw new Error('Unsupported insert command.');
  notify('Inserted in Source mode. Advanced syntax is preserved here; math, footnotes, and YAML do not have formatted rendering or export support yet.');
}

function insertContents(): void {
  const contents = `${tableOfContents(markdown)}\n\n`;
  if (mode === 'source') insertSource(contents);
  else editor.chain().focus().insertContent(contents, { contentType: 'markdown' }).run();
  notify('Inserted a marked table of contents. Use Insert > Update table of contents after changing headings.');
}

async function save(saveAs = false): Promise<boolean> {
  const snapshot = markdown;
  const result = unwrap(await window.studio.save(documentId, snapshot, saveAs));
  if (!result) return false;
  documentPath = result.path;
  documentName = result.path.split(/[\\/]/).at(-1)!;
  savedMarkdown = snapshot;
  update();
  storeDraft();
  await refreshRecent();
  notify('Markdown file saved.');
  return true;
}

async function mayDiscard(): Promise<boolean> {
  if (markdown === savedMarkdown) return true;
  const choice = unwrap(await window.studio.confirmUnsaved(documentName));
  if (choice === 'cancel') return false;
  return choice === 'save' ? save() : true;
}

async function refreshRecent(): Promise<void> {
  const files = unwrap(await window.studio.recent());
  const recent = element('recent');
  recent.replaceChildren();
  for (const file of files) {
    const control = document.createElement('button');
    control.className = 'recent-file';
    control.textContent = file.split(/[\\/]/).at(-1)!;
    control.title = file;
    control.addEventListener('click', () => { void run(async () => open(file)); });
    recent.append(control);
  }
  if (!files.length) recent.innerHTML = '<p class="empty-note">Your opened files will appear here.</p>';
  element<HTMLButtonElement>('clear-recent').disabled = files.length === 0;
  element('recent-count').textContent = `(${files.length})`;
}

async function open(file?: string): Promise<void> {
  const opened = unwrap(await window.studio.open(file));
  if (!opened) return;
  addTab(opened.id, opened.content, opened.path.split(/[\\/]/).at(-1)!, opened.path);
  await refreshRecent();
}

async function run(operation: () => Promise<unknown>): Promise<void> {
  if (busy) { notify('Please wait for the current operation to finish.'); return; }
  busy = true;
  app.setAttribute('aria-busy', 'true');
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-theme-option]')) control.disabled = true;
  for (const tab of tabs) {
    tab.editor.setEditable(false, false);
    tab.source.readOnly = true;
  }
  if (!tabs.length) { editor.setEditable(false, false); source.readOnly = true; }
  try { await operation(); }
  catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
  finally {
    busy = false;
    app.setAttribute('aria-busy', 'false');
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-theme-option]')) control.disabled = false;
    for (const tab of tabs) {
      tab.editor.setEditable(true, false);
      tab.source.readOnly = false;
    }
    if (!tabs.length) { editor.setEditable(true, false); source.readOnly = false; }
  }
}

function insertSource(before: string, after = ''): void {
  const start = source.selectionStart;
  const end = source.selectionEnd;
  const selected = source.value.slice(start, end);
  source.setRangeText(before + selected + after, start, end, 'select');
  source.focus();
  changed(source.value);
}

function insertEmbeddedImage(image: string): void {
  if (new TextEncoder().encode(markdown + image).length > 10 * 1024 * 1024) throw new Error('This image would make your document exceed the 10 MB limit. Choose a smaller image.');
  if (mode === 'visual') editor.chain().focus().setImage({ src: image, alt: 'Image' }).run();
  else {
    source.setRangeText(`![Image](${image})`, source.selectionStart, source.selectionEnd, 'end');
    changed(source.value);
    source.focus();
  }
}

async function chooseImageStorage(image: string): Promise<void> {
  const dialog = element<HTMLDialogElement>('image-storage-dialog');
  const id = documentId;
  const assets = dialog.querySelector<HTMLInputElement>('[value="assets"]')!;
  assets.disabled = !documentPath;
  dialog.querySelector<HTMLInputElement>('[value="embedded"]')!.checked = true;
  dialog.returnValue = '';
  const choice = new Promise<string>(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  dialog.showModal();
  if (await choice !== 'insert') return;
  if (id !== documentId) throw new Error('The active document changed. Insert the image again in the intended document.');
  const storage = assets.checked ? 'assets' : 'embedded';
  const value = unwrap(await window.studio.storeImage(id, image, storage));
  insertEmbeddedImage(value);
}

function format(command: string): void {
  if (mode === 'source') {
    const syntax: Record<string, [string, string]> = {
      bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'],
      bullet: ['\n- ', ''], ordered: ['\n1. ', ''], task: ['\n- [ ] ', ''], quote: ['\n> ', ''],
      codeblock: ['\n```\n', '\n```\n'], rule: ['\n\n---\n\n', ''],
    };
    const pair = syntax[command];
    if (pair) insertSource(...pair);
    return;
  }
  const chain = editor.chain().focus();
  switch (command) {
    case 'bold': chain.toggleBold().run(); break;
    case 'italic': chain.toggleItalic().run(); break;
    case 'strike': chain.toggleStrike().run(); break;
    case 'code': chain.toggleCode().run(); break;
    case 'bullet': chain.toggleBulletList().run(); break;
    case 'ordered': chain.toggleOrderedList().run(); break;
    case 'task': chain.toggleTaskList().run(); break;
    case 'quote': chain.toggleBlockquote().run(); break;
    case 'codeblock': chain.toggleCodeBlock().run(); break;
    case 'rule': chain.setHorizontalRule().run(); break;
    case 'clear': chain.unsetAllMarks().clearNodes().run(); break;
  }
  updateToolbar();
}

async function dispatch(action: string): Promise<void> {
  closeDropdowns();
  if (action.startsWith('theme:')) {
    const value = action.slice(6);
    if (!isTheme(value)) throw new Error('Unsupported color theme.');
    await applyTheme(value);
    return;
  }
  if (action.startsWith('format:')) { format(action.slice(7)); return; }
  if (action.startsWith('heading:')) { setHeading(Number(action.slice(8))); return; }
  if (action.startsWith('insert:')) {
    const kind = action.slice(7);
    if (kind === 'before' || kind === 'after') insertParagraph(kind === 'after');
    else if (kind === 'toc') insertContents();
    else if (kind === 'toc-update') {
      const content = updateTableOfContents(markdown);
      if (mode === 'visual') editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
      else source.value = content;
      changed(content);
      notify('Table of contents updated. Surrounding Markdown is unchanged.');
    }
    else if (kind === 'mermaid') {
      if (mode !== 'source') switchMode('source');
      insertSource('\n```mermaid\nflowchart LR\n  A[Start] --> B[Write something]\n```\n');
      if (!activeTab?.preview) togglePreview();
    }
    else insertAdvanced(kind);
    return;
  }
  switch (action) {
    case 'split': openSplit(); break;
    case 'preview': togglePreview(); break;
    case 'unsplit': unsplit(); break;
    case 'paste-image': {
      const image = unwrap(await window.studio.readClipboardImage());
      if (!image) throw new Error('The clipboard has no image to paste. Copy an image or take a screenshot first.');
      await chooseImageStorage(image);
      break;
    }
    case 'copy-image': {
      const source = contextImageSource ?? editor.getAttributes('image').src;
      if (typeof source !== 'string' || !source) throw new Error('Select an image to copy.');
      unwrap(await window.studio.copyImage(documentId, source));
      notify('Image copied to the clipboard.');
      break;
    }
    case 'copy-document':
      unwrap(await window.studio.writeClipboard(markdown));
      break;
    case 'copy-markdown': {
      let selected: string;
      if (mode === 'source') selected = source.value.slice(source.selectionStart, source.selectionEnd);
      else {
        const { from, to } = editor.state.selection;
        if (from === to) throw new Error('Select text to copy as Markdown.');
        if (!editor.markdown) throw new Error('The Markdown serializer is unavailable.');
        selected = editor.markdown.serialize({ type: 'doc', content: editor.state.doc.slice(from, to).content.toJSON() });
      }
      if (!selected) throw new Error('Select text to copy as Markdown.');
      unwrap(await window.studio.writeClipboard(selected));
      break;
    }
    case 'paste-markdown': {
      const text = unwrap(await window.studio.readClipboard());
      if (!text) throw new Error('The clipboard has no text to paste.');
      if (mode === 'source') {
        source.setRangeText(text, source.selectionStart, source.selectionEnd, 'end');
        changed(source.value);
        source.focus();
      }
      else editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
      break;
    }
    case 'new':
      await newTab();
      break;
    case 'open': await open(); break;
    case 'save': await save(); break;
    case 'save-as': await save(true); break;
    case 'clear-recent':
      unwrap(await window.studio.clearRecent());
      await refreshRecent();
      notify('Recent file history cleared. Your documents have not been deleted.');
      break;
    case 'save-all': {
      captureTab();
      const originalId = documentId;
      for (const tab of tabs) {
        if (tab.markdown === tab.savedMarkdown) continue;
        activateTab(tab.id);
        if (!await save()) return;
      }
      activateTab(originalId);
      break;
    }
    case 'close-tab': await closeTab(documentId); break;
    case 'next-tab':
    case 'previous-tab': {
      const groups = groupTabs(tabs.map(tab => tab.id), pairs);
      const index = groups.findIndex(group => group.documentIds.includes(documentId));
      activateTab(groups[(index + (action === 'next-tab' ? 1 : groups.length - 1)) % groups.length].activeId);
      break;
    }
    case 'export-docx':
    case 'export-pdf': {
      const file = unwrap(await window.studio.exportDocument(documentId, markdown, action === 'export-pdf' ? 'pdf' : 'docx'));
      if (file) notify(`Exported successfully: ${file}`);
      break;
    }
    case 'close':
      captureTab();
      for (const tab of tabs) {
        if (tab.markdown === tab.savedMarkdown) continue;
        activateTab(tab.id);
        if (!await mayDiscard()) return;
      }
      finishClose();
      break;
    case 'visual': switchMode('visual'); break;
    case 'source': switchMode('source'); break;
    case 'mode': switchMode(mode === 'visual' ? 'source' : 'visual'); break;
    case 'focus': setFocusMode(!document.body.classList.contains('focus-mode')); break;
    case 'sidebar':
      if (document.body.classList.contains('focus-mode')) {
        sidebarHidden = false;
        setFocusMode(false);
      } else {
        sidebarHidden = !sidebarHidden;
        updateSidebar();
      }
      try { localStorage.setItem(sidebarKey, String(sidebarHidden)); }
      catch (error) { notify(`Sidebar changed, but could not be remembered: ${String(error)}`, true); }
      break;
    case 'theme':
      await applyTheme(themes[(themes.findIndex(option => option.id === theme) + 1) % themes.length].id);
      break;
    case 'find':
      setFindOpen(element('find-panel').hidden);
      break;
    case 'find-close': setFindOpen(false); break;
    case 'find-next': await navigateSearch(); break;
    case 'find-previous': await navigateSearch(true); break;
    case 'replace-one': await replaceFound(false); break;
    case 'replace-all': await replaceFound(true); break;
    case 'link':
      linkDocumentId = documentId;
      element<HTMLInputElement>('link-label').value = mode === 'source' ? source.value.slice(source.selectionStart, source.selectionEnd) : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
      element<HTMLInputElement>('link-url').value = 'https://';
      element<HTMLDialogElement>('link-dialog').showModal();
      break;
    case 'image': {
      const image = unwrap(await window.studio.insertImage());
      if (image) await chooseImageStorage(image);
      break;
    }
    case 'table':
      if (element<HTMLDialogElement>('table-dialog').open) break;
      tableDocumentId = documentId;
      element<HTMLInputElement>('table-columns').value = '3';
      element<HTMLInputElement>('table-rows').value = '4';
      element('table-error').hidden = true;
      element<HTMLDialogElement>('table-dialog').showModal();
      break;
    case 'row': editor.chain().focus().addRowAfter().run(); break;
    case 'column': editor.chain().focus().addColumnAfter().run(); break;
    case 'delete-row': editor.chain().focus().deleteRow().run(); break;
    case 'delete-column': editor.chain().focus().deleteColumn().run(); break;
    case 'delete-table': editor.chain().focus().deleteTable().run(); break;
    case 'undo':
      if (mode === 'visual') editor.chain().focus().undo().run();
      else if (sourceUndo.length) {
        sourceRedo.push(markdown);
        source.value = sourceUndo.pop()!;
        changed(source.value, false);
        source.focus();
      }
      break;
    case 'redo':
      if (mode === 'visual') editor.chain().focus().redo().run();
      else if (sourceRedo.length) {
        sourceUndo.push(markdown);
        source.value = sourceRedo.pop()!;
        changed(source.value, false);
        source.focus();
      }
      break;
    case 'help': element<HTMLDialogElement>('help-dialog').showModal(); break;
    case 'shortcuts': element<HTMLDialogElement>('shortcuts-dialog').showModal(); break;
    case 'recover':
      while (recovery.length) {
        const draft = recovery[0];
        const id = unwrap(await window.studio.newDocument());
        addTab(id, draft.content, `Recovered - ${draft.name}`, null, false);
        recovery.shift();
      }
      element('recovery-banner').hidden = true;
      storeDraft();
      notify('Drafts recovered in new unsaved tabs. Save them to keep them.');
      break;
    case 'dismiss-recovery':
      recovery = [];
      element('recovery-banner').hidden = true;
      storeDraft();
      break;
  }
}

function activateEventPane(event: Event): void {
  if (busy || !(event.target instanceof HTMLElement)) return;
  const id = event.target.closest<HTMLElement>('.document-pane')?.dataset.documentId;
  if (id && id !== documentId) activateTab(id);
}
element('canvas').addEventListener('pointerdown', activateEventPane, true);
element('canvas').addEventListener('focusin', activateEventPane, true);
element('canvas').addEventListener('contextmenu', activateEventPane, true);
for (const id of ['find-text', 'replace-text', 'find-case', 'find-word', 'find-regex']) {
  element(id).addEventListener('input', scheduleSearch);
}
element('find-text').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  void run(async () => navigateSearch(event.shiftKey));
});
window.addEventListener('resize', () => { if (!element('find-panel').hidden) paintSearch(); });
element('canvas').addEventListener('input', event => {
  if (!(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains('document-source')) return;
  activateEventPane(event);
  changed(event.target.value);
});
element('canvas').addEventListener('keydown', event => {
  if (!(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains('document-source')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    void run(async () => dispatch(event.shiftKey ? 'redo' : 'undo'));
  }
  if (event.key === 'Tab' && !busy) {
    event.preventDefault();
    insertSource('  ');
  }
});
document.querySelector('.toolbar')!.addEventListener('mousedown', event => {
  if ((event.target as HTMLElement).closest('button')) event.preventDefault();
});
document.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const themeOption = target.closest<HTMLElement>('[data-theme-option]')?.dataset.themeOption;
  if (themeOption) {
    void run(async () => {
      if (!isTheme(themeOption)) throw new Error('Unsupported color theme.');
      await applyTheme(themeOption);
    });
    return;
  }
  const paneMode = target.closest<HTMLElement>('[data-pane-mode]')?.dataset.paneMode;
  if (paneMode === 'visual' || paneMode === 'source' || paneMode === 'preview') {
    if (!busy) { activateEventPane(event); if (paneMode === 'preview') togglePreview(); else switchMode(paneMode); }
    return;
  }
  const command = target.closest<HTMLElement>('[data-command]')?.dataset.command;
  if (command) {
    closeDropdowns();
    if (!busy) format(command);
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action && dropdownIds.includes(action)) {
    const expanded = !element(action).hidden;
    closeDropdowns();
    if (!expanded) {
      element(action).hidden = false;
      target.closest('button')!.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  if (action) void run(async () => dispatch(action));
  else if (!target.closest('.dropdown')) closeDropdowns();
  const link = target.closest<HTMLAnchorElement>('.tiptap a');
  if (link) {
    event.preventDefault();
    void run(async () => {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        const anchor = decodeURIComponent(href.slice(1));
        const used = new Map<string, number>();
        const index = headings(markdown).findIndex(item => headingAnchor(item.text, used) === anchor);
        const heading = index < 0 ? undefined : visual.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')[index];
        if (!heading) throw new Error('That heading was not found. Reinsert the table of contents after changing headings.');
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else unwrap(await window.studio.openExternal(link.href));
    });
  }
});
element<HTMLSelectElement>('heading').addEventListener('change', event => {
  if (busy) return;
  setHeading(Number((event.target as HTMLSelectElement).value));
});
element('canvas').addEventListener('select', event => { if (event.target === source) updateToolbar(); }, true);
element('recent-toggle').addEventListener('click', () => {
  recentExpanded = !recentExpanded;
  updateRecentDisclosure();
  try { localStorage.setItem(recentExpandedKey, String(recentExpanded)); }
  catch (error) { notify(`Recent Files changed, but could not be remembered: ${String(error)}`, true); }
});
const sidebarResizer = element('sidebar-resizer');
let sidebarDrag: { pointerId: number; startX: number; startWidth: number } | undefined;
sidebarResizer.addEventListener('pointerdown', event => {
  if (busy || event.button !== 0) return;
  event.preventDefault();
  sidebarDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: element('sidebar').getBoundingClientRect().width };
  sidebarResizer.setPointerCapture(event.pointerId);
  sidebarResizer.focus();
  document.body.classList.add('resizing-sidebar');
});
sidebarResizer.addEventListener('pointermove', event => {
  if (!sidebarDrag || event.pointerId !== sidebarDrag.pointerId) return;
  preferredSidebarWidth = sidebarWidth(sidebarDrag.startWidth + event.clientX - sidebarDrag.startX, window.innerWidth);
  updateSidebarWidth();
});
sidebarResizer.addEventListener('lostpointercapture', () => {
  if (!sidebarDrag) return;
  sidebarDrag = undefined;
  document.body.classList.remove('resizing-sidebar');
  rememberSidebarWidth();
});
sidebarResizer.addEventListener('pointerup', event => {
  if (sidebarResizer.hasPointerCapture(event.pointerId)) sidebarResizer.releasePointerCapture(event.pointerId);
});
sidebarResizer.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (busy) return;
  const width = sidebarWidth(preferredSidebarWidth, window.innerWidth);
  preferredSidebarWidth = sidebarWidth(event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? MAX_SIDEBAR_WIDTH : width + (event.key === 'ArrowLeft' ? -10 : 10), window.innerWidth);
  updateSidebarWidth();
  rememberSidebarWidth();
});
sidebarResizer.addEventListener('dblclick', () => {
  if (busy) return;
  preferredSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  updateSidebarWidth();
  rememberSidebarWidth();
});
window.addEventListener('resize', updateSidebarWidth);
element<HTMLFormElement>('table-form').addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    try {
      if (documentId !== tableDocumentId) throw new Error('The active document changed. Cancel and reopen Insert table in the intended tab.');
      const rows = element<HTMLInputElement>('table-rows').valueAsNumber;
      const columns = element<HTMLInputElement>('table-columns').valueAsNumber;
      validateTableSize(rows, columns);
      if (mode === 'visual') {
        if (!editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run()) {
          throw new Error('A table cannot be inserted here. Choose a paragraph outside an existing table.');
        }
      } else {
        source.setRangeText(tableMarkdown(rows, columns), source.selectionStart, source.selectionEnd, 'end');
        changed(source.value);
        source.focus();
      }
      element<HTMLDialogElement>('table-dialog').close('insert');
    } catch (error) {
      element('table-error').textContent = error instanceof Error ? error.message : String(error);
      element('table-error').hidden = false;
      throw error;
    }
  });
});
element('table-cancel').addEventListener('click', () => {
  element<HTMLDialogElement>('table-dialog').close('cancel');
});
element<HTMLFormElement>('split-form').addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    try {
      if (documentId !== splitDocumentId) throw new Error('The active file changed. Cancel and reopen Split with... in the intended tab.');
      const target = event.submitter;
      if (!(target instanceof HTMLButtonElement) || !target.dataset.documentId) throw new Error('Choose an open document preview to create a split.');
      const pair = createPair(tabs.map(tab => tab.id), pairs, documentId, target.dataset.documentId);
      captureTab();
      pairs.push(pair);
      showWorkspace();
      update();
      element<HTMLDialogElement>('split-dialog').close('split');
    } catch (error) {
      element('split-error').textContent = error instanceof Error ? error.message : String(error);
      element('split-error').hidden = false;
      throw error;
    }
  });
});
element('split-cancel').addEventListener('click', () => element<HTMLDialogElement>('split-dialog').close('cancel'));
element('split-dialog').addEventListener('close', () => {
  if (!element<HTMLDialogElement>('split-dialog').open) element('split-documents').replaceChildren();
});
element('tab-context-menu').addEventListener('keydown', event => {
  const menu = element('tab-context-menu');
  if (event.key === 'Escape') { event.stopPropagation(); menu.hidePopover(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const controls = [...menu.querySelectorAll<HTMLButtonElement>('button')];
  const index = controls.findIndex(control => control === document.activeElement);
  controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length].focus();
});
element<HTMLDialogElement>('link-dialog').addEventListener('close', event => {
  if ((event.target as HTMLDialogElement).returnValue !== 'insert') return;
  if (documentId !== linkDocumentId) { notify('The active file changed. Reopen Insert link in the intended file.', true); return; }
  const label = element<HTMLInputElement>('link-label').value;
  const url = element<HTMLInputElement>('link-url').value;
  if (!isSafeLink(url)) { notify('Use an http, https, or mailto address.', true); return; }
  if (mode === 'source') insertSource(`[${label.replace(/[[\]\\]/g, '\\$&')}](${url.replace(/[()]/g, encodeURIComponent)})`);
  else editor.chain().focus().insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: url } }] }).run();
});
element('canvas').addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) notify('An image could not be displayed. Relative images must be inside the saved document\'s folder. Use Insert image to embed it instead.', true);
}, true);
element('canvas').addEventListener('contextmenu', event => {
  contextImageSource = event.target instanceof HTMLImageElement ? event.target.getAttribute('data-studio-source') : null;
});
element('canvas').addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
  const hasImage = file || [...(event.clipboardData?.types ?? [])].some(type => type.startsWith('image/'));
  if (!hasImage) return;
  event.preventDefault();
  event.stopPropagation();
  void run(async () => {
    if (!file) { await dispatch('paste-image'); return; }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Paste a PNG, JPEG, GIF, or WebP image.');
    if (file.size > 20 * 1024 * 1024) throw new Error('The clipboard image exceeds the 20 MB image limit.');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The clipboard image could not be read.'));
      reader.onerror = () => reject(new Error('The clipboard image could not be read.'));
      reader.readAsDataURL(file);
    });
    await chooseImageStorage(data);
  });
}, true);
element('canvas').addEventListener('dragover', event => {
  if ([...(event.dataTransfer?.items ?? [])].some(item => item.kind === 'file')) event.preventDefault();
});
element('canvas').addEventListener('drop', event => {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  activateEventPane(event);
  void run(async () => {
    if (files.length !== 1) throw new Error('Drop one image at a time.');
    const file = files[0];
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Drop a PNG, JPEG, GIF, or WebP image.');
    if (file.size > 20 * 1024 * 1024) throw new Error('The dropped image exceeds the 20 MB image limit.');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The dropped image could not be read.'));
      reader.onerror = () => reject(new Error('The dropped image could not be read.'));
      reader.readAsDataURL(file);
    });
    await chooseImageStorage(data);
  });
}, true);
element('canvas').addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'v') return;
  const target = event.target;
  if (target !== source && (!(target instanceof HTMLElement) || !target.closest('.tiptap') || target.closest('.code-block-controls'))) return;
  event.preventDefault();
  event.stopPropagation();
  if (busy) notify('Please wait for the current operation to finish.');
  else window.studio.paste();
}, true);
function copySelectedImage(event: ClipboardEvent, cut: boolean): void {
  if (mode !== 'visual') return;
  const { from, to } = editor.state.selection;
  const node = editor.state.doc.nodeAt(from);
  if (node?.type.name !== 'image' || to !== from + node.nodeSize) return;
  event.preventDefault();
  void run(async () => {
    unwrap(await window.studio.copyImage(documentId, String(node.attrs.src)));
    if (cut) editor.chain().focus().deleteSelection().run();
  });
}
element('canvas').addEventListener('copy', event => copySelectedImage(event, false), true);
element('canvas').addEventListener('cut', event => copySelectedImage(event, true), true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeDropdowns();
    setFindOpen(false);
    setFocusMode(false);
  }
});
const dropdownIds = ['save-menu', 'export-menu', 'format-menu'];
function closeDropdowns(): void {
  for (const id of dropdownIds) {
    element(id).hidden = true;
    document.querySelector(`[aria-controls="${id}"]`)!.setAttribute('aria-expanded', 'false');
  }
}
for (const id of dropdownIds) {
  const trigger = document.querySelector<HTMLButtonElement>(`[aria-controls="${id}"]`)!;
  const menu = element(id);
  for (const control of menu.querySelectorAll('button')) control.setAttribute('role', 'menuitem');
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    closeDropdowns();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const items = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    items[event.key === 'ArrowUp' ? items.length - 1 : 0].focus();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDropdowns();
      trigger.focus();
      return;
    }
    if (event.key === 'Tab') { closeDropdowns(); trigger.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const controls = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = controls.findIndex(control => control === document.activeElement);
    controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length].focus();
  });
}
// Handle formatting before Tiptap, but only inside a document editor.
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !(event.target instanceof HTMLElement)) return;
  const shortcut = formattingShortcuts.find(item => item.code === event.code && item.shift === event.shiftKey);
  if (!shortcut || !event.target.closest('.tiptap, .document-source') || event.target.closest('.code-block-controls')) return;
  event.preventDefault();
  event.stopPropagation();
  activateEventPane(event);
  void run(async () => format(shortcut.command));
}, true);
window.addEventListener('beforeunload', storeDraft);
window.studio.onAction(action => { void run(async () => dispatch(action)); });
element('tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  void run(async () => {
    const groups = groupTabs(tabs.map(tab => tab.id), pairs);
    if (event.key === 'Home') activateTab(groups[0].activeId);
    else if (event.key === 'End') activateTab(groups.at(-1)!.activeId);
    else await dispatch(event.key === 'ArrowRight' ? 'next-tab' : 'previous-tab');
    element('tabs').querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  });
});
void run(async () => {
  documentId = unwrap(await window.studio.newDocument());
  activeTab = {
    id: documentId, markdown, savedMarkdown, name: documentName, path: null, mode,
    editor, visual, undo: sourceUndo, redo: sourceRedo, selection: [0, 0], sourceScroll: 0, canvasScroll: 0,
    source, ...initialPane,
  };
  initialPane.pane.dataset.documentId = documentId;
  tabs.push(activeTab);
  source.value = markdown;
  resetVisual(markdown);
  showWorkspace();
  update();
  await applyTheme(theme);
  await refreshRecent();
});
