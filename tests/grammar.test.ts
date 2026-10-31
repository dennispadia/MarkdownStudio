import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalLinter, SuggestionKind } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import {
  disposeGrammarEngine, handleGrammarRequest, issueIgnoreKey, lintGrammar,
  maxGrammarCharacters, maxGrammarIssues, type GrammarIssue, type GrammarRequest,
} from '../lib/grammar.js';

const originalFetch = globalThis.fetch;
let externalFetches = 0;
const unavailableFetch: typeof fetch = async () => {
  externalFetches++;
  throw new Error('Tests prohibit network and data-URL fetches.');
};

before(() => { globalThis.fetch = unavailableFetch; });
after(async () => {
  try {
    await disposeGrammarEngine();
    assert.equal(externalFetches, 0, 'all WASM bytes must come from the installed inlined binary');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function findIssue(issues: GrammarIssue[], rule: string): GrammarIssue {
  const issue = issues.find(issue => issue.rule === rule);
  assert.ok(issue, `Expected the real Harper ${rule} rule: ${JSON.stringify(issues)}`);
  return issue;
}

function replaceIssue(text: string, issue: GrammarIssue): string {
  assert.equal(text.slice(issue.from, issue.to), issue.matchedText);
  assert.ok(issue.suggestions.length);
  return text.slice(0, issue.from) + issue.suggestions[0] + text.slice(issue.to);
}

test('real offline Harper checks agreement and indefinite articles, not just repeated words', async () => {
  const text = 'He are here. She have a apple. It is an university.';
  const { issues, limited } = await lintGrammar(text, 'plaintext');
  assert.equal(limited, false);
  assert.deepEqual(findIssue(issues, 'PronounInflectionBe').suggestions, ['is']);
  assert.deepEqual(findIssue(issues, 'PronounVerbAgreement').suggestions, ['has']);
  const articles = issues.filter(issue => issue.rule === 'AnA');
  assert.equal(articles.length, 2);
  assert.deepEqual(articles.map(issue => issue.suggestions), [['an'], ['a']]);
  for (const issue of issues) {
    assert.equal(text.slice(issue.from, issue.to), issue.matchedText);
    assert.ok(issue.message);
    assert.ok(issue.kind);
  }
  assert.equal(globalThis.fetch, unavailableFetch, 'initialization must restore the worker fetch function');
});

test('correct English and unfamiliar spellings do not receive spelling-only suggestions', async () => {
  assert.deepEqual(await lintGrammar('She has an apple. He is ready.', 'plaintext'), { issues: [], limited: false });
  const { issues } = await lintGrammar('Xyzzylarium is here. This is mispelled.', 'plaintext');
  assert.ok(!issues.some(issue => issue.kind === 'Spelling' || ['SpellCheck', 'Misspell'].includes(issue.rule)));
});

test('punctuation removals and repeated-word replacements are whole-span edit values', async () => {
  const text = 'This is is a test !';
  const { issues } = await lintGrammar(text, 'plaintext');
  const repeated = findIssue(issues, 'RepeatedWords');
  assert.equal(repeated.matchedText, 'is is');
  assert.deepEqual(repeated.suggestions, ['is']);
  const space = findIssue(issues, 'Spaces');
  assert.equal(space.matchedText, ' ');
  assert.deepEqual(space.suggestions, ['']);
  assert.equal(replaceIssue(text, space), 'This is is a test!');
});

test('normalized suggestions agree with the real WASM applySuggestion semantics', async () => {
  await lintGrammar('He are ready.', 'plaintext');
  const linter = new LocalLinter({ binary: binaryInlined });
  const kinds = new Set<SuggestionKind>();
  try {
    await linter.setLintConfig({ SpellCheck: false, Misspell: false });
    for (const text of ['He are here.', 'This is a test !', 'She said "hello.', 'We need apples, pears and oranges.', 'Hello,world.']) {
      const { issues } = await lintGrammar(text, 'plaintext');
      const groups = await linter.organizedLints(text, { language: 'plaintext' });
      try {
        for (const [rule, lints] of Object.entries(groups)) {
          for (const lint of lints) {
            const span = lint.span();
            const suggestions = lint.suggestions();
            try {
              const issue = issues.find(issue => issue.rule === rule && issue.from === span.start && issue.to === span.end);
              assert.ok(issue);
              for (const suggestion of suggestions) {
                kinds.add(suggestion.kind());
                const applied = await linter.applySuggestion(text, lint, suggestion);
                const replacement = applied.slice(span.start, applied.length - (text.length - span.end));
                assert.ok(issue.suggestions.includes(replacement), `Unexpected ${rule} suggestion kind ${suggestion.kind()}`);
                assert.equal(text.slice(0, issue.from) + replacement + text.slice(issue.to), applied);
              }
            } finally {
              span.free();
              for (const suggestion of suggestions) suggestion.free();
            }
          }
        }
      } finally {
        for (const lints of Object.values(groups)) for (const lint of lints) lint.free();
      }
    }
    assert.ok(kinds.has(SuggestionKind.Replace));
    assert.ok(kinds.has(SuggestionKind.Remove));
    assert.ok(kinds.has(SuggestionKind.InsertAfter), 'exercise a real insert-after, not a mocked suggestion');
  } finally {
    await linter.dispose();
  }
});

test('Markdown fences, inline code, destinations, reference definitions, HTML and images are ignored', async () => {
  const hidden = [
    '```javascript\nShe have a apple.\n```',
    '~~~text\nHe are ready.\n~~~',
    '    She have a apple.',
    '`She have a apple.` and ``He are `ready`.``',
    '[A safe label](https://example.test/She-have-a-apple "He are ready.")',
    '[A safe label][reference]\n\n[reference]: https://example.test/She-have-a-apple "He are ready."',
    '![She have a apple.](image.png "He are ready.")',
    '<!-- She have a apple. -->',
    '<script>She have a apple.</script>',
    '<span title="She have a apple."></span>',
  ].join('\n\n');
  const text = `${hidden}\n\nHe are ready.`;
  const { issues } = await lintGrammar(text);
  assert.equal(issues.length, 1, JSON.stringify(issues));
  assert.equal(issues[0].rule, 'PronounInflectionBe');
  assert.equal(issues[0].from, text.lastIndexOf('are'));
});

test('URL and email text is masked in Markdown and plaintext, including parenthesized URL paths', async () => {
  const hidden = 'https://example.test/She-have-a-apple http://example.test/(He-are-ready) www.example.com/a-apple mailto:person@example.com person@example.com';
  for (const language of ['markdown', 'plaintext'] as const) {
    const text = `${hidden}\n\nShe have a apple.`;
    const { issues } = await lintGrammar(text, language);
    assert.equal(issues.length, 2, JSON.stringify(issues));
    assert.ok(issues.every(issue => issue.from > hidden.length));
    assert.equal(findIssue(issues, 'PronounVerbAgreement').from, text.lastIndexOf('have'));
  }
});

test('YAML and TOML frontmatter and generated contents are masked without moving offsets', async () => {
  for (const frontmatter of [
    '---\r\ntitle: 😀 She have a apple.\r\n---\r\n',
    '\uFEFF---\ntitle: She have a apple.\n...\n',
    '+++\ntitle = "He are here."\n+++\n',
  ]) {
    const text = `${frontmatter}\n<!-- lekh:toc -->\n- [She have a apple.](#a)\n<!-- /lekh:toc -->\n\nHe are ready.`;
    const { issues } = await lintGrammar(text);
    assert.equal(issues.length, 1, JSON.stringify(issues));
    assert.equal(issues[0].from, text.lastIndexOf('are'));
  }
  assert.deepEqual(await lintGrammar('---\ntitle: She have a apple.'), { issues: [], limited: false });
  assert.deepEqual(await lintGrammar('<!-- lekh:toc -->\n- [She have a apple.](#a)'), { issues: [], limited: false });
});

test('a contents marker inside a code example cannot mask subsequent prose', async () => {
  for (const example of [
    '```html\n<!-- lekh:toc -->\n```',
    '<script>\n<!-- lekh:toc -->\n</script>',
    '<pre>\n<!-- lekh:toc -->\n</pre>',
  ]) {
    const text = `${example}\n\nHe are ready.`;
    const { issues } = await lintGrammar(text);
    assert.equal(findIssue(issues, 'PronounInflectionBe').from, text.lastIndexOf('are'));
  }
});

test('word-local corrections preserve emphasis and link labels, but format-crossing phrases are rejected', async () => {
  for (const text of [
    'He **are** ready.',
    '**He** are ready.',
    '[He are ready.](https://example.test/a-apple)',
    '[He are ready.][ref]\n\n[ref]: https://example.test',
  ]) {
    const { issues } = await lintGrammar(text);
    const issue = findIssue(issues, 'PronounInflectionBe');
    assert.equal(issue.matchedText, 'are');
    assert.equal(replaceIssue(text, issue), text.replace('are', 'is'));
  }
  const plain = 'For all intensive purposes, we are done.';
  assert.ok(findIssue((await lintGrammar(plain)).issues, 'AllIntentsAndPurposes').suggestions.length);
  for (const text of [
    'For all **intensive** purposes, we are done.',
    'For all [intensive](https://example.test) purposes, we are done.',
    'For all _intensive_ purposes, we are done.',
  ]) {
    const { issues } = await lintGrammar(text);
    assert.ok(!issues.some(issue => issue.rule === 'AllIntentsAndPurposes'), JSON.stringify(issues));
    assert.ok(issues.every(issue => !/[*_[\]<>]/u.test(issue.matchedText)));
  }
});

test('Harper public spans remain UTF-16 after emoji, combining marks, Devanagari, and masked astral text', async () => {
  for (const prefix of ['😀 नमस्ते ', '👩🏽‍💻 देवनागरी e\u0301 ', '𐐀 😀😀 हिन्दी ']) {
    for (const language of ['markdown', 'plaintext'] as const) {
      const text = `${prefix}She have a apple.`;
      const { issues } = await lintGrammar(text, language);
      const verb = findIssue(issues, 'PronounVerbAgreement');
      const article = findIssue(issues, 'AnA');
      assert.equal(verb.from, text.indexOf('have'));
      assert.equal(verb.to, text.indexOf('have') + 4);
      assert.equal(article.from, text.indexOf('a apple'));
      assert.equal(article.to, text.indexOf('a apple') + 1);
      assert.equal(replaceIssue(text, verb), `${prefix}She has a apple.`);
      assert.equal(replaceIssue(text, article), `${prefix}She have an apple.`);
    }
  }
  const text = '---\ntitle: 😀😀\n---\n\n😀 नमस्ते She have a apple.';
  const issue = findIssue((await lintGrammar(text)).issues, 'PronounVerbAgreement');
  assert.equal(issue.from, text.indexOf('have'));
  assert.equal(text.slice(issue.from, issue.to), 'have');
});

test('character limits reject the entire document explicitly, counting UTF-16 units', async () => {
  assert.equal(maxGrammarCharacters, 100_000);
  assert.deepEqual(await lintGrammar(' '.repeat(maxGrammarCharacters)), { issues: [], limited: false });
  for (const text of ['x'.repeat(maxGrammarCharacters + 1), '😀'.repeat(maxGrammarCharacters / 2 + 1)]) {
    await assert.rejects(() => lintGrammar(text), /100,000 characters/);
    const response = await handleGrammarRequest({ id: 8, text, language: 'markdown' });
    assert.equal(response.id, 8);
    assert.equal(response.ok, false);
    if (!response.ok) assert.match(response.error, /100,000 characters/);
  }
});

test('issue limits report partial results explicitly and preserve source ordering', async () => {
  assert.equal(maxGrammarIssues, 200);
  const text = 'He are here.\n\n'.repeat(maxGrammarIssues + 1);
  const { issues, limited } = await lintGrammar(text, 'plaintext');
  assert.equal(issues.length, maxGrammarIssues);
  assert.equal(limited, true);
  assert.ok(issues.every((issue, index) => issue.from === index * 'He are here.\n\n'.length + 3));
  const exact = await lintGrammar('He are here.\n\n'.repeat(maxGrammarIssues), 'plaintext');
  assert.equal(exact.issues.length, maxGrammarIssues);
  assert.equal(exact.limited, false);
});

test('worker requests return structured-clone-safe success and failure contracts', async () => {
  const response = await handleGrammarRequest({ id: 7, text: 'He are ready.', language: 'plaintext' });
  assert.deepEqual(structuredClone(response), response);
  assert.equal(response.id, 7);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.limited, false);
    assert.equal(findIssue(response.issues, 'PronounInflectionBe').matchedText, 'are');
    assert.deepEqual(Object.keys(response).sort(), ['id', 'issues', 'limited', 'ok']);
  }
  for (const request of [
    { id: 9, text: 'He are ready.', language: 'javascript' },
    { id: 9, text: 42, language: 'markdown' },
    { id: 9, text: 'He are ready.' },
    { id: -1, text: '', language: 'markdown' },
    null,
  ]) {
    const result = await handleGrammarRequest(request as unknown as GrammarRequest);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.error);
    assert.deepEqual(Object.keys(result).sort(), ['error', 'id', 'ok']);
  }
});

