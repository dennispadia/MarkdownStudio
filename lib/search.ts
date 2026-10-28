export interface SearchOptions { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export interface SearchMatch { from: number; to: number; replacement: string }
export interface SearchResult { matches: SearchMatch[]; truncated: boolean }
export const MAX_SEARCH_MATCHES = 10000;

function word(character: string): boolean { return /[\p{L}\p{N}_]/u.test(character); }

export function searchMarkdown(text: string, query: string, options: SearchOptions, replacement = ''): SearchResult {
  if (!query) return { matches: [], truncated: false };
  const pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let expression: RegExp;
  try { expression = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu'); }
  catch (error) { throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`); }
  const matches: SearchMatch[] = [];
  let replacementLength = text.length;
  for (const match of text.matchAll(expression)) {
    const from = match.index;
    const to = from + match[0].length;
    const before = Array.from(text.slice(Math.max(0, from - 2), from)).at(-1) ?? '';
    const after = String.fromCodePoint(text.codePointAt(to) ?? 0);
    if (options.wholeWord && (word(before) || word(after))) continue;
    if (matches.length === MAX_SEARCH_MATCHES) return { matches, truncated: true };
    const expanded = options.regex ? replacement.replace(/\$(\$|&|`|'|[0-9]{1,2}|<[^>]*>)/g, (original, group: string) => {
      if (group === '$') return '$';
      if (group === '&') return match[0];
      if (group === '`') return text.slice(0, from);
      if (group === "'") return text.slice(to);
      if (group.startsWith('<')) return match.groups ? match.groups[group.slice(1, -1)] ?? '' : original;
      const index = Number(group);
      if (index > 0 && index < match.length) return match[index] ?? '';
      const first = Number(group[0]);
      return group.length === 2 && first > 0 && first < match.length ? (match[first] ?? '') + group[1] : original;
    }) : replacement;
    if (expanded.length > 10 * 1024 * 1024) throw new Error('Replacement text exceeds the 10 MB document limit.');
    replacementLength += expanded.length - (to - from);
    if (replacementLength > 10 * 1024 * 1024) throw new Error('Replacement would exceed the 10 MB document limit.');
    matches.push({ from, to, replacement: expanded });
  }
  return { matches, truncated: false };
}

export function replaceSearchMatches(text: string, matches: readonly SearchMatch[]): string {
  const parts: string[] = [];
  let position = 0;
  let length = text.length;
  for (const match of matches) {
    if (match.from < position || match.to < match.from || match.to > text.length) throw new Error('Search results no longer match the document.');
    length += match.replacement.length - (match.to - match.from);
    if (length > 10 * 1024 * 1024) throw new Error('Replacement would exceed the 10 MB document limit.');
    parts.push(text.slice(position, match.from), match.replacement);
    position = match.to;
  }
  parts.push(text.slice(position));
  const result = parts.join('');
  if (new TextEncoder().encode(result).length > 10 * 1024 * 1024) throw new Error('Replacement would exceed the 10 MB document limit.');
  return result;
}
