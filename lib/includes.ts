import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { imageMime } from './images.js';
import { decodeMarkdown } from './files.js';

const MAX_DEPTH = 8;
const MAX_FILES = 32;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
type Range = { start: number; end: number };
type Replacement = Range & { value: string };
type Image = Range & { source: string; referenceTitle?: string };
type Line = Range & { text: string };

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  const endings = /\r\n|\r|\n/g;
  let start = 0;
  for (let match; (match = endings.exec(source));) {
    lines.push({ start, end: match.index, text: source.slice(start, match.index) });
    start = endings.lastIndex;
  }
  lines.push({ start, end: source.length, text: source.slice(start) });
  return lines;
}

function overlaps(range: Range, ignored: Range[]): boolean {
  return ignored.some(item => item.start < range.end && item.end > range.start);
}

function apply(source: string, changes: Replacement[]): string {
  changes.sort((a, b) => a.start - b.start);
  const pieces: string[] = [];
  let end = 0;
  for (const change of changes) {
    if (change.start < end) throw new Error('Overlapping publishing directives are unsupported.');
    pieces.push(source.slice(end, change.start), change.value);
    end = change.end;
  }
  pieces.push(source.slice(end));
  return pieces.join('');
}

function customImage(line: Line, parser: MarkdownIt): Image | undefined {
  const opening = /^ {0,3}:::image\b/i.exec(line.text);
  if (!opening) return;
  let pos = opening[0].length;
  let image: Image | undefined;
  while (pos < line.text.length) {
    const spacing = /^\s*/.exec(line.text.slice(pos))![0].length;
    pos += spacing;
    if (pos === line.text.length || line.text.slice(pos).trim() === ':::') break;
    const attribute = /^([\w-]+)\s*=\s*/.exec(line.text.slice(pos));
    if (!attribute) break;
    pos += attribute[0].length;
    const quote = line.text[pos] === '"' || line.text[pos] === "'" ? line.text[pos++] : '';
    const start = pos;
    if (quote) {
      while (pos < line.text.length && line.text[pos] !== quote) {
        pos += line.text[pos] === '\\' ? 2 : 1;
      }
      if (pos >= line.text.length) throw new Error('Malformed :::image attribute in included Markdown.');
    } else {
      while (pos < line.text.length && !/\s/.test(line.text[pos])) pos++;
    }
    if (attribute[1].toLowerCase() === 'source') {
      if (image) throw new Error('Duplicate :::image source in included Markdown.');
      image = {
        start: line.start + start, end: line.start + pos,
        source: parser.utils.unescapeAll(line.text.slice(start, pos).replace(/\\(["'\\])/g, '$1')),
      };
    }
    if (quote) pos++;
  }
  return image;
}

function analyze(source: string): { includes: (Range & { source: string })[]; images: Image[]; hasSelector: boolean } {
  // Use an isolated, non-rendering parser: shared publishing rules must not resolve includes here.
  const parser = new MarkdownIt({ html: true });
  parser.core.ruler.disable('inline');
  parser.validateLink = () => true;
  const rule = (name: string) => {
    const original = parser.inline.ruler.getRules('').find(item => item.name === name);
    if (!original) throw new Error(`The Markdown source lexer is missing its ${name} rule.`);
    return original;
  };
  const backticksRule = rule('backtick');
  const htmlRule = rule('html_inline');
  const imageRule = rule('image');
  const env: { references?: Record<string, { href: string; title: string }> } = {};
  const blocks = parser.parse(source, env);
  const lines = linesOf(source);
  const ignored: Range[] = [];
  const images: Image[] = [];
  const lineRange = (map: [number, number]): Range => ({
    start: lines[map[0]].start,
    end: lines[map[1]]?.start ?? source.length,
  });
  let base = 0;
  let fragment = '';
  parser.inline.ruler.at('backticks', (state, silent) => {
    const start = state.pos;
    const matched = backticksRule(state, silent);
    if (matched && !silent && state.src === fragment && state.tokens.at(-1)?.type === 'code_inline') {
      ignored.push({ start: base + start, end: base + state.pos });
    }
    return matched;
  });
  parser.inline.ruler.at('html_inline', (state, silent) => {
    const start = state.pos;
    const matched = htmlRule(state, silent);
    if (matched && !silent && state.src === fragment) {
      ignored.push({ start: base + start, end: base + state.pos });
    }
    return matched;
  });
  parser.inline.ruler.at('image', (state, silent) => {
    const start = state.pos;
    const matched = imageRule(state, silent);
    if (!matched || silent || state.src !== fragment) return matched;
    const token = state.tokens.at(-1);
    if (token?.type !== 'image') return matched;
    const labelEnd = parser.helpers.parseLinkLabel(state, start + 1, false);
    let destStart = labelEnd + 2;
    if (state.src[labelEnd + 1] === '(') {
      while (/\s/.test(state.src[destStart] ?? '') && destStart < state.pos) destStart++;
      const destination = parser.helpers.parseLinkDestination(state.src, destStart, state.pos);
      if (destination.ok) {
        const angle = state.src[destStart] === '<';
        images.push({
          start: base + destStart + (angle ? 1 : 0), end: base + destination.pos - (angle ? 1 : 0),
          source: destination.str.replace(/\\ /g, ' '),
        });
      } else if (!token.attrGet('src')) {
        images.push({ start: base + destStart, end: base + destStart, source: '' });
      }
    } else {
      // Rewrite the image use, not its definition: definitions may also be used by ordinary links.
      images.push({
        start: base + labelEnd + 1, end: base + state.pos,
        source: token.attrGet('src') ?? '', referenceTitle: token.attrGet('title') ?? '',
      });
    }
    return matched;
  });
  for (const token of blocks) {
    if (!token.map) continue;
    const range = lineRange(token.map);
    if (['fence', 'code_block', 'html_block'].includes(token.type)) ignored.push(range);
    if (token.type === 'inline') {
      base = range.start;
      fragment = source.slice(range.start, range.end);
      parser.inline.parse(fragment, parser, env, []);
    }
  }
  // Comments can cross paragraph boundaries, unlike Markdown's inline token spans.
  for (let start = source.indexOf('<!--'); start !== -1;) {
    let escapes = 0;
    for (let pos = start - 1; pos >= 0 && source[pos] === '\\'; pos--) escapes++;
    if (escapes % 2 || overlaps({ start, end: start + 4 }, ignored)) {
      start = source.indexOf('<!--', start + 4);
      continue;
    }
    const close = source.indexOf('-->', start + 4);
    const end = close === -1 ? source.length : close + 3;
    ignored.push({ start, end });
    start = source.indexOf('<!--', end);
  }
  const includes: (Range & { source: string })[] = [];
  let hasSelector = false;
  for (const line of lines) {
    if (overlaps(line, ignored)) continue;
    if (/^ {0,3}:::selector(?:\s|$)/i.test(line.text)) hasSelector = true;
    const include = /^ {0,3}\[!INCLUDE[ \t]+\[(?:\\.|[^\]\\])*\]\((.*)\)\][ \t]*$/i.exec(line.text);
    if (include) {
      const target = include[1].trim();
      includes.push({
        start: line.start, end: line.end,
        source: parser.utils.unescapeAll(target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target).replace(/\\ /g, ' '),
      });
      continue;
    }
    const image = customImage(line, parser);
    if (image) images.push(image);
  }
  return { includes, images: images.filter(image => !overlaps(image, ignored)), hasSelector };
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function key(file: string): string {
  return process.platform === 'win32' ? file.toLowerCase() : file;
}

function pathURL(file: string): string {
  return file.split(path.sep).map(part => encodeURIComponent(part)
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function localPath(source: string, kind: string): string {
  if (!source || /[\u0000-\u001f\u007f]/.test(source) || /%(?:00|2e|2f|5c|25)/i.test(source)) {
    throw new Error(`Unsafe ${kind} path: empty, control characters, or encoded traversal is not allowed.`);
  }
  let decoded: string;
  try { decoded = decodeURIComponent(source); }
  catch { throw new Error(`Invalid percent encoding in ${kind} path.`); }
  if (/[\u0000-\u001f\u007f]/.test(decoded) || /[:?#]/.test(decoded) ||
      /^[\\/]/.test(decoded) || path.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) {
    throw new Error(`Only relative local ${kind} paths are supported; URLs, protocols, absolute, drive and UNC paths are forbidden.`);
  }
  // Backslashes are local separators on Windows, never an escape from the root boundary on Unix.
  return decoded.replace(/[\\/]/g, path.sep);
}

async function authorizedDocument(documentPath: string | null, authorizedRoot: string): Promise<{ root: string; document: string; originalPath: string }> {
  if (!documentPath) throw new Error('Save the Markdown document before expanding local includes.');
  if (!path.isAbsolute(authorizedRoot) || !path.isAbsolute(documentPath)) throw new Error('The saved document and authorized root must have absolute local paths.');
  const root = await canonical(authorizedRoot, 'authorized include root');
  if (!(await stat(root)).isDirectory()) throw new Error('The authorized include root must be a directory.');
  const document = await canonical(documentPath, 'saved Markdown document');
  if (!inside(root, document)) throw new Error('The saved Markdown document resolves outside the authorized root (possible symlink escape).');
  if (!(await stat(document)).isFile()) throw new Error('The saved Markdown document must be a regular file.');
  return { root, document, originalPath: documentPath };
}

async function resolvePublishingFile(root: string, source: string, from: string, kind: 'include' | 'image'): Promise<string> {
  const candidate = path.resolve(path.dirname(from), localPath(source, kind));
  if (!inside(root, candidate)) throw new Error(`The ${kind} path traverses outside the authorized root: ${source}`);
  if (kind === 'include' && !/\.(?:md|markdown)$/i.test(candidate)) throw new Error('Local includes must reference Markdown (.md or .markdown) files.');
  const file = await canonical(candidate, kind);
  if (!inside(root, file)) throw new Error(`The ${kind} resolves outside the authorized root (symlink or junction escape): ${source}`);
  if (!(await stat(file)).isFile()) throw new Error(`The ${kind} must reference a regular file: ${source}`);
  if (kind === 'include' && !/\.(?:md|markdown)$/i.test(file)) throw new Error('An include symlink must resolve to a Markdown file.');
  if (kind === 'image') { imageMime(candidate); imageMime(file); }
  return file;
}

async function readPublishingFile(root: string, file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('An include must be a regular Markdown file.');
    const confirmed = await canonical(file, 'include');
    const current = await stat(confirmed);
    if (!inside(root, confirmed) || current.dev !== info.dev || current.ino !== info.ino) throw new Error('The include changed or escaped its authorized root before reading.');
    if (info.size > limit) throw new Error('Publishing content exceeds the 10 MB limit.');
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit - bytes + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > limit) throw new Error('Publishing content exceeds the 10 MB limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

export async function readAuthorizedInclude(source: string, documentPath: string | null, authorizedRoot: string | null): Promise<{ path: string; content: string }> {
  if (!authorizedRoot) throw new Error('Allow the document’s project folder before opening a shared file.');
  const { root, document } = await authorizedDocument(documentPath, authorizedRoot);
  const file = await resolvePublishingFile(root, source, document, 'include');
  return { path: file, content: decodeMarkdown(await readPublishingFile(root, file, MAX_BYTES)) };
}

async function canonical(file: string, kind: string): Promise<string> {
  try { return await realpath(file); }
  catch { throw new Error(`Missing or inaccessible ${kind}: ${file}`); }
}

function yamlScalar(raw: string): string | undefined {
  const text = raw.trim();
  let result: string;
  if (text.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(text);
    if (!quoted) return;
    try { result = JSON.parse(quoted[1]) as string; }
    catch { return; }
  } else if (text.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(text);
    if (!quoted) return;
    result = quoted[1].replace(/''/g, "'");
  } else {
    if (/^[!&*|>{[}\]]/.test(text)) return;
    result = text.replace(/\s+#.*$/, '').trim();
  }
  return result.length > 0 && result.length <= 512 && !/[\u0000-\u001f\u007f]/.test(result) ? result : undefined;
}

type Variant = { id: string; title: string };
type VariantGroup = { title: string; pivots: Variant[] };
const variantID = /^[a-z\d][a-z\d_-]*$/i;

function variantGroup(config: string, id: string): VariantGroup | undefined {
  // Deliberately not a YAML evaluator: aliases, tags, flow collections and multiline scalars
  // in the selected group fall back to the caller's visible ID-based labels.
  const lines = config.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const groups = lines.findIndex(line => /^groups:\s*(?:#.*)?$/.test(line));
  if (groups < 0) return;
  let groupIndent: number | undefined;
  for (let index = groups + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const header = /^( {0,2})- +id:\s*(.*)$/.exec(line);
    if (!header) {
      if (/^\S/.test(line)) return;
      continue;
    }
    if (groupIndent === undefined) groupIndent = header[1].length;
    if (header[1].length !== groupIndent) continue;
    if (yamlScalar(header[2]) !== id) continue;
    const indent = header[1].length;
    let title: string | undefined;
    let prompt: string | undefined;
    let inPivots = false;
    let pivotIndent: number | undefined;
    const pivots: Variant[] = [];
    for (index++; index < lines.length; index++) {
      const current = lines[index];
      if (!current.trim() || /^\s*#/.test(current)) continue;
      if (/^\s*\t/.test(current)) return;
      const leading = /^ */.exec(current)![0].length;
      if (leading <= indent) break;
      const field = /^( *)(title|prompt|pivots):\s*(.*)$/.exec(current);
      if (field && field[1].length === indent + 2 && pivotIndent === undefined) {
        if (field[2] === 'pivots') {
          if (inPivots || !/^(?:#.*)?$/.test(field[3])) return;
          inPivots = true;
        } else {
          const value = yamlScalar(field[3]);
          if (value === undefined) return;
          if (field[2] === 'title') { if (title !== undefined) return; title = value; }
          else { if (prompt !== undefined) return; prompt = value; }
        }
        continue;
      }
      const pivot = /^( *)- +id:\s*(.*)$/.exec(current);
      if (inPivots && pivot && (pivot[1].length === indent + 2 || pivot[1].length === indent + 4)) {
        if (pivotIndent !== undefined && pivotIndent !== pivot[1].length) return;
        pivotIndent = pivot[1].length;
        const pivotID = yamlScalar(pivot[2]);
        if (!pivotID || !variantID.test(pivotID) || pivots.some(item => item.id === pivotID) ||
            pivots.some(item => !item.title) || pivots.length >= 32) return;
        pivots.push({ id: pivotID, title: '' });
        continue;
      }
      const pivotTitle = /^( *)title:\s*(.*)$/.exec(current);
      if (pivotTitle && pivotIndent !== undefined && pivotTitle[1].length === pivotIndent + 2 && pivots.length) {
        const value = yamlScalar(pivotTitle[2]);
        if (value === undefined || pivots.at(-1)!.title) return;
        pivots.at(-1)!.title = value;
        continue;
      }
      return;
    }
    if (pivots.length > 0 && pivots.every(item => item.title)) return { title: prompt ?? title ?? 'Content variants', pivots };
    return;
  }
}

function variantMetadata(markdown: string): { id: string; end: number } | undefined {
  const lines = linesOf(markdown);
  if (lines[0].text.replace(/^\uFEFF/, '') !== '---') return;
  let id: string | undefined;
  for (let index = 1; index < lines.length && lines[index].end < 64 * 1024; index++) {
    if (lines[index].text === '---') {
      return id ? { id, end: lines[index + 1]?.start ?? markdown.length } : undefined;
    }
    const field = /^zone_pivot_groups:\s*(.*)$/.exec(lines[index].text);
    if (field) {
      if (id !== undefined) return;
      id = yamlScalar(field[1]);
      if (!id || !variantID.test(id)) return;
    }
  }
}

async function injectVariantSelector(markdown: string, document: string, root: string): Promise<string> {
  const metadata = variantMetadata(markdown);
  if (!metadata || analyze(markdown).hasSelector) return markdown;
  let directory = path.dirname(document);
  let remaining = MAX_CONFIG_BYTES;
  for (let depth = 0; depth < 64 && inside(root, directory); depth++) {
    const candidate = path.join(directory, 'zone-pivot-groups.yml');
    let file: string | undefined;
    try { file = await realpath(candidate); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new Error('The local variant configuration is inaccessible.');
      }
    }
    if (file) {
      if (!inside(root, file)) throw new Error('The variant configuration resolves outside the authorized root (symlink or junction escape).');
      if (!/\.ya?ml$/i.test(file)) return markdown;
      const handle = await open(file, 'r');
      let config: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > remaining) return markdown;
        const confirmed = await canonical(file, 'variant configuration');
        const current = await stat(confirmed);
        if (!inside(root, confirmed) || current.dev !== info.dev || current.ino !== info.ino) {
          throw new Error('The variant configuration changed or escaped its authorized root.');
        }
        const chunks: Buffer[] = [];
        while (true) {
          const buffer = Buffer.alloc(Math.min(64 * 1024, remaining + 1));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          remaining -= bytesRead;
          if (remaining < 0) return markdown;
          chunks.push(buffer.subarray(0, bytesRead));
        }
        config = Buffer.concat(chunks).toString('utf8');
      } finally { await handle.close(); }
      const group = variantGroup(config, metadata.id);
      if (group) {
        const attribute = group.title.replace(/\\/g, '\\\\').replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const label = (text: string) => text.replace(/[\\`*_[\]<>!|]/g, '\\$&');
        const selector = `:::selector title="${attribute}"\n${group.pivots.map(item => `- [${label(item.title)}](#variant/${item.id})`).join('\n')}\n:::selector-end`;
        return `${markdown.slice(0, metadata.end)}\n${selector}\n\n${markdown.slice(metadata.end)}`;
      }
    }
    if (key(directory) === key(root)) break;
    directory = path.dirname(directory);
  }
  return markdown;
}

/**
 * Node-only, in-memory preparation. An absent per-document native folder grant does no filesystem IO.
 * Only standalone DocFX include lines are supported; inline include syntax intentionally stays raw.
 * Limits count include occurrences and all UTF-8 source bytes (including directive text), not assets.
 * Variant metadata may use an ancestor's local YAML subset (1 MB total, at most 64 ancestors);
 * missing/unsupported configuration leaves the original source for the renderer's explicit fallback.
 */
export async function preparePublishing(
  markdown: string, documentPath: string | null, authorizedRoot: string | null,
): Promise<{ markdown: string; includes: string[] }> {
  if (!authorizedRoot) return { markdown, includes: [] };
  const { root, document, originalPath } = await authorizedDocument(documentPath, authorizedRoot);
  let bytes = Buffer.byteLength(markdown, 'utf8');
  let files = 0;
  const includes: string[] = [];
  const seen = new Set<string>();
  const active = new Set([key(document)]);
  const topDirectory = await canonical(path.dirname(originalPath), 'saved document folder');
  if (bytes > MAX_BYTES) throw new Error('Publishing content exceeds the 10 MB limit.');
  const resolve = (source: string, from: string, kind: 'include' | 'image') => resolvePublishingFile(root, source, from, kind);
  const read = async (file: string): Promise<string> => {
    const content = await readPublishingFile(root, file, MAX_BYTES - bytes);
    bytes += content.length;
    return content.toString('utf8');
  };
  const expand = async (source: string, from: string, depth: number): Promise<string> => {
    const analysis = analyze(source);
    const changes: Replacement[] = [];
    for (const include of analysis.includes) {
      if (depth >= MAX_DEPTH) throw new Error('Local includes exceed the maximum depth of 8.');
      if (++files > MAX_FILES) throw new Error('Local includes exceed the maximum of 32 files/expansions.');
      const file = await resolve(include.source, from, 'include');
      const identity = key(file);
      if (active.has(identity)) throw new Error(`Local include cycle detected: ${file}`);
      if (!seen.has(identity)) { includes.push(file); seen.add(identity); }
      active.add(identity);
      try { changes.push({ ...include, value: await expand(await read(file), file, depth + 1) }); }
      finally { active.delete(identity); }
    }
    if (depth > 0) {
      for (const image of analysis.images) {
        if (overlaps(image, analysis.includes) || /^data:/i.test(image.source)) continue;
        const file = await resolve(image.source, from, 'image');
        const rebased = pathURL(path.relative(topDirectory, file));
        const value = image.referenceTitle === undefined ? rebased
          : `(${rebased}${image.referenceTitle ? ` "${image.referenceTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"` : ''})`;
        changes.push({ ...image, value });
      }
    }
    const expanded = apply(source, changes);
    if (Buffer.byteLength(expanded, 'utf8') > MAX_BYTES) throw new Error('Expanded publishing content exceeds the 10 MB limit.');
    return expanded;
  };
  const expanded = await expand(markdown, document, 0);
  const prepared = await injectVariantSelector(expanded, document, root);
  if (Buffer.byteLength(prepared, 'utf8') > MAX_BYTES) throw new Error('Expanded publishing content exceeds the 10 MB limit.');
  return { markdown: prepared, includes };
}
