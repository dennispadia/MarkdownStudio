import { Node, type JSONContent, type MarkdownToken, type MarkdownTokenizer } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { publishingBlockAtStart } from '../lib/publishing.js';
import { publishingIcon } from '../lib/publishing-icons.js';

export const alertKinds = ['note', 'tip', 'important', 'caution', 'warning'] as const;
export type AlertKind = typeof alertKinds[number];

export interface AlertOptions {
  /** Use a per-editor closure, or the matching getSchema() result for a standalone MarkdownManager. */
  schema: (() => Schema) | null;
  placeholder: string;
}

const labels: Record<AlertKind, string> = {
  note: 'Note', tip: 'Tip', important: 'Important', caution: 'Caution', warning: 'Warning',
};
const headerPattern = /^ {0,3}>[ \t]?\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\](?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n|$)/i;
const bodyClass = 'publishing-callout-body';
export const MAX_ALERT_DEPTH = 12;

const AlertSourceNode = Node.create({
  name: 'lekhAlertSource',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    markdown: { default: '', rendered: false, parseHTML: element => element.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'pre[data-lekh-alert-source]' }],
  renderHTML: ({ node }) => ['pre', {
    'data-lekh-alert-source': '',
    class: 'publishing-alert-source',
    contenteditable: 'false',
    title: `Alerts nested beyond ${MAX_ALERT_DEPTH} levels are preserved as source.`,
  }, String(node.attrs.markdown)],
  parseMarkdown: (token, helpers) => helpers.createNode('lekhAlertSource', { markdown: token.raw ?? '' }),
  renderMarkdown: node => String(node.attrs?.markdown ?? '').replace(/\r?\n$/, ''),
});

export function isAlertKind(kind: unknown): kind is AlertKind {
  return typeof kind === 'string' && (alertKinds as readonly string[]).includes(kind);
}

function titleText(title: unknown): string | null {
  return typeof title === 'string' ? title.replace(/[\r\n]+/g, ' ').trim() || null : null;
}

function markdownHeader(kind: AlertKind, title: string | null): string {
  return `> [!${kind.toUpperCase()}]${title ? ` ${title}` : ''}`;
}

/** Also used by the read-only publishing tokenizer to leave these five types editable. */
export function editableAlertAtStart(source: string): { raw: string; kind: AlertKind; title: string | null; body: string } | null {
  const header = headerPattern.exec(source);
  if (!header) return null;
  const block = publishingBlockAtStart(source);
  if (!block || block.kind !== 'callout') return null;
  const body = block.raw.slice(header[0].length).replace(/\r?\n$/, '');
  return {
    raw: block.raw,
    kind: header[1].toLowerCase() as AlertKind,
    title: titleText(header[2]),
    body: body.split(/\r?\n/).map(line => line.replace(/^ {0,3}>[ \t]?/, '')).join('\n'),
  };
}

function alertTokenizer(): MarkdownTokenizer {
  // Marked block lexing is synchronous; this counter covers only the recursive
  // body-tokenization call and is reset even when a nested tokenizer throws.
  let depth = 0;
  return {
    name: 'lekhAlert',
    level: 'block',
    start: source => /^ {0,3}>[ \t]?\[!(?:NOTE|TIP|IMPORTANT|CAUTION|WARNING)\](?:[ \t]|$)/im.exec(source)?.index ?? -1,
    tokenize: (source, _tokens, lexer) => {
      const alert = editableAlertAtStart(source);
      if (!alert) return undefined;
      if (depth >= MAX_ALERT_DEPTH) return { type: 'lekhAlertSource', raw: alert.raw };
      depth++;
      try {
        return { type: 'lekhAlert', ...alert, tokens: lexer.blockTokens(alert.body) };
      } finally {
        depth--;
      }
    },
  };
}

function withoutSource(node: JSONContent): JSONContent {
  const result = { ...node };
  if (node.type === 'lekhAlert' && node.attrs) {
    const { sourceMarkdown: _source, sourceBaseline: _baseline, sourceHasReferences: _references, ...attrs } = node.attrs;
    result.attrs = attrs;
  }
  if (node.content) result.content = node.content.map(withoutSource);
  return result;
}

function containsResolvedReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsResolvedReference);
  if (!value || typeof value !== 'object') return false;
  const token = value as MarkdownToken;
  // Marked emits these link/image tokens only after resolving a definition.
  // Full, collapsed and shortcut references end in "]"; inline links end in ")".
  if ((token.type === 'link' || token.type === 'image') &&
    typeof token.raw === 'string' && /^!?\[/.test(token.raw) && token.raw.endsWith(']')) return true;
  return ['tokens', 'items', 'header', 'rows', 'nestedTokens'].some(key => containsResolvedReference(token[key]));
}

