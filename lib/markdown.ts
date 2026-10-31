import MarkdownIt from 'markdown-it';

export const parser = new MarkdownIt({ html: false, linkify: true, breaks: false });
parser.block.ruler.before('paragraph', 'lekh_toc_marker', (state, startLine, _endLine, silent) => {
  const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
  if (!/^<!-- \/?lekh:toc -->$/.test(line)) return false;
  if (!silent) state.line = startLine + 1;
  return true;
}, { alt: ['paragraph', 'list', 'blockquote'] });

export function headings(markdown: string): { level: number; text: string; displayText: string; line: number }[] {
  const tokens = parser.parse(markdown, {});
  const inlineText = (children: typeof tokens): string => children.map(token => {
    if (token.children) return inlineText(token.children);
    if (token.type === 'text' || token.type === 'code_inline') return token.content;
    return token.type === 'softbreak' || token.type === 'hardbreak' ? ' ' : '';
  }).join('');
  return tokens.flatMap((token, index) => token.type === 'heading_open'
    ? [{
      level: Number(token.tag.slice(1)),
      text: tokens[index + 1].content,
      displayText: inlineText(tokens[index + 1].children ?? []).trim(),
      line: token.map?.[0] ?? 0,
    }]
    : []);
}

export function wordCount(markdown: string): number {
  return markdown.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function replaceAllLiteral(text: string, search: string, replacement: string): { text: string; count: number } {
  if (!search) throw new Error('Enter some text to find.');
  const parts = text.split(search);
  return { text: parts.join(replacement), count: parts.length - 1 };
}

export function isSafeLink(url: string): boolean {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); }
  catch { return false; }
}

export function imageDisplayURL(source: string, documentId = ''): string {
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source)) return source;
  return `lekh-image://local/image?source=${encodeURIComponent(source)}&document=${encodeURIComponent(documentId)}`;
}

export function documentPreviewHTML(markdown: string, documentId: string): string {
  const tokens = parser.parse(markdown, {});
  const scopeImages = (items: typeof tokens): void => {
    for (const token of items) {
      if (token.type === 'image') token.attrSet('src', imageDisplayURL(token.attrGet('src') ?? '', documentId));
      if (token.children) scopeImages(token.children);
    }
  };
  scopeImages(tokens);
  return parser.renderer.render(tokens, parser.options, {});
}

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function headingAnchor(text: string, used: Map<string, number>): string {
  const plain = parser.parseInline(text, {})[0]?.children?.filter(token => !['html_inline', 'image'].includes(token.type)).map(token => token.content).join('') ?? text;
  const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return `${base}${count ? `-${count}` : ''}`;
}
