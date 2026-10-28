import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, tableMarkdown, validateTableSize } from '../lib/tables.js';

test('table dimensions accept inclusive limits and reject invalid or oversized values', () => {
  for (const [rows, columns] of [[1, 1], [4, 3], [MAX_TABLE_ROWS, MAX_TABLE_COLUMNS]]) {
    assert.doesNotThrow(() => validateTableSize(rows, columns));
  }
  for (const [rows, columns] of [[0, 3], [4, 0], [-1, 3], [1.5, 3], [4, 2.5], [NaN, 3], [4, Infinity], [101, 3], [4, 51]]) {
    assert.throws(() => tableMarkdown(rows, columns), /whole numbers/);
  }
});

test('Markdown tables render the exact chosen dimensions, counting the header as a row', () => {
  const parser = new MarkdownIt();
  for (const [rows, columns] of [[1, 1], [4, 3], [7, 5], [MAX_TABLE_ROWS, MAX_TABLE_COLUMNS]]) {
    const html = parser.render(tableMarkdown(rows, columns));
    assert.equal((html.match(/<tr>/g) ?? []).length, rows);
    assert.equal((html.match(/<th>/g) ?? []).length, columns);
    assert.equal((html.match(/<td>/g) ?? []).length, (rows - 1) * columns);
  }
});