function referenceDefinitions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referenceDefinitions);
  if (!value || typeof value !== 'object') return [];
  const token = value as MarkdownToken;
  if (token.type === 'lekhAlert') return [];
  if (token.type === 'def' && typeof token.raw === 'string') return [token.raw];
  return ['tokens', 'items', 'header', 'rows', 'nestedTokens'].flatMap(key => referenceDefinitions(token[key]));
}

function inlineDestinations(node: JSONContent): JSONContent {
  if (node.type === 'lekhAlert' || node.type === 'lekhAlertSource') return node;
  const destination = (value: unknown) => `<${String(value ?? '').replace(/[\\<>]/g, '\\$&')}>`;
  const title = (value: unknown) => typeof value === 'string' ? value.replace(/[\\"]/g, '\\$&') : value;
  return {
    ...node,
    ...(node.type === 'image' ? {
      attrs: {
        ...node.attrs,
        src: destination(node.attrs?.src),
        title: title(node.attrs?.title),
        alt: String(node.attrs?.alt ?? '').replace(/[\\[\]]/g, '\\$&'),
      },
    } : {}),
    ...(node.marks ? {
      marks: node.marks.map(mark => mark.type === 'link' ? {
        ...mark,
        attrs: { ...mark.attrs, href: destination(mark.attrs?.href), title: title(mark.attrs?.title) },
      } : mark),
    } : {}),
    ...(node.content ? { content: node.content.map(inlineDestinations) } : {}),
  };
}

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
}

function snapshot(node: JSONContent, schema: Schema | null): string {
  const content = withoutSource(node);
  // PM adds node AND mark defaults (e.g. link target/rel, image dimensions).
  // Compare both sides through the same actual schema, never by dropping defaults.
  return stableJSON(withoutSource(schema ? schema.nodeFromJSON(content).toJSON() : content));
}

function bodyElement(element: HTMLElement): HTMLElement | undefined {
  return Array.from(element.children).find(child => child.classList.contains(bodyClass)) as HTMLElement | undefined;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lekhAlert: {
      setAlert: (kind: AlertKind) => ReturnType;
      unsetAlert: () => ReturnType;
    };
  }
}