test('ignored issue keys normalize text but keep different grammar rules distinct', () => {
  const key = issueIgnoreKey({ rule: 'RepeatedWords', matchedText: '  WORD\tword  ' });
  assert.equal(key, issueIgnoreKey({ rule: 'RepeatedWords', matchedText: 'word word' }));
  assert.equal(issueIgnoreKey({ rule: 'AnA', matchedText: 'Ａ' }), issueIgnoreKey({ rule: 'AnA', matchedText: 'a' }));
  assert.notEqual(key, issueIgnoreKey({ rule: 'OtherRule', matchedText: 'word word' }));
});

test('malicious Markdown, HTML, and JavaScript-looking prose is data, never executed', async () => {
  const globals = globalThis as typeof globalThis & { grammarExecuted?: boolean };
  globals.grammarExecuted = false;
  const text = '<script>globalThis.grammarExecuted = true</script>\n\n'
    + '<img src=x onerror="globalThis.grammarExecuted = true">\n\n'
    + '[He are ready.](javascript:globalThis.grammarExecuted=true)\n\n'
    + '`globalThis.grammarExecuted = true`\n\nShe have a apple.';
  const response = await handleGrammarRequest({ id: 15, text, language: 'markdown' });
  assert.equal(response.ok, true);
  assert.equal(globals.grammarExecuted, false);
  if (response.ok) {
    assert.ok(findIssue(response.issues, 'PronounVerbAgreement'));
    for (const issue of response.issues) assert.equal(text.slice(issue.from, issue.to), issue.matchedText);
  }
  delete globals.grammarExecuted;
});

test('the engine remains reusable after invalid requests and repeated lint runs', async () => {
  await assert.rejects(() => lintGrammar('text', 'javascript' as 'markdown'), /Unsupported/);
  for (let index = 0; index < 12; index++) {
    const result = await lintGrammar('😀 He are here. It is a apple.');
    assert.equal(findIssue(result.issues, 'PronounInflectionBe').from, 6);
    assert.deepEqual(findIssue(result.issues, 'AnA').suggestions, ['an']);
  }
  assert.equal(globalThis.fetch, unavailableFetch);
});
