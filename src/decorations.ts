import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, type Decoration } from '@tiptap/pm/view';

export function decorationLayer(name: string) {
  const key = new PluginKey<DecorationSet>(name);
  return {
    extension: Extension.create({
      name,
      addProseMirrorPlugins: () => [new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous) {
            const decorations: Decoration[] | undefined = transaction.getMeta(key);
            if (decorations) return DecorationSet.create(transaction.doc, decorations);
            return transaction.docChanged ? DecorationSet.empty : previous;
          },
        },
        props: { decorations: state => key.getState(state) },
      })],
    }),
    set(editor: Editor, decorations: Decoration[]): void {
      editor.view.dispatch(editor.state.tr.setMeta(key, decorations).setMeta('addToHistory', false));
    },
  };
}
