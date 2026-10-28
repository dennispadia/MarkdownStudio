import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';

function testPNG(width, height) {
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'markdown-studio-desktop-'));
const executable = process.argv[2] ?? createRequire(import.meta.url)('electron');
const packaged = Boolean(process.argv[2]);
const child = spawn(executable, [
  ...(packaged ? [] : ['.']),
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--inspect=127.0.0.1:0', '--remote-debugging-port=0', `--user-data-dir=${path.join(temporary, 'profile')}`,
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let spawnError;
child.on('error', error => { spawnError = error; });
child.stdout.on('data', data => { log += data; });
child.stderr.on('data', data => { log += data; });
const clients = [];

async function waitFor(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const result = await check();
    if (result) return result;
    if (child.exitCode !== null) throw new Error(`Desktop exited (${child.exitCode}): ${log}`);
    await delay(100);
  }
  throw new Error(`Timed out: ${description}\n${log}`);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.counter = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.pending.get(message.id);
        if (request) {
          this.pending.delete(message.id);
          if (message.error) request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result);
        }
      }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const client = new CDP(socket);
    clients.push(client);
    return client;
  }
  call(method, params = {}, sessionId) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}${method === 'Runtime.evaluate' ? ` (${params.expression.slice(0, 160)})` : ''}`));
      }, 30000).unref();
    });
  }
  async evaluate(expression, sessionId) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

try {
  const mainURL = await waitFor(() => /Debugger listening on (ws:\/\/[^\s]+)/.exec(log)?.[1], 'main inspector');
  const browserURL = await waitFor(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(log)?.[1], 'desktop renderer');
  const main = await CDP.connect(mainURL);
  const browser = await CDP.connect(browserURL);
  const target = await waitFor(async () => (await browser.call('Target.getTargets')).targetInfos.find(item => item.type === 'page' && item.url.endsWith('index.html')), 'application page');
  const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const ui = expression => browser.evaluate(expression, sessionId);
  await waitFor(async () => ui("Boolean(document.querySelector('.tiptap h1')) && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'rendered editor');
  console.log('PASS: native desktop window loads rich editor, outline, table, and checklist');
  assert.equal(await ui("document.querySelectorAll('.tiptap table').length"), 1);
  assert.ok(await ui("document.querySelectorAll('#outline button').length") > 3);
  assert.ok(await ui("document.querySelectorAll('.tiptap input[type=checkbox]').length") >= 3);
  const taskOffsets = () => ui(`Array.from(document.querySelectorAll('.tiptap ul[data-type="taskList"] li')).filter(item => item.querySelector(':scope > label > input[type=checkbox]')).map(item => {
    const checkbox = item.querySelector(':scope > label > input').getBoundingClientRect();
    const paragraph = item.querySelector(':scope > div > p');
    const text = paragraph.getBoundingClientRect();
    return Math.abs(checkbox.top + checkbox.height / 2 - text.top - parseFloat(getComputedStyle(paragraph).lineHeight) / 2);
  })`);
  const taskAlignment = await taskOffsets();
  assert.ok(taskAlignment.length >= 3 && taskAlignment.every(offset => offset <= 1), `Checkbox alignment must be within 1px of first text line: ${taskAlignment}`);
  console.log('PASS: task checkboxes align with the first line of their text within 1px');
  assert.equal(await ui("document.querySelector('#dirty-indicator').textContent"), '');
  const electron = "process.getBuiltinModule('module').createRequire(process.cwd() + '\\\\package.json')('electron')";
  await main.evaluate(`globalThis.smokeElectron = ${electron}; globalThis.smokeSavePath = null; globalThis.smokeOpenPath = null; globalThis.smokeChoice = 2; globalThis.smokeChoices = []; smokeElectron.dialog.showSaveDialog = async () => smokeSavePath ? ({canceled:false,filePath:smokeSavePath}) : ({canceled:true}); smokeElectron.dialog.showOpenDialog = async () => smokeOpenPath ? ({canceled:false,filePaths:[smokeOpenPath]}) : ({canceled:true,filePaths:[]}); smokeElectron.dialog.showMessageBox = async () => ({response:smokeChoices.length ? smokeChoices.shift() : smokeChoice});`);
  assert.equal(await main.evaluate("smokeElectron.app.getPath('userData')"), path.join(temporary, 'profile'), 'Test profile is isolated from real user data');
  assert.equal(await main.evaluate("smokeElectron.app.getVersion()"), JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, 'The executable matches the current release version');
  await waitFor(async () => ui("document.querySelector('.brand-mark img')?.naturalWidth === 512"), 'original wizard sidebar artwork');
  const brandSource = async () => {
    await waitFor(async () => ui("document.querySelector('#brand-icon')?.complete && document.querySelector('#brand-icon').naturalWidth === 512"), 'theme-aware sidebar artwork');
    return ui("document.querySelector('#brand-icon').currentSrc");
  };
  const lightBrandIcon = await brandSource();
  assert.deepEqual(await main.evaluate("smokeElectron.nativeImage.createFromPath(process.getBuiltinModule('path').join(smokeElectron.app.getAppPath(), 'assets', 'icon.png')).getSize()"), {width:256,height:256});
  if (packaged) {
    const application = await readFile(path.resolve(executable));
    const icon = await readFile(path.join(root, 'assets', 'icon.ico'));
    const resources = NtExecutableResource.from(NtExecutable.from(application));
    const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
    const count = icon.readUInt16LE(4);
    assert.equal(groups.length, 1, 'No old/default icon groups remain in the executable');
    assert.equal(resources.entries.filter(entry => entry.type === 3).length, count, 'No orphaned old icon resources remain');
    assert.equal(groups[0].icons.length, count);
    for (const [index, item] of groups[0].icons.entries()) {
      const directory = 6 + index * 16;
      assert.equal(item.width || 256, icon[directory] || 256);
      assert.equal(item.height || 256, icon[directory + 1] || 256);
      const entry = resources.entries.find(entry => entry.type === 3 && entry.id === item.iconID && entry.lang === groups[0].lang);
      assert.ok(entry, 'Each Windows icon resolution has its matching resource');
      const offset = icon.readUInt32LE(directory + 12);
      const length = icon.readUInt32LE(directory + 8);
      assert.deepEqual(Buffer.from(entry.bin), icon.subarray(offset, offset + length), 'Every Windows icon size uses the approved quill');
    }
  }
  console.log('PASS: original wizard sidebar/window artwork and packaged executable icon resources');
  const action = async name => {
    await ui(`document.querySelector('[data-action=${JSON.stringify(name)}]').click()`);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), name);
  };
  const menuAction = async name => {
    await main.evaluate(`smokeElectron.BrowserWindow.getAllWindows()[0].webContents.send('app:action', ${JSON.stringify(name)})`);
    await delay(100);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), name);
  };
  const nativeShortcut = async (key, modifiers = ['control'], focusEditor = true) => {
    await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].focus(); smokeElectron.BrowserWindow.getAllWindows()[0].webContents.focus()");
    await waitFor(async () => main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].isFocused()"), 'native window activation');
    await waitFor(async () => ui("document.hasFocus()"), 'native keyboard focus');
    if (focusEditor) await ui("document.querySelector('#source-editor').hidden ? document.querySelector('#visual-editor .tiptap').focus() : document.querySelector('#source-editor').focus()");
    await ui("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");
    await main.evaluate(`(() => {
      const contents = smokeElectron.BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});
      contents.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});
    })()`);
  };
  const activeTab = () => ui("document.querySelector('.document-tab.selected').dataset.documentId");
  const tabCount = () => ui("document.querySelectorAll('.document-tab').length");
  const selectTab = async id => {
    await ui(`document.querySelector('[data-document-id=${JSON.stringify(id)}] .tab-select').click()`);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'tab switch');
  };
  const raw = '# Exact source\r\n\r\nUnusual   spacing & Unicode: \u4f60\u597d\r\n\r\n- [ ] A task\r\n';
  const file = path.join(temporary, 'original.md');
  await writeFile(file, raw);
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(file)}`);
  await action('open');
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'original.md');
  await action('save');
  assert.equal(await readFile(file, 'utf8'), raw);
  await action('source');
  assert.equal(await ui("document.querySelector('#source-editor').value"), raw.replace(/\r\n/g, '\n'));
  await action('visual');
  await action('save');
  assert.equal(await readFile(file, 'utf8'), raw, 'Mode switching and saving without edits preserve exact source bytes');
  console.log('PASS: native Open/Save and mode switching preserve unedited Markdown exactly');

  await action('source');
  const sourceEdit = async text => ui(`(() => { const source = document.querySelector('#source-editor'); source.value = ${JSON.stringify(text)}; source.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const content = '# Desktop export test\n\n**Bold** and *italic*.\n\n| Item | Value |\n| --- | --- |\n| A | B |\n\n- [x] Tested\n\n> A quote\n\n```js\nconst answer = 42;\n```\n';
  await sourceEdit(content);
  assert.match(await ui("document.querySelector('#save-status').textContent"), /Unsaved/);
  await action('save');
  assert.equal(await readFile(file, 'utf8'), content);
  await sourceEdit(content + '\nUndo this');
  await menuAction('undo');
  assert.equal(await ui("document.querySelector('#source-editor').value"), content);
  await menuAction('redo');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Undo this/);
  await menuAction('undo');
  console.log('PASS: source editing, dirty state, undo, and redo');

  await action('find');
  assert.equal(await ui("document.querySelector('#find-panel').hidden"), false);
  assert.equal(await ui("document.querySelector('[data-action=find]').getAttribute('aria-expanded')"), 'true');
  assert.equal(await ui("document.activeElement.id"), 'find-text');
  await ui("document.querySelector('#find-text').value='answer'; document.querySelector('#replace-text').value='result'");
  await action('find');
  assert.equal(await ui("document.querySelector('#find-panel').hidden"), true);
  assert.equal(await ui("document.querySelector('[data-action=find]').getAttribute('aria-expanded')"), 'false');
  await action('find');
  assert.equal(await ui("document.querySelector('#find-text').value"), 'answer');
  assert.equal(await ui("document.querySelector('#replace-text').value"), 'result');
  await action('replace-all');
  assert.match(await ui("document.querySelector('#source-editor').value"), /const result = 42/);
  await menuAction('undo');
  await action('find-close');
  assert.equal(await ui("document.querySelector('#find-panel').hidden"), true);
  await nativeShortcut('F');
  await waitFor(async () => ui("!document.querySelector('#find-panel').hidden"), 'native Find opens');
  await nativeShortcut('F', ['control'], false);
  await waitFor(async () => ui("document.querySelector('#find-panel').hidden"), 'native Find toggles closed');
  await action('find');
  await nativeShortcut('Escape', [], false);
  await waitFor(async () => ui("document.querySelector('#find-panel').hidden"), 'Escape closes Find');
  assert.equal(await ui("document.activeElement.id"), 'source-editor');
  await action('visual');
  assert.equal(await ui("document.querySelector('.tiptap h1').textContent"), 'Desktop export test');
  console.log('PASS: Find button/shortcut toggling, retained query, Close/Escape, focus restoration, find/replace, and visual rendering of edited source');

  await writeFile(file, '# External change');
  await action('save');
  assert.match(await ui("document.querySelector('#notification').textContent"), /changed or was removed outside/);
  assert.equal(await readFile(file, 'utf8'), '# External change');
  console.log('PASS: outside edits are detected and never silently overwritten');
  const copied = path.join(temporary, 'saved-as.md');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(copied)}`);
  await menuAction('save-as');
  assert.equal(await readFile(copied, 'utf8'), content);
  assert.equal(await readFile(file, 'utf8'), '# External change');
  console.log('PASS: native Save As preserves both versions');

  const docx = path.join(temporary, 'export.docx');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(docx)}`);
  await menuAction('export-docx');
  const word = await readFile(docx);
  assert.equal(word.subarray(0, 2).toString(), 'PK');
  assert.ok(word.length > 7000);
  console.log(`PASS: native Word export (${word.length} bytes)`);

  const pdf = path.join(temporary, 'export.pdf');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(pdf)}`);
  await menuAction('export-pdf');
  const pdfData = await readFile(pdf);
  assert.equal(pdfData.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfData.length > 10000);
  assert.match(pdfData.toString('latin1'), /\/Type\s*\/Page\b/);
  console.log(`PASS: native PDF export (${pdfData.length} bytes, valid page objects)`);

  const imagePath = path.join(temporary, 'pixel.png');
  await writeFile(imagePath, testPNG(1, 1));
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(imagePath)}`);
  await action('image');
  await waitFor(async () => ui("Array.from(document.querySelectorAll('.tiptap img')).some(image => image.complete && image.naturalWidth === 1)"), 'embedded image display');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'with-image.pdf'))}`);
  await menuAction('export-pdf');
  assert.match((await readFile(path.join(temporary, 'with-image.pdf'))).toString('latin1'), /\/Subtype\s*\/Image\b/);
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'with-image.docx'))}`);
  await menuAction('export-docx');
  assert.ok((await readFile(path.join(temporary, 'with-image.docx'))).length > word.length);
  console.log('PASS: native image picker embeds an image that displays and exports to both formats');
  await action('source');
  await sourceEdit(content + '\n![Local image](pixel.png)\n');
  await action('visual');
  await waitFor(async () => ui("Array.from(document.querySelectorAll('.tiptap img')).some(image => image.complete && image.naturalWidth === 1 && image.src.startsWith('studio-image:'))"), 'relative image protocol');
  console.log('PASS: relative local images display through the scoped image protocol');
  const imageTab = await activeTab();
  const otherFolder = path.join(temporary, 'other');
  await mkdir(otherFolder);
  await writeFile(path.join(otherFolder, 'pixel.png'), testPNG(2, 2));
  const otherDocument = path.join(otherFolder, 'other.md');
  await writeFile(otherDocument, '# Other image\n\n![Different image](pixel.png)\n');
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(otherDocument)}`);
  await action('open');
  const otherTab = await activeTab();
  await waitFor(async () => ui("document.querySelector('.tiptap img')?.naturalWidth === 2"), 'second tab relative image');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'other-image.pdf'))}`);
  await menuAction('export-pdf');
  assert.match((await readFile(path.join(temporary, 'other-image.pdf'))).toString('latin1'), /\/Width 2\b/);
  await selectTab(imageTab);
  assert.equal(await ui("document.querySelector('.tiptap img').naturalWidth"), 1);
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'first-image.pdf'))}`);
  await menuAction('export-pdf');
  assert.match((await readFile(path.join(temporary, 'first-image.pdf'))).toString('latin1'), /\/Width 1\b/);
  await selectTab(otherTab);
  await menuAction('close-tab');
  await selectTab(imageTab);
  console.log('PASS: identically named relative images display and export from each tab\'s own folder');
  await action('source');
  await sourceEdit(content);
  await sourceEdit(content + '\nUnsaved writing');
  await main.evaluate('smokeChoice = 2');
  await main.evaluate('smokeElectron.BrowserWindow.getAllWindows()[0].close()');
  await delay(200);
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'cancel window close');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Unsaved writing/);
  console.log('PASS: cancelling native window close preserves unsaved work');
  const firstTab = await activeTab();
  const beforeNew = await tabCount();
  await action('new');
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'Untitled.md');
  assert.equal(await tabCount(), beforeNew + 1);
  const secondTab = await activeTab();
  const secondContent = '# Second document\n\nIndependent words.';
  await sourceEdit(secondContent);
  await selectTab(firstTab);
  assert.equal(await ui("document.querySelector('#source-editor').value"), content + '\nUnsaved writing');
  await ui("document.querySelector('#source-editor').setSelectionRange(5, 12)");
  await selectTab(secondTab);
  assert.equal(await ui("document.querySelector('#source-editor').value"), secondContent);
  await selectTab(firstTab);
  assert.deepEqual(await ui("(() => { const s = document.querySelector('#source-editor'); return [s.selectionStart, s.selectionEnd]; })()"), [5, 12]);
  await menuAction('undo');
  assert.equal(await ui("document.querySelector('#source-editor').value"), content);
  await menuAction('redo');
  assert.equal(await ui("document.querySelector('#source-editor').value"), content + '\nUnsaved writing');
  console.log('PASS: New keeps unsaved tabs open; source edits, selections, and undo are independent');

  await main.evaluate(`smokeOpenPath = ${JSON.stringify(copied)}`);
  await action('open');
  assert.equal(await tabCount(), beforeNew + 1);
  assert.equal(await activeTab(), firstTab);
  assert.match(await ui("document.querySelector('#source-editor').value"), /Unsaved writing/);
  console.log('PASS: opening an already-open file focuses its existing tab without losing edits');

  await selectTab(secondTab);
  await main.evaluate(`smokeSavePath = ${JSON.stringify(copied)}`);
  await menuAction('save-as');
  assert.match(await ui("document.querySelector('#notification').textContent"), /already open in another tab/);
  assert.equal(await readFile(copied, 'utf8'), content);
  const secondPath = path.join(temporary, 'second.md');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(secondPath)}`);
  await menuAction('save-all');
  assert.equal(await readFile(copied, 'utf8'), content + '\nUnsaved writing');
  assert.equal(await readFile(secondPath, 'utf8'), secondContent);
  assert.equal(await activeTab(), secondTab);
  console.log('PASS: Save As cannot overwrite another tab; Save All writes each document to its own file');

  await selectTab(firstTab);
  await sourceEdit(content + '\nFirst dirty tab');
  await selectTab(secondTab);
  await sourceEdit(secondContent + '\nSecond dirty tab');
  await main.evaluate('smokeChoices = [1,2]; smokeElectron.BrowserWindow.getAllWindows()[0].close()');
  await delay(200);
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'cancel after discard');
  assert.equal(await activeTab(), secondTab);
  await selectTab(firstTab);
  assert.match(await ui("document.querySelector('#source-editor').value"), /First dirty tab/);
  await selectTab(secondTab);
  assert.match(await ui("document.querySelector('#source-editor').value"), /Second dirty tab/);
  await sourceEdit(secondContent);
  console.log('PASS: canceling exit after discarding an earlier tab retains all unsaved edits');

  await selectTab(firstTab);
  await sourceEdit(content + '\nSaved from the first tab');
  await selectTab(secondTab);
  await main.evaluate('smokeChoice = 2; smokeElectron.BrowserWindow.getAllWindows()[0].close()');
  await delay(200);
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'inactive dirty close protection');
  assert.equal(await activeTab(), firstTab, 'Window close checks unsaved inactive tabs');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Saved from the first tab/);
  await menuAction('close-tab');
  assert.equal(await tabCount(), beforeNew + 1, 'Cancel keeps a dirty tab open');
  await main.evaluate('smokeChoice = 0');
  await menuAction('close-tab');
  assert.equal(await tabCount(), beforeNew);
  assert.equal(await readFile(copied, 'utf8'), content + '\nSaved from the first tab');
  assert.equal(await activeTab(), secondTab);
  console.log('PASS: inactive unsaved files prevent app exit; tab close supports Cancel and Save');

  await menuAction('next-tab');
  assert.notEqual(await activeTab(), secondTab);
  await menuAction('previous-tab');
  assert.equal(await activeTab(), secondTab);
  await action('new');
  await action('visual');
  await menuAction('undo');
  assert.equal(await ui("document.querySelector('.tiptap').textContent"), '', 'Undo cannot resurrect a previous document');
  console.log('PASS: undo history is isolated between documents');
  await ui("document.querySelector('.tiptap').focus()");
  await browser.call('Input.insertText', { text: 'Visual writing ' }, sessionId);
  await ui("document.querySelector('[data-command=bold]').click()");
  await browser.call('Input.insertText', { text: 'bold words' }, sessionId);
  const richTab = await activeTab();
  await selectTab(secondTab);
  await selectTab(richTab);
  await menuAction('undo');
  assert.doesNotMatch(await ui("document.querySelector('.tiptap').textContent"), /bold words/);
  await menuAction('redo');
  await action('source');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Visual writing \*\*bold words\*\*/);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  console.log('PASS: new tabs have isolated undo; real visual typing and formatting still work');
  await menuAction('theme');
  assert.equal(await ui("document.documentElement.dataset.theme"), 'dark');
  const darkBrandIcon = await brandSource();
  assert.notEqual(darkBrandIcon, lightBrandIcon);
  if (darkBrandIcon.startsWith('data:image/svg+xml')) {
    const comma = darkBrandIcon.indexOf(',');
    const payload = darkBrandIcon.slice(comma + 1);
    const svg = darkBrandIcon.slice(0, comma).endsWith(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
    for (const color of ['#387c65', '#275f50', '#9cd9b5', '#f4d492']) assert.ok(svg.includes(color), `The embedded dark artwork includes ${color}`);
  } else {
    assert.match(darkBrandIcon, /\/icon-dark(?:-[\w-]+)?\.svg$/);
  }
  await main.evaluate("smokeElectron.Menu.getApplicationMenu().getMenuItemById('theme-light').click()");
  await waitFor(async () => ui("document.documentElement.dataset.theme === 'light' && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'native Light menu');
  await main.evaluate("smokeElectron.Menu.getApplicationMenu().getMenuItemById('theme-dark').click()");
  await waitFor(async () => ui("document.documentElement.dataset.theme === 'dark' && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'native Dark menu');
  assert.equal(await ui("getComputedStyle(document.body).backgroundColor"), 'rgb(13, 17, 23)');
  assert.equal(await ui("getComputedStyle(document.querySelector('.paper')).backgroundColor"), 'rgb(13, 17, 23)');
  assert.equal(await ui("getComputedStyle(document.body).getPropertyValue('--accent').trim()"), '#87d5ba');
  assert.equal(await ui("getComputedStyle(document.querySelector('.primary')).backgroundColor"), 'rgb(40, 115, 93)');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('.sidebar [data-theme-option]'), option => option.textContent)"), ['Light', 'Dark']);
  assert.equal(await ui("document.querySelector('[data-theme-option=dark]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await ui("localStorage.getItem('markdown-studio-theme')"), 'dark');
  assert.equal(await main.evaluate("smokeElectron.Menu.getApplicationMenu().getMenuItemById('theme-dark').checked"), true);
  assert.equal(await main.evaluate("Boolean(smokeElectron.Menu.getApplicationMenu().getMenuItemById('theme-github-dark'))"), false);
  assert.equal(await main.evaluate("smokeElectron.nativeTheme.themeSource"), 'dark');
  assert.equal(await brandSource(), darkBrandIcon);
  await ui("document.querySelector('[data-theme-option=light]').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'light theme selector');
  assert.equal(await ui("getComputedStyle(document.body).backgroundColor"), 'rgb(248, 250, 248)');
  assert.equal(await main.evaluate("smokeElectron.Menu.getApplicationMenu().getMenuItemById('theme-light').checked"), true);
  assert.equal(await main.evaluate("smokeElectron.nativeTheme.themeSource"), 'light');
  assert.equal(await brandSource(), lightBrandIcon);
  await menuAction('theme');
  await menuAction('focus');
  assert.equal(await ui("document.body.classList.contains('focus-mode')"), true);
  await menuAction('focus');
  assert.equal(await ui("Boolean(document.querySelector('[data-action=focus]'))"), false);
  const workspaceSpacing = await ui("(() => {const bar=document.querySelector('.workspace-bar');const modes=document.querySelector('.mode-switch');const tabs=document.querySelector('.tabs-bar');return {top:modes.getBoundingClientRect().top-tabs.getBoundingClientRect().bottom,paddingTop:getComputedStyle(bar).paddingTop,paddingBottom:getComputedStyle(bar).paddingBottom};})()");
  assert.ok(workspaceSpacing.top >= 14, JSON.stringify(workspaceSpacing));
  assert.equal(workspaceSpacing.paddingTop, '14px');
  assert.equal(workspaceSpacing.paddingBottom, '14px');
  await action('sidebar');
  assert.equal(await ui("document.querySelector('#sidebar').hidden"), true);
  assert.equal(await ui("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), 'false');
  assert.equal(await ui("getComputedStyle(document.querySelector('.topbar')).display"), 'flex');
  await menuAction('focus');
  await menuAction('focus');
  assert.equal(await ui("document.querySelector('#sidebar').hidden"), true, 'Leaving Focus mode restores hidden-sidebar preference');
  await action('sidebar');
  assert.equal(await ui("document.querySelector('#sidebar').hidden"), false);
  assert.ok(await ui("document.querySelector('#sidebar-resizer').getBoundingClientRect().width") >= 8);
  const sidebarDrag = await ui("(() => {const handle=document.querySelector('#sidebar-resizer').getBoundingClientRect();return {x:handle.x+handle.width/2,y:handle.y+handle.height/2};})()");
  await browser.call('Input.dispatchMouseEvent', {type:'mousePressed',x:sidebarDrag.x,y:sidebarDrag.y,button:'left',buttons:1,clickCount:1}, sessionId);
  await browser.call('Input.dispatchMouseEvent', {type:'mouseMoved',x:sidebarDrag.x+100,y:sidebarDrag.y,button:'left',buttons:1}, sessionId);
  await browser.call('Input.dispatchMouseEvent', {type:'mouseReleased',x:sidebarDrag.x+100,y:sidebarDrag.y,button:'left',buttons:0,clickCount:1}, sessionId);
  await waitFor(async () => ui("localStorage.getItem('markdown-studio-sidebar-width') === '320'"), 'sidebar drag remembered');
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 320);
  assert.equal(await ui("document.body.classList.contains('resizing-sidebar')"), false);
  await ui("document.querySelector('#sidebar-resizer').focus()");
  await nativeShortcut('Right', [], false);
  await waitFor(async () => ui("document.querySelector('#sidebar-resizer').getAttribute('aria-valuenow') === '330'"), 'keyboard sidebar resize');
  await nativeShortcut('Home', [], false);
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 200);
  await nativeShortcut('End', [], false);
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 480);
  await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].setSize(850,600)");
  await waitFor(async () => ui("document.querySelector('#sidebar').getBoundingClientRect().width <= window.innerWidth - 480"), 'sidebar constrained in narrow window');
  assert.equal(await ui("localStorage.getItem('markdown-studio-sidebar-width')"), '480', 'Window resizing retains preferred width');
  await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].setSize(1320,900)");
  await waitFor(async () => ui("document.querySelector('#sidebar').getBoundingClientRect().width === 480"), 'sidebar preferred width restored');
  await ui("document.querySelector('#sidebar-resizer').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 220);
  await ui("document.querySelector('#sidebar-resizer').focus()");
  await nativeShortcut('Right', [], false);
  await waitFor(async () => ui("localStorage.getItem('markdown-studio-sidebar-width') === '230'"), 'sidebar reset and subsequent resize');
  await menuAction('focus');
  await action('sidebar');
  assert.equal(await ui("document.body.classList.contains('focus-mode')"), false);
  assert.equal(await ui("document.querySelector('#sidebar').hidden"), false);
  console.log('PASS: sidebar-only toggle, focus-mode restoration, accessible state, and 14px top/bottom workspace spacing');
  await nativeShortcut('B', ['control', 'shift']);
  await waitFor(async () => ui("document.querySelector('#sidebar').hidden"), 'native sidebar shortcut');
  assert.equal(await ui("localStorage.getItem('markdown-studio-sidebar-hidden')"), 'true');
  await action('help');
  assert.equal(await ui("document.querySelector('#help-dialog').open"), true);
  await ui("document.querySelector('#help-dialog').close()");
  console.log('PASS: theme, focus mode, and getting-started dialog');

  await action('new');
  await action('source');
  await sourceEdit(`- [ ] ${'A long task that wraps onto another line. '.repeat(5)}\n  - [x] Nested checked task\n- [x] Checked task`);
  await action('visual');
  await ui("document.querySelector('.paper').style.width='360px'");
  assert.ok(await ui("(() => { const p = document.querySelector('.tiptap ul[data-type=taskList] li > div > p'); return p.getBoundingClientRect().height > parseFloat(getComputedStyle(p).lineHeight) * 2; })()"));
  const wrappedAlignment = await taskOffsets();
  assert.ok(wrappedAlignment.length >= 3 && wrappedAlignment.every(offset => offset <= 1), `Wrapped and nested dark-mode tasks must align within 1px: ${wrappedAlignment}`);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  console.log('PASS: wrapped, nested, checked, and unchecked tasks align in dark mode');
  await menuAction('theme:dark');
  assert.equal(await ui("document.documentElement.dataset.theme"), 'dark');
  assert.equal(await brandSource(), darkBrandIcon);
  console.log('PASS: only Light and teal-accented GitHub-based Dark, selector, native title-bar mode, synchronized menu, and saved preference');
  console.log('PASS: sidebar artwork switches through all theme controls, restores the original in Light, and uses the brighter variant in Dark');

  await selectTab(secondTab);
  await action('source');
  await sourceEdit('# Recoverable first draft\n\nFirst unsaved words');
  await action('new');
  await sourceEdit('# Recoverable second draft\n\nSecond unsaved words');
  const recoveredName = await ui("document.querySelector('#filename').textContent");
  await waitFor(async () => ui("JSON.parse(localStorage.getItem('markdown-studio-draft-v1'))?.documents.length === 2"), 'both recovery drafts persisted');
  await ui("localStorage.setItem('markdown-studio-sidebar-width','invalid')");
  await browser.call('Page.reload', {}, sessionId);
  await waitFor(async () => ui("document.querySelector('#recovery-banner') && !document.querySelector('#recovery-banner').hidden && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'draft recovery');
  assert.equal(await ui("document.querySelector('#sidebar').hidden"), true, 'Sidebar preference survives reload');
  await action('sidebar');
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 220, 'Invalid sidebar width uses the default without blocking draft recovery');
  assert.match(await ui("document.querySelector('#notification').textContent"), /Sidebar width could not be read/);
  await ui("document.querySelector('#sidebar-resizer').focus()");
  await nativeShortcut('Right', [], false);
  await waitFor(async () => ui("localStorage.getItem('markdown-studio-sidebar-width') === '230'"), 'valid sidebar width saved');
  await ui("globalThis.smokeBeforeWidthReload = true");
  await browser.call('Page.reload', {}, sessionId);
  await waitFor(async () => ui("!globalThis.smokeBeforeWidthReload && document.querySelector('#sidebar-resizer') && document.querySelector('#app')?.getAttribute('aria-busy') === 'false'"), 'sidebar width reload');
  assert.equal(await ui("document.querySelector('#sidebar').getBoundingClientRect().width"), 230, 'Sidebar width survives reload');
  assert.equal(await ui("document.querySelector('#sidebar-resizer').getAttribute('aria-valuenow')"), '230');
  console.log('PASS: sidebar drag/keyboard limits, reset, narrow-window constraint, preferred-width restoration, persistence across reload, and recovery despite invalid width');
  await action('recover');
  assert.equal(await tabCount(), 3);
  assert.match(await ui("document.querySelector('.tiptap').textContent"), /Second unsaved words/);
  assert.match(await ui("document.querySelector('#save-status').textContent"), /Unsaved/);
  assert.equal(await ui("document.querySelector('#filename').textContent"), `Recovered - ${recoveredName}`);
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'recovered.md'))}`);
  await action('save');
  assert.match(await readFile(path.join(temporary, 'recovered.md'), 'utf8'), /Second unsaved words/);
  assert.equal(await ui("JSON.parse(localStorage.getItem('markdown-studio-draft-v1')).documents.length"), 1);
  await menuAction('previous-tab');
  assert.match(await ui("document.querySelector('.tiptap').textContent"), /First unsaved words/);
  await main.evaluate(`smokeSavePath = ${JSON.stringify(path.join(temporary, 'recovered-first.md'))}`);
  await action('save');
  assert.equal(await ui("localStorage.getItem('markdown-studio-draft-v1')"), null);
  console.log('PASS: all unsaved tabs recover separately, and saving one retains the other draft');

  await main.evaluate(`
    globalThis.smokeContextMenu = null;
    globalThis.smokeClipboard = '';
    globalThis.smokeClipboardImage = smokeElectron.nativeImage.createEmpty();
    smokeElectron.Menu.prototype.popup = function () { smokeContextMenu = this; };
    smokeElectron.clipboard.readText = () => smokeClipboard;
    smokeElectron.clipboard.writeText = text => { smokeClipboard = text; };
    globalThis.smokeImageReads = 0;
    smokeElectron.clipboard.readImage = () => { smokeImageReads++; return smokeClipboardImage; };
    smokeElectron.clipboard.writeImage = image => { smokeClipboardImage = image; };
    globalThis.smokeMenuItem = labels => {
      let menu = smokeContextMenu;
      let item;
      for (const label of labels) {
        item = menu.items.find(entry => entry.label === label);
        if (!item) throw new Error('Missing context item: ' + label);
        menu = item.submenu;
      }
      return item;
    };
  `);
  const showContext = async (selector = '.tiptap p') => {
    await main.evaluate('smokeContextMenu = null');
    const point = await ui(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({block:'center'});
      const box = element.getBoundingClientRect();
      return {x:box.x + 12,y:box.y + 12};
    })()`);
    await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', buttons: 2, clickCount: 1 }, sessionId);
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', buttons: 0, clickCount: 1 }, sessionId);
    await waitFor(async () => main.evaluate('Boolean(smokeContextMenu)'), 'native right-click menu');
  };
  const contextAction = async labels => {
    await main.evaluate(`smokeMenuItem(${JSON.stringify(labels)}).click()`);
    await delay(100);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), labels.join(' / '));
  };
  const selectParagraph = async () => {
    await ui(`(() => {
    const paragraph = document.querySelector('.tiptap p');
    paragraph.closest('.tiptap').focus();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    })()`);
    await delay(80);
  };

  await action('new');
  await action('visual');
  await ui("document.querySelector('.tiptap').focus()");
  await browser.call('Input.insertText', { text: 'Menu words' }, sessionId);
  await selectParagraph();
  await showContext();
  assert.equal(await main.evaluate("smokeMenuItem(['Table']).enabled"), true, 'Table menu is available before a table exists');
  assert.equal(await main.evaluate("smokeMenuItem(['Table', 'Insert table...']).enabled"), true);
  assert.equal(await main.evaluate("smokeMenuItem(['Table', 'Add row after']).enabled"), false);
  assert.equal(await main.evaluate("smokeMenuItem(['Copy / Paste As', 'Copy selection as Markdown']).enabled"), true, 'Right-click preserves the selected text');
  assert.ok(await main.evaluate("smokeMenuItem(['Formatting']).submenu.items.length >= 9"));
  assert.equal(await main.evaluate("smokeMenuItem(['Paragraph']).submenu.items.filter(item => item.label.startsWith('Heading')).length"), 6);
  for (const label of ['Footnote (Source)', 'Link reference (Source)', 'Math block (Source)', 'Table of contents', 'YAML front matter (Source)', 'Paragraph before', 'Paragraph after']) {
    assert.ok(await main.evaluate(`Boolean(smokeMenuItem(['Insert', ${JSON.stringify(label)}]))`));
  }
  await contextAction(['Formatting', 'Bold']);
  assert.equal(await ui("document.querySelector('.tiptap strong').textContent"), 'Menu words');
  await contextAction(['Paragraph', 'Heading 2']);
  assert.equal(await ui("document.querySelector('.tiptap h2').textContent"), 'Menu words');
  await showContext('.tiptap h2');
  assert.equal(await main.evaluate("smokeMenuItem(['Paragraph', 'Heading 2']).checked"), true);
  await contextAction(['Paragraph', 'Paragraph']);
  await selectParagraph();
  await showContext();
  await contextAction(['Copy / Paste As', 'Copy selection as Markdown']);
  assert.match(await main.evaluate('smokeClipboard'), /\*\*Menu words\*\*/);
  await contextAction(['Copy / Paste As', 'Copy document as Markdown']);
  assert.match(await main.evaluate('smokeClipboard'), /Menu words/);
  await contextAction(['Insert', 'Paragraph before']);
  await contextAction(['Insert', 'Paragraph after']);
  assert.ok(await ui("document.querySelectorAll('.tiptap p').length") >= 3);
  await contextAction(['Insert', 'Table']);
  assert.equal(await ui("document.querySelector('#table-dialog').open"), true);
  assert.equal(await ui("document.querySelector('#table-columns').value"), '3');
  assert.equal(await ui("document.querySelector('#table-rows').value"), '4');
  if (process.env.STUDIO_SCREENSHOT) {
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(path.join(path.dirname(process.env.STUDIO_SCREENSHOT), 'insert-table-dialog.png'), Buffer.from(screenshot.data, 'base64'));
  }
  await ui("document.querySelector('#table-columns').value='5'; document.querySelector('#table-rows').value='7'; document.querySelector('#table-dialog button[value=insert]').click()");
  await waitFor(async () => ui("!document.querySelector('#table-dialog').open && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'chosen visual table dimensions');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('.tiptap tr'), row => row.children.length)"), Array(7).fill(5));
  await showContext('.tiptap td p');
  assert.equal(await main.evaluate("smokeMenuItem(['Table']).enabled"), true);
  await contextAction(['Table', 'Add row after']);
  assert.equal(await ui("document.querySelectorAll('.tiptap tr').length"), 8);
  console.log('PASS: actual right-click menus format text, change headings, copy Markdown, insert paragraphs/tables, and edit table rows');
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');

  await action('new');
  await action('source');
  await sourceEdit('Before table\n\nAfter table');
  await ui("document.querySelector('#source-editor').setSelectionRange(14,14)");
  await showContext('#source-editor');
  assert.equal(await main.evaluate("smokeMenuItem(['Table']).enabled"), true);
  await contextAction(['Table', 'Insert table...']);
  await ui("document.querySelector('#table-dialog button[value=cancel]').click()");
  assert.equal(await ui("document.querySelector('#source-editor').value"), 'Before table\n\nAfter table');
  await ui("document.querySelector('#source-editor').setSelectionRange(14,14)");
  await action('table');
  for (const [rows, columns] of [['0','3'], ['4','51'], ['101','3'], ['2.5','3'], ['','3']]) {
    await ui(`document.querySelector('#table-rows').value=${JSON.stringify(rows)}; document.querySelector('#table-columns').value=${JSON.stringify(columns)}; document.querySelector('#table-dialog button[value=insert]').click()`);
    assert.equal(await ui("document.querySelector('#table-dialog').open"), true);
    assert.equal(await ui("document.querySelector('#table-form').checkValidity()"), false);
    assert.equal(await ui("document.querySelector('#source-editor').value"), 'Before table\n\nAfter table');
  }
  await ui("document.querySelector('#table-rows').value='100'; document.querySelector('#table-columns').value='50'");
  assert.equal(await ui("document.querySelector('#table-form').checkValidity()"), true, 'Inclusive maximum table dimensions are accepted');
  await ui("document.querySelector('#table-rows').value='4'; document.querySelector('#table-columns').value='3'; document.querySelector('#table-dialog button[value=insert]').click()");
  await waitFor(async () => ui("!document.querySelector('#table-dialog').open && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'source table insertion');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Before table[\s\S]*\| Column 1 \| Column 2 \| Column 3 \|[\s\S]*After table/);
  await action('visual');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('.tiptap tr'), row => row.children.length)"), [3,3,3,3]);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  await action('new');
  await action('visual');
  await nativeShortcut('T');
  await waitFor(async () => ui("document.querySelector('#table-dialog').open"), 'native Ctrl+T table dialog');
  await ui("document.querySelector('#table-rows').value='1'; document.querySelector('#table-columns').value='1'; document.querySelector('#table-columns').focus()");
  await browser.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'}, sessionId);
  await browser.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}, sessionId);
  await waitFor(async () => ui("!document.querySelector('#table-dialog').open && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'minimum table size');
  assert.equal(await ui("document.querySelectorAll('.tiptap tr').length"), 1);
  assert.equal(await ui("document.querySelectorAll('.tiptap th').length"), 1);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  console.log('PASS: row/column dialog from context menus, toolbar and shortcut action; cancellation, invalid dimensions, exact Visual/Source table shapes, and 1x1 minimum');

  await action('new');
  await action('visual');
  await showContext();
  await main.evaluate("smokeClipboard = '**Pasted Markdown**\\n\\n- A list item'");
  await contextAction(['Copy / Paste As', 'Paste as Markdown']);
  assert.equal(await ui("document.querySelector('.tiptap strong').textContent"), 'Pasted Markdown');
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  await action('new');
  await action('source');
  await sourceEdit('Plain paragraph');
  await showContext('#source-editor');
  await contextAction(['Paragraph', 'Heading 1']);
  assert.match(await ui("document.querySelector('#source-editor').value"), /^# Plain paragraph/);
  await contextAction(['Paragraph', 'Paragraph']);
  assert.equal(await ui("document.querySelector('#source-editor').value"), 'Plain paragraph');
  await ui("document.querySelector('#source-editor').setSelectionRange(0,5)");
  await main.evaluate("smokeClipboard = 'New'");
  await contextAction(['Copy / Paste As', 'Paste as Markdown']);
  assert.equal(await ui("document.querySelector('#source-editor').value"), 'New paragraph', 'Source paste replaces the selection');
  await ui("document.querySelector('#source-editor').setSelectionRange(0,3)");
  await contextAction(['Insert', 'Footnote (Source)']);
  assert.match(await ui("document.querySelector('#source-editor').value"), /^New\[\^1\] paragraph/, 'Footnote insertion retains selected text');
  await contextAction(['Insert', 'Footnote (Source)']);
  assert.match(await ui("document.querySelector('#source-editor').value"), /\[\^1\]: Footnote text/);
  assert.match(await ui("document.querySelector('#source-editor').value"), /\[\^2\]: Footnote text/);
  await contextAction(['Insert', 'Link reference (Source)']);
  await contextAction(['Insert', 'Math block (Source)']);
  await contextAction(['Insert', 'YAML front matter (Source)']);
  const advanced = await ui("document.querySelector('#source-editor').value");
  assert.match(advanced, /^---\ntitle:/);
  assert.match(advanced, /\[link-1\]: https:\/\/example.com/);
  assert.match(advanced, /\$\$\nx\^2 \+ y\^2 = z\^2\n\$\$/);
  await contextAction(['Insert', 'YAML front matter (Source)']);
  assert.equal(await ui("document.querySelector('#source-editor').value"), advanced);
  assert.match(await ui("document.querySelector('#notification').textContent"), /already starts with/);
  console.log('PASS: source-mode menu headings and advanced inserts preserve Markdown, use unique references, and guard existing YAML');
  await sourceEdit('# Intro\n\n**Bold**\n\n## Next\n');
  await ui("document.querySelector('#source-editor').setSelectionRange(0,0)");
  await showContext('#source-editor');
  await contextAction(['Insert', 'Table of contents']);
  assert.match(await ui("document.querySelector('#source-editor').value"), /\[Intro\]\(#intro\)/);
  await action('visual');
  assert.equal(await ui("document.querySelector('.tiptap h1').textContent"), 'Intro');
  await ui("document.querySelector('.tiptap a[href=\"#intro\"]').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'contents navigation');
  assert.doesNotMatch(await ui("document.querySelector('#notification').textContent"), /That heading was not found/);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  console.log('PASS: Paste as Markdown renders formatted content, and generated table-of-contents links navigate to headings');

  await action('new');
  await action('visual');
  await main.evaluate(`smokeClipboardImage = smokeElectron.nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(testPNG(24,16).toString('base64'))}, 'base64'))`);
  await showContext();
  await contextAction(['Paste']);
  await waitFor(async () => ui("document.querySelector('.tiptap img')?.naturalWidth === 24"), 'right-click image paste');
  assert.ok(await ui("document.querySelector('.tiptap img').getAttribute('data-studio-source').startsWith('data:image/png;base64,')"));
  await showContext('.tiptap img');
  await contextAction(['Copy image']);
  assert.deepEqual(await main.evaluate('smokeClipboardImage.getSize()'), { width: 24, height: 16 });
  await menuAction('insert:after');
  const imageCount = await ui("document.querySelectorAll('.tiptap img').length");
  await main.evaluate('smokeImageReads = 0');
  await nativeShortcut('V');
  await waitFor(async () => ui(`document.querySelectorAll('.tiptap img').length === ${imageCount + 1} && document.querySelector('#app').getAttribute('aria-busy') === 'false'`), 'Ctrl+V image paste').catch(async error => {
    console.error('Clipboard reads:', await main.evaluate('smokeImageReads'));
    console.error(await ui("JSON.stringify({activeTag:document.activeElement?.tagName,busy:document.querySelector('#app').getAttribute('aria-busy'),images:document.querySelectorAll('.tiptap img').length})"));
    throw error;
  });
  assert.ok(await main.evaluate('smokeImageReads') >= 2, 'Editor Ctrl+V uses the native image clipboard path');
  const clipboardFile = path.join(temporary, 'clipboard-images.md');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(clipboardFile)}`);
  await action('save');
  assert.match(await readFile(clipboardFile, 'utf8'), /data:image\/png;base64,/);
  for (const format of ['pdf', 'docx']) {
    const file = path.join(temporary, `clipboard-images.${format}`);
    await main.evaluate(`smokeSavePath = ${JSON.stringify(file)}`);
    await menuAction(`export-${format}`);
    const data = await readFile(file);
    assert.ok(data.length > 1000);
    if (format === 'pdf') assert.match(data.toString('latin1'), /\/Subtype\s*\/Image\b/);
    else assert.equal(data.subarray(0,2).toString(), 'PK');
  }
  await menuAction('close-tab');
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(clipboardFile)}`);
  await action('open');
  await waitFor(async () => ui("document.querySelector('.tiptap img')?.naturalWidth === 24"), 'saved pasted image reopens');
  await menuAction('close-tab');
  await action('new');
  await action('source');
  await showContext('#source-editor');
  await contextAction(['Copy / Paste As', 'Paste image']);
  assert.match(await ui("document.querySelector('#source-editor').value"), /!\[Image\]\(data:image\/png;base64,/);
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  await action('new');
  await action('visual');
  await ui(`(() => {
    const data = Uint8Array.from(atob(${JSON.stringify(testPNG(12,8).toString('base64'))}), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'clipboard.png', {type:'image/png'}));
    document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true}));
  })()`);
  await waitFor(async () => ui("document.querySelector('.tiptap img')?.naturalWidth === 12 && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'clipboard image-file paste event');
  await main.evaluate(`(() => {
    smokeClipboardImage = smokeElectron.nativeImage.createEmpty();
    globalThis.smokeNativePasteCalls = 0;
    const contents = smokeElectron.BrowserWindow.getAllWindows()[0].webContents;
    globalThis.smokeOriginalPaste = contents.paste;
    contents.paste = () => { smokeNativePasteCalls++; };
  })()`);
  await nativeShortcut('V');
  await waitFor(async () => main.evaluate('smokeNativePasteCalls === 1'), 'native rich-text paste fallback');
  await action('source');
  await nativeShortcut('V');
  await waitFor(async () => main.evaluate('smokeNativePasteCalls === 2'), 'native source paste fallback');
  await action('visual');
  await main.evaluate('smokeElectron.BrowserWindow.getAllWindows()[0].webContents.paste = smokeOriginalPaste');
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  console.log('PASS: image clipboard copy/paste, native Paste and source embedding, save/reopen, Word/PDF export, and image-file paste events');

  const codeBodies = [
    '$vmName = "demo"\n\n  # Keep indentation\nGet-AzVM -Name $vmName',
    '{\n  "enabled": true,\n  "count": 42\n}',
    'const leavePlain = 42;',
    '<script>window.__codeDidRun = true</script>\n  custom text',
  ];
  const languageFixture = '# Code language test\n\n' + codeBodies.map((body, index) =>
    `\`\`\`${['powershell', 'json', '', 'my-custom-language'][index]}\n${body}\n\`\`\``).join('\n\n');
  await action('new');
  await action('source');
  await sourceEdit(languageFixture);
  await action('visual');
  const codeText = () => ui("Array.from(document.querySelectorAll('.code-block pre code'), code => code.textContent)");
  assert.deepEqual(await codeText(), codeBodies);
  assert.equal(await ui("document.querySelectorAll('.code-block').length"), 4);
  assert.ok(await ui("document.querySelector('.code-block .hljs-variable') !== null"));
  assert.equal(await ui("document.querySelectorAll('.code-block')[2].querySelectorAll('[class*=hljs-]').length"), 0);
  assert.equal(await ui("document.querySelectorAll('.code-block')[3].querySelectorAll('[class*=hljs-]').length"), 0);
  assert.equal(await ui("typeof window.__codeDidRun"), 'undefined');
  await menuAction('focus');
  await ui("document.querySelector('.code-language').click()");
  await browser.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
  await browser.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
  assert.equal(await ui("document.querySelectorAll('.code-language-picker:popover-open').length"), 0);
  assert.equal(await ui("document.body.classList.contains('focus-mode')"), true, 'Closing a language picker does not leave Focus mode');
  await menuAction('focus');
  const chooseCodeLanguage = async (block, query, id) => {
    await ui(`document.querySelectorAll('.code-language')[${block}].click()`);
    await ui(`(() => {const search=document.querySelector('.code-language-picker:popover-open input');search.value=${JSON.stringify(query)};search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await ui(`document.querySelector('.code-language-picker:popover-open [data-language=${JSON.stringify(id)}]').click()`);
  };
  await chooseCodeLanguage(0, 'javascript', 'javascript');
  assert.match(await ui("document.querySelector('.code-language').textContent"), /JavaScript/);
  assert.deepEqual(await codeText(), codeBodies);
  await menuAction('undo');
  assert.match(await ui("document.querySelector('.code-language').textContent"), /PowerShell/);
  await menuAction('redo');
  assert.match(await ui("document.querySelector('.code-language').textContent"), /JavaScript/);
  await ui("document.querySelector('.code-language').click(); const search=document.querySelector('.code-language-picker:popover-open input');search.value='ps1';search.dispatchEvent(new Event('input',{bubbles:true}));search.focus()");
  assert.equal(await ui("document.querySelectorAll('.code-language-picker:popover-open [role=option]').length"), 1);
  await browser.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'}, sessionId);
  await browser.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}, sessionId);
  assert.match(await ui("document.querySelector('.code-language').textContent"), /PowerShell/);
  assert.deepEqual(await codeText(), codeBodies);
  await chooseCodeLanguage(1, 'plain', 'plaintext');
  assert.equal(await ui("document.querySelectorAll('.code-block')[1].querySelectorAll('[class*=hljs-]').length"), 0);
  await menuAction('theme:light');
  assert.equal(await ui("getComputedStyle(document.querySelector('.code-block .hljs-variable')).color"), 'rgb(5, 80, 174)');
  await menuAction('theme:dark');
  assert.equal(await ui("getComputedStyle(document.querySelector('.code-block .hljs-variable')).color"), 'rgb(121, 192, 255)');
  await ui(`(() => {
    const code=document.querySelector('.code-block pre code');
    const range=document.createRange();range.selectNodeContents(code);range.collapse(false);
    code.closest('.tiptap').focus();getSelection().removeAllRanges();getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await delay(80);
  await browser.call('Input.insertText', {text:'\n# Edited in Visual mode'}, sessionId);
  codeBodies[0] += '\n# Edited in Visual mode';
  assert.deepEqual(await codeText(), codeBodies);
  await ui("document.querySelector('.copy-code').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'copy raw code');
  assert.equal(await main.evaluate('smokeClipboard'), codeBodies[0]);
  const codeFile = path.join(temporary, 'code-languages.md');
  await main.evaluate(`smokeSavePath = ${JSON.stringify(codeFile)}`);
  await action('save');
  const savedCode = await readFile(codeFile, 'utf8');
  assert.match(savedCode, /```powershell/);
  assert.match(savedCode, /```my-custom-language/);
  assert.doesNotMatch(savedCode, /```json|Search languages|copy-code|code-language-picker/);
  for (const body of codeBodies) assert.ok(savedCode.includes(body), 'Code text is preserved in Markdown');
  await action('source');
  assert.equal(await ui("document.querySelector('#source-editor').value"), savedCode);
  await action('visual');
  assert.deepEqual(await codeText(), codeBodies);
  await action('new');
  await menuAction('previous-tab');
  assert.deepEqual(await codeText(), codeBodies);
  await menuAction('next-tab');
  await menuAction('close-tab');
  for (const format of ['pdf', 'docx']) {
    const output = path.join(temporary, `code-languages.${format}`);
    await main.evaluate(`smokeSavePath = ${JSON.stringify(output)}`);
    await menuAction(`export-${format}`);
    const bytes = await readFile(output);
    assert.ok(bytes.length > 1000);
    assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK');
  }
  if (process.env.STUDIO_SCREENSHOT) {
    await ui("document.querySelector('.code-language').click()");
    const screenshot = await browser.call('Page.captureScreenshot', { format:'png' }, sessionId);
    await writeFile(path.join(path.dirname(process.env.STUDIO_SCREENSHOT), 'code-language-picker.png'), Buffer.from(screenshot.data, 'base64'));
    await ui("document.querySelector('.code-language-picker:popover-open').hidePopover()");
  }
  await menuAction('close-tab');
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(codeFile)}`);
  await action('open');
  assert.deepEqual(await codeText(), codeBodies);
  assert.match(await ui("document.querySelector('.code-language').textContent"), /PowerShell/);
  await menuAction('close-tab');
  console.log('PASS: searchable code languages, alias/keyboard selection, per-block colors, undo/redo, raw copy, real visual editing, safe unknown/plain fences, mode/tab isolation, save/reopen and native PDF/Word exports');

  const historyPath = path.join(temporary, 'profile', 'recent-files.json');
  const historyBackup = path.join(temporary, 'profile', 'recent-files.backup');
  const recentCount = await ui("document.querySelectorAll('#recent button').length");
  assert.ok(recentCount > 0);
  assert.equal(await ui("document.querySelector('#recent').hidden"), true, 'Recent Files starts collapsed');
  assert.equal(await ui("document.querySelector('#recent-toggle').getAttribute('aria-expanded')"), 'false');
  assert.equal(await ui("document.querySelector('#recent-count').textContent"), `(${recentCount})`);
  const collapsedOutlineHeight = await ui("document.querySelector('#outline').getBoundingClientRect().height");
  await ui("document.querySelector('#recent-toggle').click()");
  assert.equal(await ui("document.querySelector('#recent').hidden"), false);
  assert.equal(await ui("localStorage.getItem('markdown-studio-recent-expanded')"), 'true');
  assert.ok(await ui("document.querySelector('#outline').getBoundingClientRect().height") < collapsedOutlineHeight, 'Collapsing history gives space back to the outline');
  assert.equal(await ui("getComputedStyle(document.querySelector('#recent')).overflowY"), 'auto');
  assert.ok(await ui("document.querySelector('#recent').getBoundingClientRect().height") <= 180);
  assert.equal(await ui("document.querySelector('#clear-recent').hidden"), false);
  await rename(historyPath, historyBackup);
  await mkdir(historyPath);
  await action('clear-recent');
  assert.equal(await ui("document.querySelector('#notification').classList.contains('error')"), true);
  assert.equal(await ui("document.querySelectorAll('#recent button').length"), recentCount);
  assert.equal(await ui("window.studio.recent().then(result => result.value.length)"), recentCount);
  await rmdir(historyPath);
  await rename(historyBackup, historyPath);
  const beforeClear = await ui("JSON.stringify({tabs:Array.from(document.querySelectorAll('.document-tab'), tab => tab.dataset.documentId),active:document.querySelector('.document-tab.selected').dataset.documentId,text:document.querySelector('.tiptap').textContent})");
  const documentBeforeClear = await readFile(copied, 'utf8');
  await action('clear-recent');
  assert.equal(await ui("document.querySelectorAll('#recent button').length"), 0);
  assert.equal(await ui("document.querySelector('#clear-recent').disabled"), true);
  assert.deepEqual(JSON.parse(await readFile(historyPath, 'utf8')), []);
  assert.equal(await ui("JSON.stringify({tabs:Array.from(document.querySelectorAll('.document-tab'), tab => tab.dataset.documentId),active:document.querySelector('.document-tab.selected').dataset.documentId,text:document.querySelector('.tiptap').textContent})"), beforeClear);
  assert.equal(await readFile(copied, 'utf8'), documentBeforeClear);
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(copied)}`);
  await action('open');
  assert.ok(await ui("document.querySelectorAll('#recent button').length") > 0);
  await menuAction('close-tab');
  await menuAction('clear-recent');
  console.log('PASS: clear recent history persists, preserves documents/tabs, repopulates on open, and reports write failures without clearing memory or UI');

  await ui("localStorage.setItem('markdown-studio-theme', 'github-dark'); window.addEventListener('beforeunload', () => localStorage.setItem('markdown-studio-draft-v1', JSON.stringify({content:'# Legacy recovery',name:'legacy.md'})), {once:true})");
  await browser.call('Page.reload', {}, sessionId);
  await waitFor(async () => ui("document.querySelector('#recovery-banner') && !document.querySelector('#recovery-banner').hidden && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'legacy recovery banner');
  assert.equal(await ui("document.documentElement.dataset.theme"), 'dark');
  assert.equal(await ui("document.querySelector('[data-theme-option=dark]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await ui("document.querySelector('#recent-toggle').getAttribute('aria-expanded')"), 'true', 'Recent Files preference survives reload');
  await ui("document.querySelector('#recent-toggle').click()");
  assert.equal(await ui("localStorage.getItem('markdown-studio-recent-expanded')"), 'false');
  assert.equal(await ui("localStorage.getItem('markdown-studio-theme')"), 'dark');
  assert.equal(await brandSource(), darkBrandIcon, 'The remembered dark theme restores its high-contrast sidebar icon');
  assert.equal(await ui("document.querySelectorAll('#recent button').length"), 0);
  await action('recover');
  assert.equal(await ui("document.querySelector('.tiptap h1').textContent"), 'Legacy recovery');
  await main.evaluate('smokeChoice = 1');
  await menuAction('close-tab');
  assert.equal(await tabCount(), 1);
  console.log('PASS: legacy single-document recovery, migration from GitHub Dark to Dark, and cleared recent history survive reload');

  const splitPaths = [];
  const splitIds = [];
  for (const [index, name] of ['left', 'right', 'third', 'fourth'].entries()) {
    const folder = path.join(temporary, `split-${name}`);
    await mkdir(folder);
    await writeFile(path.join(folder, 'asset.png'), testPNG(index + 2, 1));
    const file = path.join(folder, `${name}.md`);
    const body = `# Split ${name}\n\n${name} original paragraph.\n\n![Relative](asset.png)\n\n${Array.from({length:45}, (_, line) => `${name} paragraph ${line}: independently scrollable document content.`).join('\n\n')}\n`;
    await writeFile(file, body);
    splitPaths.push(file);
    await main.evaluate(`smokeOpenPath = ${JSON.stringify(file)}`);
    await action('open');
    splitIds.push(await activeTab());
  }
  assert.equal(await tabCount(), 5);
  const originalSplitOrder = await ui("Array.from(document.querySelectorAll('.document-tab'), tab => tab.dataset.documentId)");
  const pane = id => `.document-pane[data-document-id="${id}"]`;
  const paneSource = async id => ui(`document.querySelector(${JSON.stringify(pane(id) + ' .document-source')}).value`);
  const paneMode = async (id, mode) => {
    await ui(`document.querySelector(${JSON.stringify(pane(id) + ` [data-pane-mode="${mode}"]`)}).click()`);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'pane mode');
  };
  const confirmSplit = async (right, keyboard = false) => {
    const selector = `#split-documents button[data-document-id="${right}"]`;
    if (keyboard) {
      await ui(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      assert.equal(await ui(`document.activeElement.matches(${JSON.stringify(selector)})`), true);
      await browser.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'}, sessionId);
      await browser.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}, sessionId);
    } else await ui(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await waitFor(async () => ui("!document.querySelector('#split-dialog').open && document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'create split pair');
  };
  await selectTab(splitIds[0]);
  await action('split');
  assert.equal(await ui("document.querySelector('#split-dialog').open"), true);
  assert.equal(await ui("document.querySelectorAll('#split-documents .split-card').length"), 4);
  assert.equal(await ui(`Boolean(document.querySelector('#split-documents [data-document-id="${splitIds[0]}"]'))`), false, 'The current file is not offered');
  assert.match(await ui(`document.querySelector('#split-documents [data-document-id="${splitIds[1]}"] .split-preview').textContent`), /Split right/);
  await waitFor(async () => ui("Array.from(document.querySelectorAll('#split-documents img')).every(image => image.complete && image.naturalWidth > 0)"), 'thumbnail local images');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('#split-documents img'), image => image.naturalWidth)"), [3,4,5]);
  assert.equal(await activeTab(), splitIds[0], 'Opening previews does not switch the active document');
  if (process.env.STUDIO_SCREENSHOT) {
    const screenshot = await browser.call('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(path.join(path.dirname(process.env.STUDIO_SCREENSHOT), 'split-preview-picker.png'), Buffer.from(screenshot.data, 'base64'));
  }
  await ui("document.querySelector('#split-cancel').click()");
  assert.equal(await tabCount(), 5);
  assert.equal(await ui("document.querySelectorAll('#split-documents .split-card').length"), 0, 'Closing releases preview contents');
  await selectTab(splitIds[1]);
  await action('source');
  const previewOriginal = await ui("document.querySelector('#source-editor').value");
  await sourceEdit(previewOriginal.replace('right original paragraph.', '**Current unsaved preview.**'));
  await selectTab(splitIds[0]);
  await action('split');
  assert.match(await ui(`document.querySelector('#split-documents [data-document-id="${splitIds[1]}"] .split-preview strong').textContent`), /Current unsaved preview/);
  assert.match(await ui(`document.querySelector('#split-documents [data-document-id="${splitIds[1]}"]').getAttribute('aria-label')`), /unsaved changes/);
  await ui("document.querySelector('#split-cancel').click()");
  await selectTab(splitIds[1]);
  await menuAction('undo');
  assert.equal(await ui("document.querySelector('#source-editor').value"), previewOriginal, 'Previewing preserves source undo history');
  await action('visual');
  await selectTab(splitIds[0]);
  await action('split');
  await confirmSplit(splitIds[1]);
  assert.equal(await tabCount(), 4);
  assert.equal(await ui("document.querySelectorAll('.document-tab[data-paired=true]').length"), 1);
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  await selectTab(splitIds[2]);
  await action('split');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('#split-documents .split-card'), card => card.dataset.documentId)"), [originalSplitOrder[0], splitIds[3]], 'Already-paired files and the current file are excluded');
  await nativeShortcut('Escape', [], false);
  await waitFor(async () => ui("!document.querySelector('#split-dialog').open"), 'Escape cancels the preview picker');
  assert.equal(await tabCount(), 4);
  await selectTab(splitIds[0]);
  assert.equal(await ui("document.querySelector('.global-modes').hidden"), true, 'Split mode uses pane-specific controls only');
  assert.match(await ui("document.querySelector('.paired-tab .tab-select').textContent"), /left\.md.*right\.md/);
  await waitFor(async () => ui("Array.from(document.querySelectorAll('.document-pane .tiptap img')).every(image => image.complete && image.naturalWidth > 0)"), 'both split local images');
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('.document-pane .tiptap img'), image => image.naturalWidth)"), [2,3]);
  const visualAppend = async (id, text) => {
    await ui(`(() => {
      const editor=document.querySelector(${JSON.stringify(pane(id) + ' .tiptap')});
      editor.focus();
      const range=document.createRange();
      range.selectNodeContents(editor.querySelector('p'));
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    })()`);
    await browser.call('Input.insertText', {text}, sessionId);
  };
  await visualAppend(splitIds[1], ' RIGHT EDIT');
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'right.md');
  await menuAction('undo');
  assert.doesNotMatch(await ui(`document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .tiptap')}).textContent`), /RIGHT EDIT/);
  await menuAction('redo');
  await visualAppend(splitIds[0], ' LEFT EDIT');
  await menuAction('undo');
  assert.match(await ui(`document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .tiptap')}).textContent`), /RIGHT EDIT/);
  await menuAction('redo');
  await paneMode(splitIds[1], 'source');
  assert.equal(await ui(`document.querySelector(${JSON.stringify(pane(splitIds[0]) + ' .paper')}).hidden`), false);
  const rightBeforeSource = await paneSource(splitIds[1]);
  await sourceEdit(rightBeforeSource + '\nRight source edit.');
  await menuAction('undo');
  assert.equal(await paneSource(splitIds[1]), rightBeforeSource);
  await menuAction('redo');
  await ui(`document.querySelector(${JSON.stringify(pane(splitIds[0]) + ' .tiptap')}).focus()`);
  await ui(`document.querySelector(${JSON.stringify(pane(splitIds[0]) + ' .pane-content')}).scrollTop=220; const otherSource=document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .document-source')}); otherSource.setSelectionRange(7,12); otherSource.scrollTop=140`);
  await ui("document.querySelector('.split-divider').focus()");
  await browser.call('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39}, sessionId);
  await browser.call('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39}, sessionId);
  assert.equal(await ui("document.querySelector('.split-divider').getAttribute('aria-valuenow')"), '55');
  const drag = await ui("(() => {const root=document.querySelector('#canvas').getBoundingClientRect();const divider=document.querySelector('.split-divider').getBoundingClientRect();return {x:divider.x+divider.width/2,y:divider.y+divider.height/2,end:root.x+root.width*.62};})()");
  await browser.call('Input.dispatchMouseEvent', {type:'mousePressed',x:drag.x,y:drag.y,button:'left',buttons:1,clickCount:1}, sessionId);
  await browser.call('Input.dispatchMouseEvent', {type:'mouseMoved',x:drag.end,y:drag.y,button:'left',buttons:1}, sessionId);
  await browser.call('Input.dispatchMouseEvent', {type:'mouseReleased',x:drag.end,y:drag.y,button:'left',buttons:0,clickCount:1}, sessionId);
  assert.equal(await ui("document.querySelector('.split-divider').getAttribute('aria-valuenow')"), '62');
  const scrollBefore = await ui(`document.querySelector(${JSON.stringify(pane(splitIds[0]) + ' .pane-content')}).scrollTop`);
  const rightScrollBefore = await ui(`document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .document-source')}).scrollTop`);
  await selectTab(splitIds[2]);
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 1);
  assert.equal(await ui("document.querySelector('.global-modes').hidden"), false);
  assert.equal(await ui("document.querySelector('#canvas').classList.contains('is-split')"), false);
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'third.md');
  await selectTab(splitIds[0]);
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  assert.equal(await ui("document.querySelector('.split-divider').getAttribute('aria-valuenow')"), '62');
  assert.equal(await ui(`document.querySelector(${JSON.stringify(pane(splitIds[0]) + ' .pane-content')}).scrollTop`), scrollBefore);
  assert.equal(await ui(`document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .document-source')}).scrollTop`), rightScrollBefore);
  assert.deepEqual(await ui(`(() => {const source=document.querySelector(${JSON.stringify(pane(splitIds[1]) + ' .document-source')});return [source.selectionStart,source.selectionEnd];})()`), [7,12]);
  await menuAction('next-tab');
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'third.md');
  await menuAction('previous-tab');
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  await main.evaluate(`smokeOpenPath = ${JSON.stringify(splitPaths[1])}`);
  await action('open');
  assert.equal(await tabCount(), 4);
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'right.md');
  assert.equal(await ui("document.querySelector('#source-editor').hidden"), false);
  await action('save');
  assert.match(await readFile(splitPaths[1], 'utf8'), /RIGHT EDIT[\s\S]*Right source edit/);
  assert.doesNotMatch(await readFile(splitPaths[1], 'utf8'), /LEFT EDIT/);
  await action('save-all');
  assert.match(await readFile(splitPaths[0], 'utf8'), /LEFT EDIT/);
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'right.md');
  for (const format of ['pdf', 'docx']) {
    const output = path.join(temporary, `split-active-right.${format}`);
    await main.evaluate(`smokeSavePath = ${JSON.stringify(output)}`);
    await menuAction(`export-${format}`);
    assert.ok((await readFile(output)).length > 1000, 'Active-pane exports include its scoped local image');
  }
  await menuAction('focus');
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  await menuAction('focus');
  if (process.env.STUDIO_SCREENSHOT) {
    const screenshot = await browser.call('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(path.join(path.dirname(process.env.STUDIO_SCREENSHOT), 'paired-split-desktop.png'), Buffer.from(screenshot.data,'base64'));
  }
  await menuAction('unsplit');
  assert.equal(await tabCount(), 5);
  assert.deepEqual(await ui("Array.from(document.querySelectorAll('.document-tab'), tab => tab.dataset.documentId)"), originalSplitOrder);
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 1);
  console.log('PASS: thumbnail cards show live edits and scoped images, exclude current/paired files, preserve undo on Cancel/Escape, and create split pairs; both editable views, independent modes/undo/selection/scroll, keyboard/pointer resizing, normal-tab switching, group navigation, Save All, active-pane exports, and lossless unsplit');

  await selectTab(splitIds[0]);
  const tabPoint = await ui("(() => {const tab=document.querySelector('.document-tab.selected .tab-select').getBoundingClientRect();return {x:tab.x+15,y:tab.y+15};})()");
  await browser.call('Input.dispatchMouseEvent', {type:'mousePressed',...tabPoint,button:'right',buttons:2,clickCount:1}, sessionId);
  await browser.call('Input.dispatchMouseEvent', {type:'mouseReleased',...tabPoint,button:'right',buttons:0,clickCount:1}, sessionId);
  await waitFor(async () => ui("document.querySelector('#tab-context-menu').matches(':popover-open')"), 'actual tab right-click menu');
  await ui("document.querySelector('#tab-context-menu button').click()");
  await confirmSplit(splitIds[1], true);
  await paneMode(splitIds[0], 'source');
  await sourceEdit((await paneSource(splitIds[0])) + '\nPending left.');
  await paneMode(splitIds[1], 'source');
  await sourceEdit((await paneSource(splitIds[1])) + '\nPending right.');
  await waitFor(async () => ui("JSON.parse(localStorage.getItem('markdown-studio-draft-v1') || '{\"documents\":[]}').documents.length === 2"), 'recovery stores both dirty split files');
  await main.evaluate('smokeChoices=[1,2]; smokeChoice=2');
  await ui("document.querySelector('.paired-tab .tab-close').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'cancel closing paired files');
  assert.equal(await tabCount(), 4);
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  assert.match(await paneSource(splitIds[0]), /Pending left/);
  assert.match(await paneSource(splitIds[1]), /Pending right/);
  await main.evaluate('smokeChoice=2');
  await menuAction('close-tab');
  assert.equal(await ui("document.querySelectorAll('#canvas > .document-pane').length"), 2);
  await main.evaluate('smokeChoice=1');
  await menuAction('close-tab');
  assert.equal(await ui("document.querySelectorAll('.paired-tab').length"), 0);
  assert.equal(await ui("document.querySelector('#filename').textContent"), 'left.md');
  assert.match(await ui("document.querySelector('#source-editor').value"), /Pending left/);
  await menuAction('close-tab');
  await selectTab(splitIds[2]);
  await menuAction('close-tab');
  await selectTab(splitIds[3]);
  await menuAction('close-tab');
  assert.equal(await tabCount(), 1);
  for (const file of splitPaths.slice(0,2)) {
    await main.evaluate(`smokeOpenPath=${JSON.stringify(file)}`);
    await action('open');
  }
  const rightReopened = await activeTab();
  await menuAction('previous-tab');
  await action('split');
  await confirmSplit(rightReopened);
  await main.evaluate('smokeChoices=[]; smokeChoice=1');
  await ui("document.querySelector('.paired-tab .tab-close').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'close both paired files');
  assert.equal(await tabCount(), 1);
  console.log('PASS: actual tab context-menu pairing, both-side draft recovery, atomic Cancel after Discard, active-side Ctrl+W behavior, surviving partner, and closing a whole pair without closing unrelated files');

  await action('new');
  await action('source');
  const formattingKeys = [
    ['B', ['control'], '**Shortcut text**'],
    ['I', ['control'], '*Shortcut text*'],
    ['X', ['control', 'shift'], '~~Shortcut text~~'],
    ['E', ['control'], '`Shortcut text`'],
    ['8', ['control', 'shift'], '\n- Shortcut text'],
    ['7', ['control', 'shift'], '\n1. Shortcut text'],
    ['9', ['control', 'shift'], '\n- [ ] Shortcut text'],
    ['Q', ['control', 'shift'], '\n> Shortcut text'],
  ];
  for (const [key, modifiers, expected] of formattingKeys) {
    await sourceEdit('Shortcut text');
    await ui("document.querySelector('#source-editor').setSelectionRange(0,13)");
    await nativeShortcut(key, modifiers);
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), `formatting shortcut ${key}`);
    assert.equal(await ui("document.querySelector('#source-editor').value"), expected, `Native ${modifiers.join('+')}+${key} formats Source exactly once`);
  }
  for (const [key, tag] of [['B', 'strong'], ['I', 'em']]) {
    await sourceEdit('Shortcut text');
    await action('visual');
    await nativeShortcut('A');
    await waitFor(async () => ui("getSelection()?.toString() === 'Shortcut text'"), 'native Visual selection');
    await nativeShortcut(key);
    await waitFor(async () => ui(`Boolean(document.querySelector('#visual-editor ${tag}'))`), `native Visual ${key}`);
    assert.equal(await ui(`document.querySelector('#visual-editor ${tag}').textContent`), 'Shortcut text');
    await action('source');
  }
  await sourceEdit('Protected document');
  await action('find');
  await ui("document.querySelector('#find-text').focus()");
  await nativeShortcut('B', ['control'], false);
  assert.equal(await ui("document.querySelector('#source-editor').value"), 'Protected document', 'Formatting does not edit the document from Find');
  await action('find-close');
  await action('link');
  await ui("document.querySelector('#link-url').focus()");
  await nativeShortcut('I', ['control'], false);
  assert.equal(await ui("document.querySelector('#source-editor').value"), 'Protected document', 'Formatting does not edit the document from dialogs');
  await ui("document.querySelector('#link-dialog').close('cancel')");
  await sourceEdit('```python\nprint("Guarded code")\n```');
  await action('visual');
  await ui("document.querySelector('#visual-editor .code-language').click(); document.querySelector('.code-language-picker input').focus()");
  await nativeShortcut('B', ['control'], false);
  assert.equal(await ui("document.querySelector('#visual-editor pre code').textContent"), 'print("Guarded code")', 'Language search never formats document content');
  await ui("document.querySelector('.code-language-picker:popover-open').hidePopover()");
  await nativeShortcut('F1', []);
  await waitFor(async () => ui("document.querySelector('#shortcuts-dialog').open"), 'F1 keyboard reference');
  assert.match(await ui("document.querySelector('#shortcuts-dialog').textContent"), /Save all files.*Ctrl\+Alt\+S/s);
  await ui("document.querySelector('#shortcuts-dialog').close()");
  assert.match(await ui("document.querySelector('[data-command=bold]').title"), /Ctrl\+B/);
  assert.match(await ui("document.querySelector('[data-action=save]').title"), /Ctrl\+S/);
  assert.equal(await main.evaluate("smokeElectron.Menu.getApplicationMenu().items.find(item => item.label.includes('Edit')).submenu.items.find(item => item.label==='Formatting').submenu.items[0].accelerator"), 'CmdOrCtrl+B');
  const shortcutLeft = await activeTab();
  await action('new');
  const shortcutRight = await activeTab();
  await action('split');
  await confirmSplit(shortcutLeft);
  await paneMode(shortcutRight, 'source');
  await sourceEdit('Right independent');
  await ui("document.querySelector('#source-editor').setSelectionRange(0,5)");
  await nativeShortcut('B');
  assert.equal(await paneSource(shortcutRight), '**Right** independent');
  await paneMode(shortcutLeft, 'source');
  assert.equal(await paneSource(shortcutLeft), '```python\nprint("Guarded code")\n```', 'Shortcut in one pane leaves its partner unchanged');
  await ui("document.querySelector('#source-editor').setSelectionRange(0,0)");
  await nativeShortcut('I');
  assert.match(await paneSource(shortcutLeft), /^\*\*/);
  assert.equal(await paneSource(shortcutRight), '**Right** independent');
  await main.evaluate('smokeChoice=1; smokeChoices=[]');
  await ui("document.querySelector('.paired-tab .tab-close').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'close keyboard test pair');
  assert.equal(await tabCount(), 1);
  console.log('PASS: native formatting shortcuts in Source and Visual, exactly-once dispatch, isolated split-side routing, protected Find/dialog/language inputs, menu hints, tooltips and F1 reference');

  await action('new');
  await action('source');
  await sourceEdit(Array.from({length:45}, (_, index) => `## Heading ${index}\n\nSome outline content.`).join('\n\n'));
  await action('visual');
  await action('sidebar');
  if (await ui("document.querySelector('#sidebar').hidden")) await action('sidebar');
  await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].setSize(850,600)");
  await delay(250);
  assert.equal(await ui("getComputedStyle(document.querySelector('.toolbar-more')).display"), 'block');
  assert.equal(await ui("getComputedStyle(document.querySelector('.toolbar > [data-command=quote]')).display"), 'none');
  assert.ok(await ui("document.querySelector('.toolbar').scrollWidth <= document.querySelector('.toolbar').clientWidth"), 'Toolbar fits the minimum supported window');
  assert.ok(await ui("document.querySelector('.workspace-actions').getBoundingClientRect().right <= innerWidth"), 'File actions fit the minimum supported window');
  assert.ok(await ui("document.querySelector('#outline').clientHeight > 30 && document.querySelector('#outline').scrollHeight > document.querySelector('#outline').clientHeight"), 'Long outline has independently scrollable room');
  assert.ok(await ui("document.querySelector('.theme-switch').getBoundingClientRect().bottom < innerHeight"), 'Theme switch remains anchored and visible');
  await action('format-menu');
  assert.equal(await ui("document.querySelector('#format-menu').hidden"), false);
  await ui("document.querySelector('#format-menu [data-command=quote]').click()");
  assert.equal(await ui("document.querySelector('#format-menu').hidden"), true);
  assert.equal(await ui("Boolean(document.querySelector('#visual-editor blockquote'))"), true);
  await action('save-menu');
  assert.equal(await ui("document.querySelector('#save-menu').hidden"), false);
  assert.equal(await ui("document.querySelectorAll('.workspace-actions > [data-action=save-all]').length"), 0);
  const refinedSave = path.join(temporary, 'refined-save.md');
  await main.evaluate(`smokeSavePath=${JSON.stringify(refinedSave)}`);
  await action('save-all');
  assert.equal(await ui("document.querySelector('#save-menu').hidden"), true);
  assert.match(await readFile(refinedSave, 'utf8'), /Heading 0/);
  await ui("document.querySelector('[data-action=save-menu]').focus()");
  await nativeShortcut('Down', [], false);
  assert.equal(await ui("document.activeElement.dataset.action"), 'save-all');
  await nativeShortcut('Escape', [], false);
  assert.equal(await ui("document.querySelector('#save-menu').hidden"), true);
  assert.equal(await ui("document.activeElement.dataset.action"), 'save-menu');
  await ui("document.querySelector('[data-theme-option=light]').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'sidebar Light theme');
  if (process.env.STUDIO_SCREENSHOT) {
    await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].setSize(1320,900)");
    await delay(250);
    const screenshot = await browser.call('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(path.join(path.dirname(process.env.STUDIO_SCREENSHOT), 'apple-interface-light-desktop.png'), Buffer.from(screenshot.data, 'base64'));
  }
  await ui("document.querySelector('[data-theme-option=dark]').click()");
  await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'sidebar Dark theme');
  await main.evaluate("smokeElectron.BrowserWindow.getAllWindows()[0].setSize(1320,900)");
  await menuAction('close-tab');
  assert.equal(await tabCount(), 1);
  console.log('PASS: minimum-window layout, independent long-outline scrolling, anchored sidebar themes, adaptive overflow commands, actual Save All dropdown, and keyboard menu navigation');

  if (process.env.STUDIO_PUBLIC_SCREENSHOTS === '1') {
    const images = path.join(root, 'docs', 'images');
    await mkdir(images, {recursive:true});
    if (await ui("document.querySelector('#sidebar').hidden")) await action('sidebar');
    if (await ui("document.querySelector('#recent-toggle').getAttribute('aria-expanded') === 'true'")) await ui("document.querySelector('#recent-toggle').click()");
    await action('visual');
    await ui("document.querySelector('[data-theme-option=light]').click()");
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'README Light theme');
    await ui("document.querySelector('#notification').click(); document.activeElement.blur()");
    let capture = await browser.call('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(path.join(images, 'light.png'), Buffer.from(capture.data, 'base64'));
    const examples = [
      ['Project Plan.md', '# Project plan\n\nAn uncluttered place to think, write, and share.\n\n## A little structure. A lot of possibility.\n\nTurn a rough idea into a clear, shareable document.\n\n- [x] Shape the first draft\n- [ ] Add details and examples\n- [ ] Export a polished document\n\n> Good writing starts with a little breathing room.\n\n## Next steps\n\nKeep notes nearby without losing your writing flow.'],
      ['Notes.md', '# Keep the good ideas.\n\nA second document, right where you need it.\n\n## Keep the essentials close.\n\n- Edit both files without switching windows.\n- Return to this pair from its combined tab.\n\n```python\ndef write_something_good():\n    idea = "Start with a little curiosity"\n    return idea\n```\n\nPaired, not merged. Each file stays independent.'],
    ];
    const ids = [];
    for (const [name, text] of examples) {
      const file = path.join(temporary, name);
      await writeFile(file, text);
      await main.evaluate(`smokeOpenPath=${JSON.stringify(file)}`);
      await action('open');
      ids.push(await activeTab());
    }
    await selectTab(ids[0]);
    await action('split');
    await confirmSplit(ids[1]);
    await ui("document.querySelector('[data-theme-option=dark]').click()");
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'README Dark theme');
    await ui("document.querySelector('#notification').click(); document.activeElement.blur()");
    capture = await browser.call('Page.captureScreenshot', {format:'png'}, sessionId);
    await writeFile(path.join(images, 'dark-split.png'), Buffer.from(capture.data, 'base64'));
    await ui("document.querySelector('.paired-tab .tab-close').click()");
    await waitFor(async () => ui("document.querySelector('#app').getAttribute('aria-busy') === 'false'"), 'close README example pair');
    console.log('PASS: README screenshots captured from the actual Light and Dark split application with sample content');
  }
  if (process.env.STUDIO_SCREENSHOT) {
    await action('visual');
    await main.evaluate(`smokeOpenPath = ${JSON.stringify(copied)}`);
    await action('open');
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(process.env.STUDIO_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    await menuAction('close-tab');
  }
  await action('source');
  await sourceEdit('# Final unsaved draft');
  await main.evaluate('smokeChoice = 2');
  await menuAction('close-tab');
  assert.equal(await tabCount(), 1);
  assert.equal(await ui("document.querySelector('#source-editor').value"), '# Final unsaved draft');
  await main.evaluate('smokeChoice = 0; smokeSavePath = null');
  await menuAction('close-tab');
  assert.equal(await tabCount(), 1);
  assert.equal(await ui("document.querySelector('#source-editor').value"), '# Final unsaved draft');
  await main.evaluate("smokeChoice = 1; smokeElectron.BrowserWindow.getAllWindows()[0].once('closed', () => process.stdout.write('SMOKE_LAST_TAB_CLOSED\\n')); smokeElectron.BrowserWindow.getAllWindows()[0].webContents.send('app:action', 'close-tab')");
  await waitFor(() => log.includes('SMOKE_LAST_TAB_CLOSED'), 'actual final-tab window closure');
  for (const client of clients) client.socket.close();
  await waitFor(() => child.exitCode === 0, 'normal application exit after final tab', 15000);
  console.log('PASS: final-tab Cancel and canceled Save As retain edits; Discard closes the actual window and exits the application normally');
  console.log('Desktop smoke checks passed.');
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  for (const client of clients) client.socket.close();
  child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null) resolve();
    else { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); }
  });
  await delay(1000);
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
