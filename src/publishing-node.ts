import { Node, type Editor } from '@tiptap/core';
import { Decoration } from '@tiptap/pm/view';
import { firstPublishingBlock, publishingBlockAtStart } from '../lib/publishing.js';
import { initializePublishing, publishingHTML } from './publishing-view.js';
import { renderMermaidBlocks } from './diagrams.js';
import { decorationLayer } from './decorations.js';

const headings = decorationLayer('publishing-headings');
export const PublishingHeadings = headings.extension;
export function setPublishingHeadings(editor: Editor, anchors: { from: number; to: number; id: string }[]): void {
  headings.set(editor, anchors.map(anchor => Decoration.node(anchor.from, anchor.to, { id: anchor.id })));
}

interface Options {
  documentId: string;
  editSource: (markdown: string, position: number) => void;
  reportError: (message: string) => void;
}

export const PublishingNode = Node.create<Options>({
  name: 'lekhPublishing',
  group: 'block',
  atom: true,
  addOptions: () => ({ documentId: '', editSource: () => {}, reportError: () => {} }),
  addAttributes: () => ({
    markdown: { default: '', rendered: false, parseHTML: element => element.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'div[data-lekh-publishing]' }],
  renderHTML: ({ node }) => ['div', { 'data-lekh-publishing': '' }, String(node.attrs.markdown)],
  markdownTokenName: 'lekhPublishing',
  markdownTokenizer: {
    name: 'lekhPublishing',
    level: 'block',
    start: firstPublishingBlock,
    tokenize: source => {
      const block = publishingBlockAtStart(source);
      return block ? { type: 'lekhPublishing', raw: block.raw } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('lekhPublishing', { markdown: token.raw ?? '' }),
  renderMarkdown: node => String(node.attrs?.markdown ?? ''),
  addNodeView() {
    const options = this.options;
    return ({ node, getPos }) => {
      const raw = String(node.attrs.markdown);
      const dom = document.createElement('section');
      dom.className = 'publishing-block';
      dom.contentEditable = 'false';
      dom.dataset.publishingKind = publishingBlockAtStart(raw)?.kind ?? 'unknown';
      if (/^\s*:::\s*zone\b/.test(raw)) dom.dataset.publishingZoneBlock = 'true';
      const controls = document.createElement('div');
      controls.className = 'publishing-block-tools';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit source';
      edit.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const position = getPos();
        if (typeof position === 'number') options.editSource(raw, position);
      });
      controls.append(edit);
      const content = document.createElement('div');
      content.className = 'publishing-block-content';
      dom.append(controls, content);
      let revision = 0;
      let destroyed = false;
      const refresh = async () => {
        const current = ++revision;
        try {
          const html = await publishingHTML(raw, options.documentId);
          if (destroyed || current !== revision) return;
          content.innerHTML = html;
          initializePublishing(content, options.reportError);
          window.dispatchEvent(new CustomEvent('lekh-publishing-rendered', { detail: options.documentId }));
          await renderMermaidBlocks(content);
        } catch (error) {
          if (destroyed || current !== revision) return;
          const message = `This block could not be rendered: ${String(error)}`;
          content.replaceChildren();
          const warning = document.createElement('p');
          warning.className = 'publishing-error';
          warning.textContent = message;
          const source = document.createElement('pre');
          source.textContent = raw;
          content.append(warning, source);
          options.reportError(message);
        }
      };
      const updated = (event: Event) => {
        if (event instanceof CustomEvent && event.detail === options.documentId) void refresh();
      };
      window.addEventListener('lekh-publishing-refresh', updated);
      void refresh();
      return {
        dom,
        stopEvent: event => event.target instanceof Element && Boolean(event.target.closest('button, summary, a')),
        ignoreMutation: () => true,
        destroy: () => { destroyed = true; revision++; window.removeEventListener('lekh-publishing-refresh', updated); },
      };
    };
  },
});
