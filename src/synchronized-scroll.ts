import type { Editor } from '@tiptap/core';
import { parser } from '../lib/markdown.js';
import { scrollAnchors, scrollPosition, type ScrollAnchor } from '../lib/scroll.js';

function textKey(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
const measuredStyle = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

/** Document/model anchors account for wrapped source and unequal rich-block heights. */
export function synchronizeDocumentScroll(pane: HTMLElement, source: HTMLTextAreaElement, visual: HTMLElement, getEditor: () => Editor): void {
  const measure = document.createElement('pre');
  measure.className = 'source-scroll-measure';
  measure.setAttribute('aria-hidden', 'true');
  source.parentElement!.append(measure);
  let driver: 'source' | 'visual' | null = null;
  let frame = 0;
  let cachedKey = '';
  let cachedSource = '';
  let cachedDoc: Editor['state']['doc'] | null = null;
  let anchors: ScrollAnchor[] = [];
  const expected = new Map<HTMLElement, number>();
  const enabled = () => pane.isConnected && Boolean(pane.querySelector('.pane-content.side-by-side')) && !source.closest('[hidden]') && !visual.closest('[hidden]');
  const makeAnchors = () => {
    const editor = getEditor();
    const style = getComputedStyle(source);
    const sourceText = source.value;
    const alternatives = [...visual.querySelectorAll<HTMLElement>('[data-lekh-tabs]')].map(group => group.dataset.activeTab).join(',');
    const key = `${source.clientWidth}:${source.clientHeight}:${source.scrollHeight}:${visual.clientWidth}:${visual.clientHeight}:${visual.scrollHeight}:${pane.dataset.variantSelection}:${alternatives}:${measuredStyle.map(name => style[name]).join(':')}`;
    if (sourceText === cachedSource && key === cachedKey && editor.state.doc === cachedDoc) return anchors;
    cachedKey = key; cachedSource = sourceText; cachedDoc = editor.state.doc;
    for (const name of measuredStyle) measure.style[name] = style[name];
    measure.style.width = `${source.clientWidth}px`;
    measure.textContent = source.value + '\n';
    const text = measure.firstChild!;
    const sourceTop = measure.getBoundingClientRect().top;
    const range = document.createRange();
    const sourceY = (position: number) => {
      range.setStart(text, Math.min(position, source.value.length));
      range.setEnd(text, Math.min(position + 1, source.value.length));
      return range.getBoundingClientRect().top - sourceTop;
    };
    const lines = [0];
    for (let index = source.value.indexOf('\n'); index !== -1; index = source.value.indexOf('\n', index + 1)) lines.push(index + 1);
    const tokens = parser.parse(source.value, {});
    const locations = new Map<string, number[]>();
    const plain = (children: typeof tokens): string => children.map(token =>
      token.children ? plain(token.children) : ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(token.type) ? token.content || ' ' : '').join('');
    for (const [index, token] of tokens.entries()) {
      if (!token.map || !['heading_open', 'paragraph_open', 'fence', 'code_block'].includes(token.type)) continue;
      const kind = token.type === 'heading_open' ? `heading-${token.tag}` : token.type === 'paragraph_open' ? 'paragraph' : 'codeBlock';
      const value = token.type === 'heading_open' || token.type === 'paragraph_open' ? plain(tokens[index + 1].children ?? []) : token.content;
      const key = `${kind}:${textKey(value)}`;
      const entries = locations.get(key) ?? []; entries.push(lines[token.map[0]] ?? 0); locations.set(key, entries);
    }
    const points: ScrollAnchor[] = [];
    const visualTop = visual.getBoundingClientRect().top;
    editor.state.doc.descendants((node, position) => {
      if (!['paragraph', 'heading', 'codeBlock'].includes(node.type.name)) return;
      const kind = node.type.name === 'heading' ? `heading-h${node.attrs.level}` : node.type.name;
      const entries = locations.get(`${kind}:${textKey(node.textContent)}`);
      const offset = entries?.shift();
      if (offset === undefined) return;
      const element = editor.view.nodeDOM(position);
      if (!(element instanceof HTMLElement) || !element.getClientRects().length) return;
      points.push({ source: sourceY(offset), visual: element.getBoundingClientRect().top - visualTop + visual.scrollTop });
    });
    anchors = scrollAnchors(points, Math.max(0, source.scrollHeight - source.clientHeight), Math.max(0, visual.scrollHeight - visual.clientHeight));
    return anchors;
  };
  const schedule = (from: 'source' | 'visual') => {
    if (!enabled()) return;
    const element = from === 'source' ? source : visual;
    const anticipated = expected.get(element);
    if (anticipated !== undefined && Math.abs(element.scrollTop - anticipated) < 1.5) { expected.delete(element); return; }
    expected.delete(element);
    driver = from;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!driver || !enabled()) return;
      const from = driver; driver = null;
      const current = from === 'source' ? source : visual;
      const target = from === 'source' ? visual : source;
      const value = scrollPosition(current.scrollTop, makeAnchors(), from);
      const limited = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, value));
      if (Math.abs(target.scrollTop - limited) < .5) return;
      expected.set(target, limited);
      target.scrollTop = limited;
    });
  };
  source.addEventListener('scroll', () => schedule('source'), { passive: true });
  visual.addEventListener('scroll', () => schedule('visual'), { passive: true });
}
