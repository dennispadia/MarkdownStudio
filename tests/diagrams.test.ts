import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagramLimits, isMermaidLanguage, prepareMermaid } from '../lib/diagrams.js';
import { toDocx, toPrintHTML } from '../lib/export.js';
import { unzipEntries } from './zip.js';

const source = 'flowchart TD\n  A[Start] --> B[Done]\n';
const markdown = `\`\`\`mermaid\n${source}\`\`\`\n`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const image = async () => ({ data: png, mime: 'image/png' as const });
const noImage = async () => { throw new Error('Unexpected image'); };

test('Mermaid fence language detection handles case and fence metadata', () => {
  assert.equal(isMermaidLanguage('Mermaid title'), true);
  assert.equal(isMermaidLanguage(null), false);
  assert.equal(isMermaidLanguage('mermaids'), false);
});

test('Mermaid validation preserves diagrams but ignores init and frontmatter overrides', () => {
  assert.equal(prepareMermaid(source), source.trim());
  assert.equal(prepareMermaid('flowchart TD\n  Image[Click the link] --> Done[Render image]'), 'flowchart TD\n  Image[Click the link] --> Done[Render image]');
  assert.equal(prepareMermaid(`%%{init: {"securityLevel":"loose","themeCSS":"@import url(https://evil.test)"}}%%\n${source}`), source.trim());
  assert.equal(prepareMermaid(`---\nconfig:\n  securityLevel: loose\n---\n${source}`), source.trim());
});

test('Mermaid prohibits executable, linked, HTML and resource-bearing syntax', () => {
  for (const suffix of [
    'click A "https://example.com"', 'click A callback', 'A["<img src=x>"]',
    'A["&#60;script&#62;"]', 'classDef bad fill:url(https://example.com)',
    'classDef bad fill:u\\72l(//example.com)', 'A@{ img: "photo.png" }',
    'A["file:C:/secret"]', 'link A "relative.md"', 'A["data:image/svg+xml,test"]',
  ]) assert.throws(() => prepareMermaid(`${source}\n${suffix}`), /disabled/, suffix);
});

test('Mermaid work is bounded and malformed directives/types are rejected', () => {
  assert.throws(() => prepareMermaid(`flowchart TD\n${'a'.repeat(diagramLimits.sourceLength)}`), /character limit/);
  assert.throws(() => prepareMermaid(`flowchart TD\n${'A-->B\n'.repeat(251)}`), /statement limit/);
  assert.throws(() => prepareMermaid('flowchart TD\n%%{init: {}'), /Unclosed/);
  assert.throws(() => prepareMermaid('not-a-diagram'), /Unsupported/);
});

test('Mermaid exports require diagram assets rather than silently exporting source code', async () => {
  await assert.rejects(() => toPrintHTML(markdown, null), /rendered diagram image/);
  await assert.rejects(() => toDocx(markdown, noImage), /rendered diagram image/);
});

test('PDF embeds a Mermaid PNG and supplies the exact source to its loader', async () => {
  const seen: string[] = [];
  const html = await toPrintHTML(markdown, null, async value => { seen.push(value); return image(); });
  assert.deepEqual(seen, [source]);
  assert.match(html, /class="mermaid-diagram"/);
  assert.match(html, /alt="Mermaid diagram" src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /flowchart|<script/);
});

test('DOCX embeds a Mermaid PNG without source code', async () => {
  let seen = '';
  const zip = unzipEntries(await toDocx(markdown, noImage, async value => { seen = value; return image(); }));
  assert.equal(seen, source);
  assert.match(zip.get('word/document.xml')!.toString(), /Mermaid diagram/);
  assert.doesNotMatch(zip.get('word/document.xml')!.toString(), /flowchart/);
  assert.ok([...zip.keys()].some(name => /^word\/media\/.+\.png$/.test(name)));
});

test('diagram export validates source, image format and limits and propagates loader errors', async () => {
  const invalid = '```mermaid\nflowchart TD\nclick A callback\n```';
  await assert.rejects(() => toPrintHTML(invalid, null, noImage), /disabled/);
  await assert.rejects(() => toPrintHTML(markdown, null, async () => { throw new Error('Diagram failed'); }), /Diagram failed/);
  await assert.rejects(() => toDocx(markdown, noImage, async () => ({ data: Buffer.from('broken'), mime: 'image/png' })), /invalid/);
  await assert.rejects(() => toPrintHTML(markdown.repeat(33), null, image), /32 Mermaid/);
  await assert.rejects(() => toDocx(markdown.repeat(33), noImage, image), /32 Mermaid/);
  const huge = Buffer.from(png);
  huge.writeUInt32BE(5000, 16);
  await assert.rejects(() => toPrintHTML(markdown, null, async () => ({ data: huge, mime: 'image/png' })), /dimensions/);
});
