import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { toDocx, toPrintHTML, imageDimensions } from '../lib/export.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

export function unzipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'Valid ZIP end record');
  let offset = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const length = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + length);
    entries.set(name, method === 8 ? inflateRawSync(raw) : raw);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('DOCX contains headings, formatting, tables, links, lists, quotes, code, and images', async () => {
  const markdown = `# Export test

**Bold** and *italic* with ~~strike~~ and \`inline code\`.

[Example](https://example.com)

- First
  - Nested

3. Ordered
4. Next

> Quoted words

| Name | Value |
| --- | --- |
| A | B |

\`\`\`js
const answer = 42;
\`\`\`

![Pixel](pixel.png)
`;
  const zip = unzipEntries(await toDocx(markdown, async () => ({ data: png, mime: 'image/png' })));
  const xml = zip.get('word/document.xml')!.toString();
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:i\/>/);
  assert.match(xml, /<w:strike\/>/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:hyperlink/);
  assert.match(xml, /Quoted words/);
  assert.match(xml.replace(/<[^>]+>/g, ''), /const answer = 42;/);
  assert.match(xml, /<w:numPr>/);
  assert.match(xml, /w:ilvl w:val="1"/);
  assert.match(zip.get('word/numbering.xml')!.toString(), /w:start w:val="3"/);
  assert.match(zip.get('word/_rels/document.xml.rels')!.toString(), /https:\/\/example.com/);
  assert.ok([...zip.keys()].some(name => name.startsWith('word/media/') && name.endsWith('.png')));
  assert.match(xml, /cx="9525" cy="9525"/, 'Image aspect ratio and original dimensions preserved');
});

test('DOCX rejects missing or unsupported images rather than silently dropping them', async () => {
  await assert.rejects(() => toDocx('![Missing](missing.png)', async () => { throw new Error('Image not found'); }), /Image not found/);
  await assert.rejects(() => toDocx('![WebP](photo.webp)', async () => ({ data: png, mime: 'image/webp' })), /Word export supports/);
});

test('image size detection validates PNG and rejects malformed images', () => {
  assert.deepEqual(imageDimensions(png, 'png'), { width: 1, height: 1 });
  assert.throws(() => imageDimensions(Buffer.from('not an image'), 'png'), /invalid/);
});

test('PDF HTML preserves formatting and embeds images without executable HTML', async () => {
  const html = await toPrintHTML(`# PDF title\n\n**Bold**\n\n<script>alert(1)</script>\n\n![Pixel](data:image/png;base64,${png.toString('base64')})`, null);
  assert.match(html, /<h1 id="pdf-title">PDF title<\/h1>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /@page/);
});

test('PDF export refuses remote images instead of fetching them', async () => {
  await assert.rejects(() => toPrintHTML('![Remote](https://example.com/private.png)', null), /Only embedded/);
});

test('empty Markdown still creates a valid Word document', async () => {
  assert.ok(unzipEntries(await toDocx('', async () => { throw new Error('Unexpected image'); })).has('word/document.xml'));
});

test('PDF and Word export syntax colors without editor controls or altered code', async () => {
  const code = 'const answer = 42;\n\n  console.log("Hello & <world>");';
  const markdown = `\`\`\`javascript\n${code}\n\`\`\`\n`;
  const html = await toPrintHTML(markdown, null);
  assert.match(html, /class="hljs-keyword">const<\/span>/);
  assert.match(html, /#CF222E/);
  assert.match(html, /&amp;/);
  assert.doesNotMatch(html, /code-language|copy-code|Search languages/);
  const zip = unzipEntries(await toDocx(markdown, async () => { throw new Error('Unexpected image'); }));
  const xml = zip.get('word/document.xml')!.toString();
  assert.match(xml, /<w:color w:val="CF222E"/);
  assert.match(xml, /<w:color w:val="0550AE"/);
  const lines = [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map(([paragraph]) =>
    [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(([, text]) =>
      text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).join(''));
  assert.deepEqual(lines, ['const answer = 42;', ' ', '  console.log("Hello & <world>");']);
});
