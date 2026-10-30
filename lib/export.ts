import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun,
  LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
  type IRunOptions, type ParagraphChild,
} from 'docx';
import type Token from 'markdown-it/lib/token.mjs';
import { escapeHTML, headingAnchor, isSafeLink, parser } from './markdown.js';
import { readImage } from './images.js';
import { highlightedHTML, highlightedSegments, syntaxCSS, type CodeSegment } from './highlight.js';
import { diagramLimits, isMermaidLanguage, prepareMermaid } from './diagrams.js';
import { productName } from './branding.js';

export type ImageLoader = (source: string) => Promise<{ data: Buffer; mime: string }>;
/** The renderer supplies locally rendered PNGs keyed by the original fence source. */
export type DiagramImageLoader = (source: string) => Promise<{ data: Buffer; mime: 'image/png' }>;

async function diagramImage(source: string, loader?: DiagramImageLoader) {
  prepareMermaid(source);
  if (!loader) throw new Error('Mermaid export requires a rendered diagram image. Please render the diagram before exporting.');
  const image = await loader(source);
  if (image.mime !== 'image/png' || !Buffer.isBuffer(image.data) || image.data.length > diagramLimits.pngBytes) {
    throw new Error('Mermaid export requires a PNG image smaller than 8 MB.');
  }
  const dimensions = imageDimensions(image.data, 'png');
  if (dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 8_000_000) {
    throw new Error('Mermaid export image dimensions are too large.');
  }
  return { ...image, dimensions };
}
type Block = Paragraph | Table;
type List = { kind: 'bullet' | 'ordered'; level: number; reference: string };

