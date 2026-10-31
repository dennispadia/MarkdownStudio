import { LocalLinter, SuggestionKind, type Lint } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import MarkdownIt from 'markdown-it';

export const maxGrammarCharacters = 100_000;
export const maxGrammarIssues = 200;

export interface GrammarIssue {
  from: number;
  to: number;
  rule: string;
  message: string;
  kind: string;
  matchedText: string;
  suggestions: string[];
}

export interface GrammarRequest {
  id: number;
  text: string;
  language: 'markdown' | 'plaintext';
}

export interface GrammarResult {
  issues: GrammarIssue[];
  limited: boolean;
}

export type GrammarResponse =
  | ({ id: number; ok: true } & GrammarResult)
  | { id: number; ok: false; error: string };

const markdown = new MarkdownIt({ html: true });
let engine: Promise<LocalLinter> | undefined;

export function issueIgnoreKey(issue: Pick<GrammarIssue, 'rule' | 'matchedText'>): string {
  return JSON.stringify([issue.rule, issue.matchedText.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()]);
}

async function createEngine(): Promise<LocalLinter> {
  const url = binaryInlined.url;
  if (typeof url !== 'string' || !url.startsWith('data:application/wasm;base64,')) {
    throw new Error('The offline grammar binary is unavailable.');
  }
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), character => character.charCodeAt(0));
  const originalFetch = globalThis.fetch;
  let linter: LocalLinter | undefined;
  // Harper 2.13 fetches even its inlined data URL. Supply those bytes directly:
  // the dedicated worker must also work with connect-src 'none'.
  globalThis.fetch = async input => {
    const requested = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (requested !== url) throw new Error('The grammar engine cannot access the network.');
    return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  };
  try {
    linter = new LocalLinter({ binary: binaryInlined });
    await linter.setup();
    const config = await linter.getLintConfig();
    for (const rule of ['SpellCheck', 'Misspell']) {
      if (rule in config) config[rule] = false;
    }
    await linter.setLintConfig(config);
    return linter;
  } catch (error) {
    await linter?.dispose().catch(() => undefined);
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function getEngine(): Promise<LocalLinter> {
  engine ??= createEngine().catch(error => {
    engine = undefined;
    throw error;
  });
  return engine;
}

export async function disposeGrammarEngine(): Promise<void> {
  const current = engine;
  engine = undefined;
  if (current) await (await current).dispose();
}

interface GrammarSource {
  text: string;
  masked: Uint8Array;
}

function prepareSource(text: string, language: GrammarRequest['language']): GrammarSource {
  const masked = new Uint8Array(text.length);
  const characters = text.split('');
  const mask = (from: number, to: number) => {
    for (let index = from; index < to; index++) {
      masked[index] = 1;
      if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
    }
  };
  if (language === 'markdown') {
    const frontmatter = /^(?:\uFEFF)?(---|\+\+\+)[ \t]*\r?\n/.exec(text);
    if (frontmatter) {
      const end = new RegExp(`^(?:${frontmatter[1] === '---' ? '---|\\.\\.\\.' : '\\+\\+\\+'})[ \\t]*\\r?$`, 'gm');
      end.lastIndex = frontmatter[0].length;
      const closing = end.exec(text);
      mask(0, closing ? closing.index + closing[0].length : text.length);
    }
    const lines = [0];
    const html: [number, number][] = [];
    for (const match of text.matchAll(/\n/g)) lines.push(match.index + 1);
    for (const token of markdown.parse(characters.join(''), {})) {
      if (token.map) {
        const from = lines[token.map[0]];
        const to = lines[token.map[1]] ?? text.length;
        if (['fence', 'code_block'].includes(token.type)) mask(from, to);
        else if (token.type === 'html_block') html.push([from, to]);
      }
    }
    // Work on the already masked source so markers inside examples cannot hide prose.
    const source = characters.join('');
    for (const start of source.matchAll(/^[ \t]*<!-- lekh:toc -->[ \t]*\r?$/gm)) {
      if (html.some(([from, to]) => start.index > from && start.index < to)) continue;
      const end = source.indexOf('<!-- /lekh:toc -->', start.index + start[0].length);
      mask(start.index, end < 0 ? text.length : end + '<!-- /lekh:toc -->'.length);
    }
    for (const [from, to] of html) mask(from, to);
  }
  // Protect URLs without blanking them: blank destinations can change Markdown
  // parsing and accidentally expose otherwise hidden link titles to the linter.
  for (const link of markdown.linkify.match(text) ?? []) masked.fill(1, link.index, link.lastIndex);
  for (const match of text.matchAll(/\b(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:)[^\s<>"'`(){}[\]]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu)) {
    masked.fill(1, match.index, match.index + match[0].length);
  }
  return { text: characters.join(''), masked };
}

function readIssue(lint: Lint, rule: string, source: string, prepared: GrammarSource, language: GrammarRequest['language']): GrammarIssue | undefined {
  const span = lint.span();
  let from: number;
  let to: number;
  try {
    // In 2.13 span() is UTF-16 already; the *inner* span in to_json() is not.
    from = span.start;
    to = span.end;
  } finally {
    span.free();
  }
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to || to > source.length) return;
  if (prepared.masked.subarray(from, to).some(Boolean)) return;
  const matchedText = source.slice(from, to);
  if (matchedText !== lint.get_problem_text()) return;
  // Harper can return a phrase spanning emphasis, a link, or an HTML entity.
  // Replacing such a span would delete source formatting; keep word-local fixes.
  if (language === 'markdown' && /[*_`~[\]<>\\#|&\r\n]/u.test(matchedText)) return;
  const kind = lint.lint_kind();
  if (kind === 'Spelling') return;
  const suggestions = lint.suggestions();
  const replacements = new Set<string>();
  try {
    for (const suggestion of suggestions) {
      const kind = suggestion.kind();
      const replacement = suggestion.get_replacement_text();
      const value = kind === SuggestionKind.Replace ? replacement
        : kind === SuggestionKind.Remove ? ''
          : kind === SuggestionKind.InsertAfter ? matchedText + replacement : undefined;
      if (value !== undefined && value !== matchedText) replacements.add(value);
    }
  } finally {
    for (const suggestion of suggestions) suggestion.free();
  }
  return { from, to, rule, message: lint.message(), kind, matchedText, suggestions: [...replacements] };
}

export async function lintGrammar(text: string, language: GrammarRequest['language'] = 'markdown'): Promise<GrammarResult> {
  if (typeof text !== 'string') throw new Error('Grammar checking requires text.');
  if (language !== 'markdown' && language !== 'plaintext') throw new Error('Unsupported grammar input language.');
  if (text.length > maxGrammarCharacters) {
    throw new Error(`Grammar checking supports up to ${maxGrammarCharacters.toLocaleString('en-US')} characters. Shorten this document to check it.`);
  }
  if (!text.trim()) return { issues: [], limited: false };
  const prepared = prepareSource(text, language);
  const linter = await getEngine();
  const groups = await linter.organizedLints(prepared.text, { language });
  const issues: GrammarIssue[] = [];
  try {
    for (const [rule, lints] of Object.entries(groups)) {
      for (const lint of lints) {
        const issue = readIssue(lint, rule, text, prepared, language);
        if (issue) issues.push(issue);
      }
    }
  } finally {
    for (const lints of Object.values(groups)) {
      for (const lint of lints) lint.free();
    }
  }
  issues.sort((left, right) => left.from - right.from || left.to - right.to || left.rule.localeCompare(right.rule));
  return { issues: issues.slice(0, maxGrammarIssues), limited: issues.length > maxGrammarIssues };
}

export async function handleGrammarRequest(request: GrammarRequest): Promise<GrammarResponse> {
  const id = Number.isSafeInteger(request?.id) ? request.id : -1;
  try {
    if (id < 0) throw new Error('Invalid grammar request ID.');
    if (request.language !== 'markdown' && request.language !== 'plaintext') throw new Error('Unsupported grammar input language.');
    const result = await lintGrammar(request.text, request.language);
    return { id, ok: true, ...result };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : 'Offline grammar checking failed.' };
  }
}
