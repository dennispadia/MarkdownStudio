/** Limits apply before Mermaid parses or lays out untrusted document content. */
export const diagramLimits = { sourceLength: 12000, lines: 250, statements: 350, diagrams: 32, pngBytes: 8 * 1024 * 1024 } as const;

export function isMermaidLanguage(language: string | null | undefined): boolean {
  return language?.trim().split(/\s+/)[0].toLowerCase() === 'mermaid';
}

export function prepareMermaid(source: string): string {
  if (source.length > diagramLimits.sourceLength) throw new Error('Mermaid diagram exceeds the 12,000-character limit.');
  // Document-supplied configuration is never applied, including frontmatter.
  const clean = source.replace(/^\uFEFF/, '').replace(/^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
    .replace(/%%\{[\s\S]*?\}%%/g, '').trim();
  if (/%%\{/.test(clean)) throw new Error('Unclosed Mermaid configuration directive.');
  if (clean.split('\n').length > diagramLimits.lines || clean.split(/[;\n]/).length > diagramLimits.statements) {
    throw new Error('Mermaid diagram exceeds the statement limit.');
  }
  const content = clean.replace(/%%[^\n]*/g, '');
  if (!/^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|pie|journey|timeline)\b/.test(content.trim())) {
    throw new Error('Unsupported Mermaid diagram type. Use flowchart, sequence, class, state, ER, pie, journey, or timeline.');
  }
  if (/<\s*[a-z/!]|&(?:#|[a-z]+\s*;)|(?:^|[;\n])\s*(?:click|href|callback|call|links?)\b|(?:https?|file|data|javascript|vbscript):|:\/\/|\\|@import|url\s*\(|@\s*\{/im.test(content)) {
    throw new Error('Mermaid links, HTML, external resources, callbacks, and custom shapes are disabled.');
  }
  if ((content.match(/(?:--|==|~~|->|=>)/g)?.length ?? 0) > 200) throw new Error('Mermaid diagram exceeds the 200-edge limit.');
  return clean;
}

export interface MermaidAsset { source: string; png: string }