export async function toDocx(markdown: string, loadImage: ImageLoader, loadDiagram?: DiagramImageLoader): Promise<Buffer> {
  const tokens = parser.parse(markdown, {});
  if (tokens.filter(token => token.type === 'fence' && isMermaidLanguage(token.info)).length > diagramLimits.diagrams) throw new Error('An export supports at most 32 Mermaid diagrams.');
  const blocks: Block[] = [];
  const lists: List[] = [];
  const numbering: { reference: string; levels: { level: number; format: typeof LevelFormat.DECIMAL; text: string; start: number; alignment: typeof AlignmentType.START; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] = [];
  let heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
  let quote = 0;
  let itemPending = false;
  let currentTable: TableRow[] | null = null;
  let currentRow: TableCell[] = [];
  let currentCell: Paragraph[] | null = null;
  let headerCell = false;

  async function inline(children: Token[], inherited: IRunOptions = {}): Promise<ParagraphChild[]> {
    const runs: ParagraphChild[] = [];
    let style: IRunOptions = { ...inherited };
    for (let index = 0; index < children.length; index++) {
      const token = children[index];
      switch (token.type) {
        case 'strong_open': style = { ...style, bold: true }; break;
        case 'strong_close': style = { ...style, bold: inherited.bold }; break;
        case 'em_open': style = { ...style, italics: true }; break;
        case 'em_close': style = { ...style, italics: inherited.italics }; break;
        case 's_open': style = { ...style, strike: true }; break;
        case 's_close': style = { ...style, strike: inherited.strike }; break;
        case 'text': runs.push(new TextRun({ ...style, text: token.content })); break;
        case 'code_inline': runs.push(new TextRun({ ...style, text: token.content, font: 'Consolas', shading: { fill: 'F1F3F5' } })); break;
        case 'softbreak': runs.push(new TextRun({ ...style, text: ' ' })); break;
        case 'hardbreak': runs.push(new TextRun({ break: 1 })); break;
        case 'link_open': {
          let end = index + 1;
          let depth = 1;
          for (; end < children.length; end++) {
            if (children[end].type === 'link_open') depth++;
            if (children[end].type === 'link_close' && --depth === 0) break;
          }
          const label = await inline(children.slice(index + 1, end), style);
          const href = token.attrGet('href') ?? '';
          if (isSafeLink(href)) runs.push(new ExternalHyperlink({ link: href, children: label }));
          else runs.push(...label);
          index = end;
          break;
        }
        case 'image': {
          const source = token.attrGet('src') ?? '';
          const { data, mime } = await loadImage(source);
          const type = mime === 'image/jpeg' ? 'jpg' : mime.slice(6);
          if (type !== 'png' && type !== 'jpg' && type !== 'gif') {
            throw new Error('Word export supports PNG, JPEG, and GIF images. Please replace WebP images before exporting to Word.');
          }
          const dimensions = imageDimensions(data, type);
          const scale = Math.min(1, 600 / dimensions.width, 760 / dimensions.height);
          runs.push(new ImageRun({
            data, type, transformation: { width: Math.round(dimensions.width * scale), height: Math.round(dimensions.height * scale) },
            altText: { title: token.content, description: token.content, name: token.content || 'Image' },
          }));
          break;
        }
      }
    }
    return runs;
  }

  for (const token of tokens) {
    if (token.type === 'heading_open') heading = ({
      h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
      h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
    })[token.tag];
    else if (token.type === 'heading_close') heading = undefined;
    else if (token.type === 'blockquote_open') quote++;
    else if (token.type === 'blockquote_close') quote--;
    else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const level = Math.min(lists.length, 8);
      const reference = `list-${numbering.length}`;
      const kind = token.type === 'bullet_list_open' ? 'bullet' : 'ordered';
      if (kind === 'ordered') numbering.push({
        reference, levels: Array.from({ length: 9 }, (_, index) => ({
          level: index, format: LevelFormat.DECIMAL, text: `%${index + 1}.`,
          start: Number(token.attrGet('start') || 1), alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (index + 1), hanging: 360 } } },
        })),
      });
      lists.push({ kind, level, reference });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      lists.pop();
    } else if (token.type === 'list_item_open') itemPending = true;
    else if (token.type === 'list_item_close') itemPending = false;
    else if (token.type === 'table_open') currentTable = [];
    else if (token.type === 'tr_open') currentRow = [];
    else if (token.type === 'th_open' || token.type === 'td_open') {
      currentCell = [];
      headerCell = token.type === 'th_open';
    } else if (token.type === 'th_close' || token.type === 'td_close') {
      currentRow.push(new TableCell({
        children: currentCell?.length ? currentCell : [new Paragraph('')],
        shading: headerCell ? { fill: 'EEF2F6' } : undefined,
      }));
      currentCell = null;
    } else if (token.type === 'tr_close') currentTable?.push(new TableRow({ children: currentRow }));
    else if (token.type === 'table_close') {
      if (currentTable?.length) blocks.push(new Table({ rows: currentTable, width: { size: 100, type: WidthType.PERCENTAGE } }));
      currentTable = null;
    } else if (token.type === 'inline') {
      const list = lists.at(-1);
      const paragraph = new Paragraph({
        children: await inline(token.children ?? [], { bold: headerCell && currentCell !== null }),
        heading,
        spacing: { after: 160, line: 280 },
        bullet: itemPending && list?.kind === 'bullet' ? { level: list.level } : undefined,
        numbering: itemPending && list?.kind === 'ordered' ? { reference: list.reference, level: list.level } : undefined,
        indent: quote ? { left: 360 * quote } : undefined,
        border: quote ? { left: { color: '8497AB', style: BorderStyle.SINGLE, size: 16, space: 12 } } : undefined,
      });
      (currentCell ?? blocks).push(paragraph);
      itemPending = false;
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const list = lists.at(-1);
      if (token.type === 'fence' && isMermaidLanguage(token.info)) {
        const { data, dimensions } = await diagramImage(token.content, loadDiagram);
        const scale = Math.min(1, 600 / dimensions.width, 760 / dimensions.height);
        blocks.push(new Paragraph({
          children: [new ImageRun({
            data, type: 'png',
            transformation: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) },
            altText: { title: 'Mermaid diagram', description: 'Mermaid diagram', name: 'Mermaid diagram' },
          })],
          indent: list ? { left: 720 * (list.level + 1) } : undefined,
          spacing: { after: 160 },
        }));
        continue;
      }
      const lines: CodeSegment[][] = [[]];
      for (const segment of highlightedSegments(token.content.replace(/\n$/, ''), token.info.trim().split(/\s+/)[0])) {
        for (const [index, part] of segment.text.split('\n').entries()) {
          if (index) lines.push([]);
          if (part) lines.at(-1)!.push({ text: part, color: segment.color });
        }
      }
      for (const line of lines) {
        blocks.push(new Paragraph({
          children: (line.length ? line : [{ text: ' ' }]).map(segment => new TextRun({
            text: segment.text, color: segment.color, font: 'Consolas', size: 19,
          })),
          shading: { fill: 'F1F3F5' }, spacing: { after: 0 },
          indent: list ? { left: 720 * (list.level + 1) } : undefined,
        }));
      }
    } else if (token.type === 'hr') {
      blocks.push(new Paragraph({ border: { bottom: { color: 'CBD5E1', size: 6, style: BorderStyle.SINGLE } } }));
    }
  }
  return Packer.toBuffer(new Document({
    creator: productName, title: 'Markdown document',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: blocks.length ? blocks : [new Paragraph('')] }],
  }));
}

