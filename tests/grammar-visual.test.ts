import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { visualGrammarRange, visualGrammarSnapshot } from '../src/grammar-highlights.js';
import type { GrammarIssue } from '../lib/grammar.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    codeBlock: { content: 'text*', group: 'block', marks: '' },
    lekhContents: { group: 'block', atom: true, attrs: { markdown: { default: '' } } },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline' },
    image: { inline: true, group: 'inline', atom: true },
  },
  marks: { bold: {}, code: {}, link: { attrs: { href: {} } } },
});
const paragraph = (text: string) => schema.node('paragraph', null, schema.text(text));
const issue = (from: number, to: number): GrammarIssue => ({
  from, to, rule: 'test', kind: 'grammar', message: 'Test suggestion',
  matchedText: 'are', suggestions: ['is'],
});

test('Visual grammar offsets remain correct after emoji and non-Latin text', () => {
  const text = '\u{1f600} नमस्ते. This are an example.';
  const doc = schema.node('doc', null, [paragraph(text)]);
  const snapshot = visualGrammarSnapshot(doc);
  const from = snapshot.text.indexOf('are');
  const range = visualGrammarRange(snapshot, issue(from, from + 3));
  assert.deepEqual(range, { from: text.indexOf('are') + 1, to: text.indexOf('are') + 4 });
  assert.equal(doc.textBetween(range!.from, range!.to), 'are');
});

test('Visual grammar excludes fenced code, inline code and generated contents', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Prose. '), schema.text('This are code.', [schema.mark('code')]), schema.text(' More prose.'),
    ]),
    schema.node('codeBlock', null, schema.text('This are also code.')),
    schema.node('lekhContents', { markdown: '# This are generated contents' }),
    paragraph('This are prose.'),
  ]);
  const snapshot = visualGrammarSnapshot(doc);
  assert.doesNotMatch(snapshot.text, /This are code|also code|generated contents/);
  assert.match(snapshot.text, /This are prose/);
  const masked = snapshot.text.indexOf('Prose. ') + 8;
  assert.equal(visualGrammarRange(snapshot, issue(masked, masked + 3)), null);
});

test('Visual grammar rejects spans crossing blocks, atoms or formatting boundaries', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('One ', [schema.mark('bold')]), schema.text('two'), schema.node('hardBreak'), schema.text('three'),
    ]),
    paragraph('Four five.'),
  ]);
  const snapshot = visualGrammarSnapshot(doc);
  assert.equal(visualGrammarRange(snapshot, issue(0, 7)), null, 'A replacement must not flatten mixed bold/plain text');
  assert.equal(visualGrammarRange(snapshot, issue(4, 10)), null, 'A replacement must not delete an inline atom');
  const boundary = snapshot.text.indexOf('\n\n');
  assert.equal(visualGrammarRange(snapshot, issue(boundary - 2, boundary + 4)), null);
  assert.equal(visualGrammarRange(snapshot, issue(-1, 3)), null);
  assert.equal(visualGrammarRange(snapshot, issue(0, 1000)), null);
});

test('Applying a visual correction is a text transaction that retains formatting and cannot inject HTML', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('This '), schema.text('are', [schema.mark('bold')]), schema.text(' an example.'),
    ]),
  ]);
  const snapshot = visualGrammarSnapshot(doc);
  const from = snapshot.text.indexOf('are');
  const range = visualGrammarRange(snapshot, issue(from, from + 3))!;
  const state = EditorState.create({ doc });
  const updated = state.apply(state.tr.insertText('is', range.from, range.to));
  assert.equal(updated.doc.textContent, 'This is an example.');
  assert.equal(updated.doc.nodeAt(range.from)!.marks[0].type.name, 'bold');
  const literal = state.apply(state.tr.insertText('<img src=x>', range.from, range.to));
  assert.match(literal.doc.textContent, /<img src=x>/);
  assert.equal(literal.doc.firstChild!.childCount, 3);
});
