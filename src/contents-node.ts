import { Node } from '@tiptap/core';
import { documentPreviewHTML } from '../lib/markdown.js';
import { TOC_START } from '../lib/contents.js';

export const ContentsNode = Node.create({
  name: 'lekhContents',
  group: 'block',
  atom: true,
  addAttributes: () => ({ markdown: { default: '', rendered: false, parseHTML: element => element.textContent ?? '' } }),
  parseHTML: () => [{ tag: 'div[data-lekh-contents]' }],
  renderHTML: ({ node }) => ['div', { 'data-lekh-contents': '' }, String(node.attrs.markdown)],
  markdownTokenName: 'lekhContents',
  markdownTokenizer: {
    name: 'lekhContents',
    level: 'block',
    start: source => source.indexOf(TOC_START),
    tokenize: source => {
      const match = /^<!-- lekh:toc -->\r?\n[\s\S]*?\r?\n<!-- \/lekh:toc -->(?:\r?\n)?/.exec(source);
      return match ? { type: 'lekhContents', raw: match[0] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('lekhContents', { markdown: token.raw?.trimEnd() ?? '' }),
  renderMarkdown: node => String(node.attrs?.markdown ?? ''),
  addNodeView: () => ({ node }) => {
    const dom = document.createElement('div');
    dom.className = 'contents-node';
    dom.setAttribute('data-lekh-contents', '');
    dom.innerHTML = documentPreviewHTML(String(node.attrs.markdown), '');
    return { dom };
  },
});
