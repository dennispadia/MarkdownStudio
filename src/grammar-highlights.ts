import { Extension, type Editor } from '@tiptap/core';
import { Mark, type Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { GrammarIssue } from '../lib/grammar.js';

const key = new PluginKey<DecorationSet>('writing-assistance');
type Highlight = { from: number; to: number; message: string; index: number };

export const GrammarHighlights = Extension.create({
  name: 'grammarHighlights',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          const highlights: Highlight[] | undefined = transaction.getMeta(key);
          if (highlights) return DecorationSet.create(transaction.doc, highlights.map(item =>
            Decoration.inline(item.from, item.to, {
              class: 'grammar-mark', title: item.message, 'data-grammar-issue': String(item.index),
            })));
          return transaction.docChanged ? DecorationSet.empty : previous;
        },
      },
      props: { decorations: state => key.getState(state) },
    })];
  },
});

export function setGrammarHighlights(editor: Editor, highlights: Highlight[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(key, highlights).setMeta('addToHistory', false));
}

export interface VisualGrammarSnapshot {
  text: string;
  positions: number[];
  boundaries: number[];
}

export function visualGrammarSnapshot(doc: Node): VisualGrammarSnapshot {
  let text = '';
  const positions: number[] = [];
  const boundaries: number[] = [];
  let previousMarks: readonly Mark[] | undefined;
  const separator = () => {
    if (text) { text += '\n\n'; positions.push(-1, -1); }
    previousMarks = undefined;
  };
  doc.descendants((node, position) => {
    if (node.type.name === 'codeBlock' || node.type.name === 'lekhContents') {
      separator();
      return false;
    }
    if (node.isTextblock) separator();
    if (node.isText) {
      if (previousMarks && !Mark.sameSet(previousMarks, node.marks)) boundaries.push(text.length);
      previousMarks = node.marks;
      const value = node.text!;
      const code = node.marks.some(mark => mark.type.name === 'code');
      text += code ? ' '.repeat(value.length) : value;
      for (let index = 0; index < value.length; index++) positions.push(code ? -1 : position + index);
    } else if (node.isLeaf && node.isInline) {
      text += '\n';
      positions.push(-1);
    }
    return true;
  });
  return { text, positions, boundaries };
}

export function visualGrammarRange(snapshot: VisualGrammarSnapshot, issue: GrammarIssue): { from: number; to: number } | null {
  if (issue.from < 0 || issue.to > snapshot.positions.length || issue.to <= issue.from) return null;
  if (snapshot.boundaries.some(offset => offset > issue.from && offset < issue.to)) return null;
  const positions = snapshot.positions.slice(issue.from, issue.to);
  if (positions.some((position, index) => position < 0 || (index > 0 && position !== positions[index - 1] + 1))) return null;
  return { from: positions[0], to: positions.at(-1)! + 1 };
}
