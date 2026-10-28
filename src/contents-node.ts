import { Node } from '@tiptap/core';
import { documentPreviewHTML } from '../lib/markdown.js';
import { TOC_START } from '../lib/contents.js';

export const ContentsNode = Node.create({
  name: 'studioContents',
  group: 'block',
  atom: true,
  addAttributes: () => ({ markdown: { default: '', rendered: false, parseHTML: element => element.textContent ?? '' } }),
  parseHTML: () => [{ tag: 'div[data-studio-contents]' }],
  renderHTML: ({ node }) => ['div', { 'data-studio-contents': '' }, String(node.attrs.markdown)],
  markdownTokenName: 'studioContents',
  markdownTokenizer: {
    name: 'studioContents',
    level: 'block',
    start: source => source.indexOf(TOC_START),
    tokenize: source => {
      const match = /^<!-- markdown-studio:toc -->\r?\n[\s\S]*?\r?\n<!-- \/markdown-studio:toc -->(?:\r?\n)?/.exec(source);
      return match ? { type: 'studioContents', raw: match[0] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('studioContents', { markdown: token.raw?.trimEnd() ?? '' }),
  renderMarkdown: node => String(node.attrs?.markdown ?? ''),
  addNodeView: () => ({ node }) => {
    const dom = document.createElement('div');
    dom.className = 'contents-node';
    dom.setAttribute('data-studio-contents', '');
    dom.innerHTML = documentPreviewHTML(String(node.attrs.markdown), '');
    return { dom };
  },
});
