import path from 'node:path';

export function fileArguments(argv: readonly string[], cwd: string, packaged: boolean): string[] {
  const files = new Map<string, string>();
  let positionalOnly = false;
  for (const argument of argv.slice(packaged ? 1 : 2)) {
    if (argument === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && argument.startsWith('-')) continue;
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(argument)) continue;
    if (!['.md', '.markdown', '.mdown', '.txt'].includes(path.extname(argument).toLowerCase())) continue;
    const file = path.resolve(cwd, argument);
    files.set(file.toLowerCase(), file);
  }
  return [...files.values()];
}
