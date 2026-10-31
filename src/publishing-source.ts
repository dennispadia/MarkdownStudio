import type { JSONContent, MarkdownToken } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';

const owners = new Set(['lekhAlert', 'lekhZone', 'lekhSteps', 'lekhTabs', 'lekhTab', 'lekhImageDescription', 'lekhDivision']);
const tokenChildren = ['tokens', 'items', 'header', 'rows', 'nestedTokens', 'panels'] as const;

export function withoutSource(node: JSONContent): JSONContent {
  const result = { ...node };
  if (node.type?.startsWith('lekh') && node.attrs) {
    const { sourceMarkdown: _source, sourceBaseline: _baseline, sourceHasReferences: _references, ...attrs } = node.attrs;
    result.attrs = attrs;
  }
  if (node.content) result.content = node.content.map(withoutSource);
  return result;
}

export function containsResolvedReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsResolvedReference);
  if (!value || typeof value !== 'object') return false;
  const token = value as MarkdownToken;
  if ((token.type === 'link' || token.type === 'image') &&
    typeof token.raw === 'string' && /^!?\[/.test(token.raw) && token.raw.endsWith(']')) return true;
  return tokenChildren.some(key => containsResolvedReference(token[key]));
}

export function referenceDefinitions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referenceDefinitions);
  if (!value || typeof value !== 'object') return [];
  const token = value as MarkdownToken;
  if (owners.has(token.type ?? '')) return [];
  if (token.type === 'def' && typeof token.raw === 'string') return [token.raw];
  return tokenChildren.flatMap(key => referenceDefinitions(token[key]));
}

export function inlineDestinations(node: JSONContent): JSONContent {
  if (owners.has(node.type ?? '') || node.type === 'lekhAlertSource') return node;
  const destination = (value: unknown) => `<${String(value ?? '').replace(/[\\<>]/g, '\\$&')}>`;
  const title = (value: unknown) => typeof value === 'string' ? value.replace(/[\\"]/g, '\\$&') : value;
  return {
    ...node,
    ...(node.type === 'image' ? {
      attrs: { ...node.attrs, src: destination(node.attrs?.src), title: title(node.attrs?.title),
        alt: String(node.attrs?.alt ?? '').replace(/[\\[\]]/g, '\\$&') },
    } : {}),
    ...(node.marks ? {
      marks: node.marks.map(mark => mark.type === 'link' ? {
        ...mark, attrs: { ...mark.attrs, href: destination(mark.attrs?.href), title: title(mark.attrs?.title) },
      } : mark),
    } : {}),
    ...(node.content ? { content: node.content.map(inlineDestinations) } : {}),
  };
}

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export function snapshot(node: JSONContent, schema: Schema | null): string {
  const content = withoutSource(node);
  return stableJSON(withoutSource(schema ? schema.nodeFromJSON(content).toJSON() : content));
}