export function imageDimensions(data: Buffer, type: string): { width: number; height: number } {
  if (type === 'png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return checked(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (type === 'gif' && data.length >= 10 && data.toString('ascii', 0, 3) === 'GIF') {
    return checked(data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (type === 'jpg' && data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 8 < data.length) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return checked(data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5));
      }
      const length = data.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  throw new Error('An image is invalid or its dimensions could not be read. Please use a standard PNG, JPEG, or GIF image.');
}

function checked(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || width > 100000 || height > 100000) throw new Error('Invalid image dimensions.');
  return { width, height };
}

export const printCSS = `
  @page { size: A4; margin: 20mm; }
  body { font: 11pt/1.6 "Segoe UI", Arial, sans-serif; color: #17212f; overflow-wrap: anywhere; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.25; break-after: avoid; margin: 1.3em 0 .5em; }
  h1 { font-size: 26pt; } h2 { font-size: 19pt; border-bottom: 1px solid #dbe2ea; padding-bottom: .3em; }
  a { color: #245c9e; } img { max-width: 100%; max-height: 240mm; object-fit: contain; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th,td { border: 1px solid #bbc6d4; padding: 7px 10px; text-align: left; }
  th { background: #edf2f7; } thead { display: table-header-group; } tr, img { break-inside: avoid; }
  blockquote { border-left: 3px solid #91a5bd; margin-left: 0; padding-left: 16px; color: #526579; }
  pre { background: #f1f4f8; padding: 12px; white-space: pre-wrap; }
  code { font: 9.5pt/1.5 Consolas, monospace; background: #f1f4f8; }
  hr { border: 0; border-top: 1px solid #cbd5e1; }
  ${syntaxCSS('pre')}
`;

export async function toPrintHTML(markdown: string, documentPath: string | null, loadDiagram?: DiagramImageLoader): Promise<string> {
  const tokens = parser.parse(markdown, {});
  if (tokens.filter(token => token.type === 'fence' && isMermaidLanguage(token.info)).length > diagramLimits.diagrams) throw new Error('An export supports at most 32 Mermaid diagrams.');
  const anchors = new Map<string, number>();
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'fence' && isMermaidLanguage(token.info)) {
      const { data } = await diagramImage(token.content, loadDiagram);
      token.type = 'html_block';
      token.content = `<figure class="mermaid-diagram"><img alt="Mermaid diagram" src="data:image/png;base64,${data.toString('base64')}"></figure>\n`;
    }
    if (token.type === 'heading_open') token.attrSet('id', headingAnchor(tokens[index + 1].content, anchors));
    for (const child of token.children ?? []) {
      if (child.type === 'image') {
        const { data, mime } = await readImage(child.attrGet('src') ?? '', documentPath);
        child.attrSet('src', `data:${mime};base64,${data.toString('base64')}`);
      }
    }
  }
  const html = parser.renderer.render(tokens, { ...parser.options, highlight: highlightedHTML }, {});
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeHTML(`${productName} export`)}</title><style>${printCSS}</style></head><body>${html}</body></html>`;
}
