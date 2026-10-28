export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 50;

export function validateTableSize(rows: number, columns: number): void {
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_TABLE_ROWS
    || !Number.isInteger(columns) || columns < 1 || columns > MAX_TABLE_COLUMNS) {
    throw new Error(`Choose 1-${MAX_TABLE_ROWS} rows and 1-${MAX_TABLE_COLUMNS} columns, using whole numbers. Rows include the header.`);
  }
}

export function tableMarkdown(rows: number, columns: number): string {
  validateTableSize(rows, columns);
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return `\n\n${[
    row(Array.from({ length: columns }, (_, index) => `Column ${index + 1}`)),
    row(Array<string>(columns).fill('---')),
    ...Array<string>(rows - 1).fill(row(Array<string>(columns).fill(''))),
  ].join('\n')}\n\n`;
}
