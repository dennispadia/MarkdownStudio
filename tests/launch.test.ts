import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileArguments } from '../lib/launch.js';

test('packaged launches resolve quoted-by-the-shell filenames and multiple files against the launching directory', () => {
  const cwd = path.resolve('fixtures');
  assert.deepEqual(fileArguments(['studio.exe', 'notes with spaces.md', 'Résumé 日本語.MD', 'draft.markdown', 'notes.mdown', 'plain.txt'], cwd, true),
    ['notes with spaces.md', 'Résumé 日本語.MD', 'draft.markdown', 'notes.mdown', 'plain.txt'].map(file => path.join(cwd, file)));
});

test('development launches exclude the Electron executable, app entry, and switches', () => {
  const cwd = path.resolve('fixtures');
  assert.deepEqual(fileArguments(['electron.exe', 'application.md', '--user-data-dir=profile.md', '--inspect=0', 'draft.md'], cwd, false),
    [path.join(cwd, 'draft.md')]);
  assert.deepEqual(fileArguments(['studio.exe'], cwd, true), []);
});

test('file activation filters non-documents and URLs and deduplicates Windows paths', () => {
  const cwd = path.resolve('fixtures');
  assert.deepEqual(fileArguments(['studio.exe', 'notes.md', './NOTES.md', 'https://example.com/file.md', 'studio://open/file.md', 'picture.png'], cwd, true),
    [path.join(cwd, 'NOTES.md')]);
  assert.deepEqual(fileArguments(['studio.exe', '--', '-draft.md'], cwd, true), [path.join(cwd, '-draft.md')]);
});