export const AlertNode = Node.create<AlertOptions>({
  name: 'lekhAlert',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions: () => ({ schema: null, placeholder: 'Write your alert…' }),
  addExtensions: () => [AlertSourceNode],
  addAttributes: () => ({
    kind: {
      default: 'note',
      rendered: false,
      validate: (kind: unknown) => { if (!isAlertKind(kind)) throw new RangeError('Invalid alert kind'); },
      parseHTML: element => element.getAttribute('data-lekh-alert'),
    },
    title: {
      default: null,
      rendered: false,
      parseHTML: element => titleText(element.getAttribute('data-lekh-alert-title')),
    },
    sourceMarkdown: { default: null, rendered: false, parseHTML: () => null },
    sourceBaseline: { default: null, rendered: false, parseHTML: () => null },
    sourceHasReferences: { default: false, rendered: false, parseHTML: () => false },
    sourceDefinitions: { default: [], rendered: false, parseHTML: () => [] },
  }),
  parseHTML: () => [{
    tag: '[data-lekh-alert]',
    getAttrs: element => isAlertKind(element.getAttribute('data-lekh-alert')) && bodyElement(element) ? null : false,
    contentElement: element => bodyElement(element)!,
  }],
  renderHTML: ({ node }) => {
    const kind = isAlertKind(node.attrs.kind) ? node.attrs.kind : 'note';
    const title = titleText(node.attrs.title);
    return ['aside', {
      class: `publishing-callout publishing-callout-${kind}`,
      'data-lekh-alert': kind,
      ...(title ? { 'data-lekh-alert-title': title } : {}),
    },
    ['div', { class: 'publishing-callout-title', contenteditable: 'false' }, title ?? labels[kind]],
    ['div', { class: bodyClass }, 0]];
  },

  markdownTokenName: 'lekhAlert',
  markdownTokenizer: alertTokenizer(),
  parseMarkdown(token, helpers) {
    const sourceHasReferences = containsResolvedReference(token.tokens);
    const children = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? []);
    const content = children.length ? children : [helpers.createNode('paragraph', undefined, [])];
    const node = helpers.createNode(this.name, {
      kind: token.kind,
      title: titleText(token.title),
      sourceDefinitions: referenceDefinitions(token.tokens),
    }, content);
    node.attrs = {
      ...node.attrs,
      sourceMarkdown: token.raw ?? '',
      sourceBaseline: JSON.stringify(withoutSource(node)),
      sourceHasReferences,
    };
    return node;
  },
  renderMarkdown(node, helpers) {
    const schema = this.options.schema?.() ?? null;
    const raw = node.attrs?.sourceMarkdown;
    const baseline = node.attrs?.sourceBaseline;
    const kind = isAlertKind(node.attrs?.kind) ? node.attrs.kind : 'note';
    const title = titleText(node.attrs?.title);
    // Definitions are document-scoped and absent from PM's editable content.
    // A producer can be edited/deleted independently, so reference-bearing
    // alerts (including their ancestors) must emit the resolved model instead
    // of resurrecting context-dependent raw syntax.
    if (!node.attrs?.sourceHasReferences && typeof raw === 'string' && typeof baseline === 'string') {
      try {
        const original = JSON.parse(baseline) as JSONContent;
        const originalSnapshot = snapshot(original, schema);
        if (snapshot(node, schema) === originalSnapshot) {
          // The enclosing Markdown renderer owns the separator after this block.
          return raw.replace(/\r?\n$/, '');
        }
        const unchangedBody = { ...node, attrs: { ...node.attrs, kind: original.attrs?.kind, title: original.attrs?.title } };
        const header = headerPattern.exec(raw);
        if (header && snapshot(unchangedBody, schema) === originalSnapshot) {
          const newline = /\r?\n$/.exec(header[0])?.[0] ?? '';
          return `${markdownHeader(kind, title)}${newline}${raw.slice(header[0].length)}`.replace(/\r?\n$/, '');
        }
      } catch {
        // Invalid/stale provenance must never override the editable document.
      }
    }
    const renderedBody = (node.content ?? []).map((child, index) => {
      // The installed link/image serializers interpolate destinations and titles
      // verbatim; protect spaces, delimiters and quotes without mutating PM attrs.
      const rendered = node.attrs?.sourceHasReferences ? inlineDestinations(child) : child;
      return helpers.renderChild?.(rendered, index) ?? helpers.renderChildren([rendered]);
    }).join('\n\n');
    // Opaque publishing containers can still depend on these document-scoped
    // definitions. Keep actual lexer definitions when editing their producer;
    // nested alerts retain their own metadata, so do not duplicate it here.
    const definitions: string[] = Array.isArray(node.attrs?.sourceDefinitions)
      ? node.attrs.sourceDefinitions.filter((raw: unknown): raw is string => typeof raw === 'string')
      : [];
    // Marked emits the first definition per label. Keep these winners ahead
    // of nested raw duplicates, separated from the header's paragraph.
    const body = [...definitions.map(raw => raw.replace(/(?:\r?\n)+$/, '')), renderedBody].filter(Boolean).join('\n\n');
    return `${markdownHeader(kind, title)}${definitions.length ? '\n>' : ''}\n${body.split(/\r?\n/).map(line => line ? `> ${line}` : '>').join('\n')}`;
  },

  addCommands() {
    return {
      setAlert: kind => ({ state, tr, dispatch, commands }) => {
        if (!isAlertKind(kind)) return false;
        const { selection } = state;
        if (selection instanceof NodeSelection && selection.node.type === this.type) {
          if (dispatch) tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, kind });
          return true;
        }
        for (let depth = selection.$from.depth; depth > 0; depth--) {
          const node = selection.$from.node(depth);
          if (node.type === this.type && selection.to <= selection.$from.end(depth)) {
            if (dispatch) tr.setNodeMarkup(selection.$from.before(depth), undefined, { ...node.attrs, kind });
            return true;
          }
        }
        return commands.wrapIn(this.name, { kind });
      },
      unsetAlert: () => ({ commands }) => commands.lift(this.name),
    };
  },

  addNodeView() {
    const { placeholder } = this.options;
    return ({ node: initial }) => {
      const dom = document.createElement('aside');
      const header = document.createElement('div');
      header.className = 'publishing-callout-title';
      header.contentEditable = 'false';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      header.append(icon, label);
      const contentDOM = document.createElement('div');
      contentDOM.className = bodyClass;
      contentDOM.dataset.placeholder = placeholder;
      dom.append(header, contentDOM);
      const refresh = (node: typeof initial) => {
        const kind = isAlertKind(node.attrs.kind) ? node.attrs.kind : 'note';
        const title = titleText(node.attrs.title);
        const empty = node.childCount === 1 && node.firstChild?.type.name === 'paragraph' && !node.firstChild.content.size;
        dom.className = `publishing-callout publishing-callout-${kind}${empty ? ' is-empty' : ''}`;
        dom.dataset.lekhAlert = kind;
        if (title) dom.dataset.lekhAlertTitle = title;
        else delete dom.dataset.lekhAlertTitle;
        icon.innerHTML = publishingIcon(kind);
        label.textContent = title ?? labels[kind];
        contentDOM.dataset.empty = String(empty);
      };
      refresh(initial);
      return {
        dom,
        contentDOM,
        update: node => {
          if (node.type !== initial.type) return false;
          refresh(node);
          return true;
        },
        ignoreMutation: mutation => mutation.type !== 'selection' && (
          header.contains(mutation.target) ||
          mutation.type === 'attributes' && (
            mutation.target === dom ||
            mutation.target === contentDOM && ['data-empty', 'data-placeholder'].includes(mutation.attributeName ?? '')
          )
        ),
      };
    };
  },
});
