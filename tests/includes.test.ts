import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preparePublishing, readAuthorizedInclude } from '../lib/includes.js';

const limit = 10 * 1024 * 1024;
const include = (file: string) => `[!INCLUDE [Section](${file})]`;
const url = (...parts: string[]) => parts.map(part => encodeURIComponent(part)
  .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

async function fixture(run: (root: string, document: string, put: (file: string, content: string | Buffer) => Promise<string>) => Promise<void>) {
  const directory = await mkdtemp(path.join(process.cwd(), '.include-tests-'));
  const root = path.join(directory, 'grant');
  const put = async (file: string, content: string | Buffer) => {
    const target = path.resolve(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  };
  try {
    const document = await put('docs/main.md', 'original saved document\n');
    await run(root, document, put);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('no authorized root preserves every byte without requiring any existing local path', async () => {
  const markdown = `# Unsaved\r\n${include('missing.md')}\r\n`;
  assert.deepEqual(await preparePublishing(markdown, null, null), { markdown, includes: [] });
  assert.deepEqual(await preparePublishing(markdown, 'Z:\\does-not-exist.md', null), { markdown, includes: [] });
});

test('opening an authorized shared file reads its own bytes even when its child includes are broken', async () => {
  await fixture(async (root, document, put) => {
    const content = '# Edit this file\n\n[!INCLUDE [Broken](missing.md)]\n';
    const file = await put('includes/shared.md', content);
    assert.deepEqual(await readAuthorizedInclude('../includes/shared.md', document, root), { path: await realpath(file), content });
    assert.equal(await readFile(file, 'utf8'), content);
    await assert.rejects(readAuthorizedInclude('../includes/shared.md', document, null), /Allow.*project folder/);
    await assert.rejects(readAuthorizedInclude('https://example.com/shared.md', document, root), /relative local/);
    await assert.rejects(readAuthorizedInclude('../../outside.md', document, root), /outside/);
    await assert.rejects(readAuthorizedInclude('../includes/missing.md', document, root), /Missing or inaccessible/);
    await put('includes/huge.md', Buffer.alloc(limit + 1, 32));
    await assert.rejects(readAuthorizedInclude('../includes/huge.md', document, root), /10 MB/);
    await put('includes/binary.md', Buffer.from([65, 0, 66]));
    await assert.rejects(readAuthorizedInclude('../includes/binary.md', document, root), /UTF-8/);
    await put('includes/invalid.md', Buffer.from([0xc3, 0x28]));
    await assert.rejects(readAuthorizedInclude('../includes/invalid.md', document, root), /not valid UTF-8/);
  });
});

test('authorization requires a saved, real, regular source document inside a real directory grant', async () => {
  await fixture(async (root, document, put) => {
    await assert.rejects(preparePublishing('', null, root), /Save the Markdown/);
    await assert.rejects(preparePublishing('', document, 'relative-root'), /absolute local paths/);
    await assert.rejects(preparePublishing('', 'main.md', root), /absolute local paths/);
    await assert.rejects(preparePublishing('', path.join(root, 'missing.md'), root), /Missing or inaccessible.*document/);
    await assert.rejects(preparePublishing('', document, document), /root must be a directory/);
    await assert.rejects(preparePublishing('', root, root), /document must be a regular file/);
    const outside = await put('../outside.md', 'private');
    await assert.rejects(preparePublishing('', outside, root), /document resolves outside/);
  });
});

test('standalone local includes expand recursively from each containing file and never alter originals', async () => {
  await fixture(async (root, document, put) => {
    const firstSource = `# One\n${include('nested/two.md')}\nOne end`;
    const first = await put('includes/one.md', firstSource);
    const second = await put('includes/nested/two.md', '# Two');
    const markdown = `# Edited in memory\r\n${include('../includes/one.md')}\r\nEnd`;
    const result = await preparePublishing(markdown, document, root);
    assert.equal(result.markdown, '# Edited in memory\r\n# One\n# Two\nOne end\r\nEnd');
    assert.deepEqual(result.includes, [await realpath(first), await realpath(second)]);
    assert.equal(await readFile(document, 'utf8'), 'original saved document\n');
    assert.equal(await readFile(first, 'utf8'), firstSource);
    assert.equal(await readFile(second, 'utf8'), '# Two');
  });
});

test('include paths support spaces, URI-encoded spaces, angle brackets and escaped punctuation', async () => {
  await fixture(async (root, document, put) => {
    const file = await put('includes/a file(1).md', 'expanded');
    for (const target of [
      '../includes/a file(1).md', '../includes/a%20file(1).md',
      '<../includes/a file(1).md>', '../includes/a\\ file\\(1\\).md',
    ]) {
      assert.deepEqual(await preparePublishing(`  ${include(target)}  `, document, root), {
        markdown: 'expanded', includes: [await realpath(file)],
      });
    }
  });
});

test('only full-line include directives expand; inline syntax and malformed text stay raw', async () => {
  await fixture(async (root, document) => {
    const markdown = [
      `Before ${include('missing.md')} after`, `- ${include('missing.md')}`,
      `> ${include('missing.md')}`, `\\${include('missing.md')}`,
      '[!INCLUDE [missing](missing.md)', 'Ordinary [Section](missing.md)',
    ].join('\n');
    assert.deepEqual(await preparePublishing(markdown, document, root), { markdown, includes: [] });
  });
});

test('fenced and indented code, multiline inline code and HTML comments are not expanded', async () => {
  await fixture(async (root, document) => {
    const missing = include('missing.md');
    const markdown = [
      '```md', missing, '```', '', '~~~', missing, '~~~', '',
      `    ${missing}`, '', `\t${missing}`, '', '`', missing, '`', '',
      '<!--', missing, '-->', '', '<!-- same-line comment -->', '',
      'prefix <!--', missing, '--> suffix', '', '``', missing, '``',
      '', 'prefix <!-- comment across paragraphs', '', missing, '', '-->',
      '', 'prefix <!-- unterminated comment', '', missing,
    ].join('\n');
    assert.deepEqual(await preparePublishing(markdown, document, root), { markdown, includes: [] });
  });
});

test('comment-looking text inside fenced/inline code does not hide following real includes', async () => {
  await fixture(async (root, document, put) => {
    await put('docs/section.md', 'expanded');
    const markdown = `\`\`\`\n<!--\n\`\`\`\n\n\`<!--\`\n\n${include('section.md')}`;
    assert.equal((await preparePublishing(markdown, document, root)).markdown, markdown.replace(include('section.md'), 'expanded'));
  });
});

test('missing files, directories and non-Markdown includes fail explicitly without partial success', async () => {
  await fixture(async (root, document, put) => {
    const good = await put('docs/good.md', 'valid');
    await mkdir(path.join(root, 'docs', 'directory.md'));
    await put('docs/page.html', '<html>private</html>');
    for (const [file, error] of [
      ['missing.md', /Missing or inaccessible include/],
      ['directory.md', /regular file/],
      ['page.html', /Markdown/],
    ] as const) {
      await assert.rejects(preparePublishing(`${include('good.md')}\n${include(file)}`, document, root), error);
    }
    assert.equal(await readFile(good, 'utf8'), 'valid');
  });
});

test('literal ../ is allowed inside the grant, but lexical and prefix-sibling escapes are rejected', async () => {
  await fixture(async (root, document, put) => {
    await put('shared/allowed.md', 'allowed');
    await put('../private.md', 'private');
    await put(`../${path.basename(root)}-sibling/private.md`, 'private');
    assert.equal((await preparePublishing(include('../shared/allowed.md'), document, root)).markdown, 'allowed');
    for (const target of ['../../private.md', `../../${path.basename(root)}-sibling/private.md`]) {
      await assert.rejects(preparePublishing(include(target), document, root), /traverses outside/);
    }
  });
});

test('include resolution rejects protocols, remote URLs, absolute/drive/UNC/NUL and encoded traversal paths', async () => {
  await fixture(async (root, document) => {
    for (const target of [
      'https://example.invalid/private.md', 'http://example.invalid/private.md',
      'file:///C:/private.md', 'ftp://example.invalid/private.md', 'javascript:private.md',
      'data:text/plain,private.md', 'mailto:private.md', '//server/share/private.md',
      '\\\\server\\share\\private.md', 'C:\\private.md', 'C:private.md', '/private.md',
      '\\private.md', 'private\u0000.md', '%2e%2e/private.md', '%2E%2E%2Fprivate.md',
      '%252e%252e/private.md', 'folder%5cprivate.md', 'folder%2fprivate.md',
      'private%00.md', 'private%GG.md', 'https%3Aprivate.md', 'private.md?download=1',
    ]) {
      await assert.rejects(preparePublishing(include(target), document, root),
        /Unsafe|relative local|encoding|forbidden/, target);
    }
  });
});

test('include cycles, including a reference back to the root document, fail explicitly', async () => {
  await fixture(async (root, document, put) => {
    await put('docs/a.md', include('b.md'));
    await put('docs/b.md', include('a.md'));
    await assert.rejects(preparePublishing(include('a.md'), document, root), /cycle detected/);
    await assert.rejects(preparePublishing(include('main.md'), document, root), /cycle detected/);
  });
});

test('eight nested levels are allowed and a ninth is rejected', async () => {
  await fixture(async (root, document, put) => {
    for (let depth = 1; depth <= 8; depth++) {
      await put(`docs/level-${depth}.md`, depth === 8 ? 'leaf' : include(`level-${depth + 1}.md`));
    }
    const allowed = await preparePublishing(include('level-1.md'), document, root);
    assert.equal(allowed.markdown, 'leaf');
    assert.equal(allowed.includes.length, 8);
    await put('docs/level-8.md', include('level-9.md'));
    await put('docs/level-9.md', 'too deep');
    await assert.rejects(preparePublishing(include('level-1.md'), document, root), /depth of 8/);
  });
});

test('32 include occurrences are allowed, dependencies are unique, and the 33rd fails', async () => {
  await fixture(async (root, document, put) => {
    const file = await put('docs/repeat.md', 'repeat');
    const markdown = Array.from({ length: 32 }, () => include('repeat.md')).join('\n');
    assert.deepEqual(await preparePublishing(markdown, document, root), {
      markdown: Array(32).fill('repeat').join('\n'), includes: [await realpath(file)],
    });
    await assert.rejects(preparePublishing(`${markdown}\n${include('repeat.md')}`, document, root), /32 files/);
  });
});

test('10 MB source budget rejects oversized root, oversized include and aggregate UTF-8 bytes', async () => {
  await fixture(async (root, document, put) => {
    await assert.rejects(preparePublishing('x'.repeat(limit + 1), document, root), /10 MB/);
    await put('docs/large.md', Buffer.alloc(limit + 1, 120));
    await assert.rejects(preparePublishing(include('large.md'), document, root), /10 MB/);
    await put('docs/unicode.md', '€'.repeat(Math.ceil(limit / 6)));
    await assert.rejects(preparePublishing(`${include('unicode.md')}\n${include('unicode.md')}`, document, root), /10 MB/);
  });
});

test('nested include image paths rebase exactly once to the top-level document folder', async () => {
  await fixture(async (root, document, put) => {
    const first = await put('includes/first.md', `Before ![One](assets/one.png "Keep title")\n${include('nested/second.md')}`);
    const second = await put('includes/nested/second.md', '![Two](../assets/two.png)');
    await put('includes/assets/one.png', 'image loader validates bytes separately');
    await put('includes/assets/two.png', 'image loader validates bytes separately');
    const markdown = `![root stays](missing.png)\n${include('../includes/first.md')}`;
    const result = await preparePublishing(markdown, document, root);
    assert.equal(result.markdown, [
      '![root stays](missing.png)',
      'Before ![One](../includes/assets/one.png "Keep title")',
      '![Two](../includes/assets/two.png)',
    ].join('\n'));
    assert.equal(await readFile(first, 'utf8'), `Before ![One](assets/one.png "Keep title")\n${include('nested/second.md')}`);
    assert.equal(await readFile(second, 'utf8'), '![Two](../assets/two.png)');
  });
});

test('image lexer handles spaces, escaped punctuation, angle paths, titles and multiline destinations', async () => {
  await fixture(async (root, document, put) => {
    await put('parts/assets/a file(1).png', 'asset');
    await put('parts/assets/a(1).png', 'asset');
    await put("parts/assets/unbalanced)'name.png", 'asset');
    await put('parts/part.md', [
      '![angle](<assets/a file(1).png> "Title")',
      '![escaped](assets/a\\(1\\).png)',
      "![delimiter](assets/unbalanced\\)'name.png)",
      '![invalid escaped space](assets/a\\ file\\(1\\).png)',
      '![encoded](assets/a%20file(1).png)',
      '![multiline](\n<assets/a file(1).png>\n"Title"\n)',
      '[![linked image](<assets/a file(1).png>)](ordinary-link.md)',
    ].join('\n'));
    const target = `../parts/assets/${url('a file(1).png')}`;
    const markdown = (await preparePublishing(include('../parts/part.md'), document, root)).markdown;
    assert.equal(markdown, [
      `![angle](<${target}> "Title")`, '![escaped](../parts/assets/a%281%29.png)',
      '![delimiter](../parts/assets/unbalanced%29%27name.png)',
      '![invalid escaped space](assets/a\\ file\\(1\\).png)', `![encoded](${target})`,
      `![multiline](\n<${target}>\n"Title"\n)`, `[![linked image](<${target}>)](ordinary-link.md)`,
    ].join('\n'));
  });
});

test('data URLs and ordinary prose, links, escaped images, code and comments remain byte-for-byte unchanged', async () => {
  await fixture(async (root, document, put) => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const part = [
      `![embedded](${data})`, `:::image source="${data}" alt-text="Embedded" :::`,
      'assets/missing.png is ordinary prose.', '[ordinary](missing.png)',
      '[link with image-looking destination](missing/![literal](no.png))',
      '\\![escaped](missing.png)', '`![inline](missing.png)`',
      '```md', '![fenced](missing.png)', ':::image source="missing.png" :::', '```', '',
      '    ![indented](missing.png)', '',
      '<!-- ![comment](missing.png) -->', '<!--', ':::image source="missing.png" :::', '-->',
    ].join('\n');
    await put('parts/part.md', part);
    assert.equal((await preparePublishing(include('../parts/part.md'), document, root)).markdown, part);
  });
});

test('custom :::image rebase changes only the source attribute, not similarly named alt prose', async () => {
  await fixture(async (root, document, put) => {
    await put('parts/assets/my image.png', 'asset');
    const part = [
      ':::image type="content" alt-text="source=\'not-a-file.png\'" source="assets/my%20image.png" lightbox="true" :::',
      ":::image source='assets/my image.png' alt-text='Same text assets/my image.png' :::",
      ':::image source=assets/my%20image.png :::',
    ].join('\n');
    await put('parts/part.md', part);
    const markdown = (await preparePublishing(include('../parts/part.md'), document, root)).markdown;
    assert.equal(markdown, [
      ':::image type="content" alt-text="source=\'not-a-file.png\'" source="../parts/assets/my%20image.png" lightbox="true" :::',
      ":::image source='../parts/assets/my%20image.png' alt-text='Same text assets/my image.png' :::",
      ':::image source=../parts/assets/my%20image.png :::',
    ].join('\n'));
  });
});

test('nested custom images rebase space paths after attributes with escaped quotes and backslashes', async () => {
  await fixture(async (root, document, put) => {
    const directives = [
      String.raw`:::image type="content" alt-text="A \"quoted\" image" source="asset folder/pixel image.png" :::`,
      String.raw`:::image alt-text='An \'escaped\' image' source='asset folder/pixel image.png' :::`,
      String.raw`:::image alt-text="A trailing \\" source="asset folder/pixel image.png" :::`,
      String.raw`:::image alt-text="A \\\"quoted\\\" image" source="asset folder/pixel image.png" :::`,
    ];
    const firstSource = include('nested/quoted.md');
    const first = await put('includes/first.md', firstSource);
    const secondSource = directives.join('\n');
    const second = await put('includes/nested/quoted.md', secondSource);
    await put('includes/nested/asset folder/pixel image.png', 'image loader validates bytes separately');
    const result = await preparePublishing(include('../includes/first.md'), document, root);
    assert.equal(result.markdown, directives.map(directive => directive.replace(
      'asset folder/pixel image.png', '../includes/nested/asset%20folder/pixel%20image.png',
    )).join('\n'));
    assert.deepEqual(result.includes, [await realpath(first), await realpath(second)]);
    assert.equal(await readFile(first, 'utf8'), firstSource);
    assert.equal(await readFile(second, 'utf8'), secondSource);
  });
});

test('reference images rebase the use without modifying a shared ordinary-link definition', async () => {
  await fixture(async (root, document, put) => {
    await put('parts/picture.png', 'asset');
    const part = '![First][photo]\n![photo][]\n![photo]\n[ordinary][photo]\n\n[photo]: picture.png "Shared title"\n';
    await put('parts/part.md', part);
    assert.equal((await preparePublishing(include('../parts/part.md'), document, root)).markdown,
      '![First](../parts/picture.png "Shared title")\n![photo](../parts/picture.png "Shared title")\n![photo](../parts/picture.png "Shared title")\n[ordinary][photo]\n\n[photo]: picture.png "Shared title"\n');
  });
});

test('included images require existing supported regular files inside the grant', async () => {
  await fixture(async (root, document, put) => {
    await put('parts/private.html', '<html>not an image</html>');
    await put('../private.png', 'private');
    await mkdir(path.join(root, 'parts', 'directory.png'));
    for (const [target, error] of [
      ['missing.png', /Missing or inaccessible image/],
      ['', /Unsafe image path/],
      ['private.html', /Supported image formats/],
      ['directory.png', /regular file/],
      ['../../private.png', /traverses outside/],
    ] as const) {
      await put('parts/part.md', `![Image](${target})`);
      await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), error);
      await put('parts/part.md', `:::image source="${target}" :::`);
      await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), error);
    }
  });
});

test('included images reject external/unsafe sources without performing network requests', async () => {
  await fixture(async (root, document, put) => {
    for (const target of [
      'https://example.invalid/private.png', 'http://example.invalid/private.png',
      'file:///C:/private.png', 'javascript:alert(1)', '//server/share/private.png',
      'C:\\private.png', '%2e%2e/private.png', '%252e%252e/private.png',
      'folder%2fprivate.png', 'private%00.png',
    ]) {
      await put('parts/part.md', `![Image](${target})`);
      await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), /Unsafe|relative local|forbidden/, target);
      await put('parts/part.md', `:::image source="${target}" :::`);
      await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), /Unsafe|relative local|forbidden/, target);
    }
  });
});

test('directory junctions cannot escape the root for includes or image assets', async t => {
  await fixture(async (root, document, put) => {
    await put('../outside/private.md', 'private');
    await put('../outside/private.png', 'private');
    const linked = path.join(root, 'linked');
    try { await symlink(path.resolve(root, '..', 'outside'), linked, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        t.skip('The filesystem does not permit directory symlinks/junctions.');
        return;
      }
      throw error;
    }
    await assert.rejects(preparePublishing(include('../linked/private.md'), document, root), /symlink or junction escape/);
    await put('parts/part.md', '![Image](../linked/private.png)');
    await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), /symlink or junction escape/);
    await assert.rejects(preparePublishing('', path.join(linked, 'private.md'), root), /document resolves outside/);
  });
});

test('internal directory aliases are safe and canonical aliases cannot conceal an include cycle', async t => {
  await fixture(async (root, document, put) => {
    await put('shared/part.md', 'safe');
    const linked = path.join(root, 'alias');
    try { await symlink(path.join(root, 'shared'), linked, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        t.skip('The filesystem does not permit directory symlinks/junctions.');
        return;
      }
      throw error;
    }
    assert.equal((await preparePublishing(include('../alias/part.md'), document, root)).markdown, 'safe');
    await put('shared/part.md', include('../alias/part.md'));
    await assert.rejects(preparePublishing(include('../shared/part.md'), document, root), /cycle detected/);
  });
});

test('file symlinks cannot expose non-Markdown or HTML image files', async t => {
  await fixture(async (root, document, put) => {
    const html = await put('parts/private.html', '<html>private</html>');
    try {
      await symlink(html, path.join(root, 'parts', 'fake.md'), 'file');
      await symlink(html, path.join(root, 'parts', 'fake.png'), 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        t.skip('The filesystem does not permit file symlinks.');
        return;
      }
      throw error;
    }
    await assert.rejects(preparePublishing(include('../parts/fake.md'), document, root), /resolve to a Markdown file/);
    await put('parts/part.md', '![Image](fake.png)');
    await assert.rejects(preparePublishing(include('../parts/part.md'), document, root), /Supported image formats/);
  });
});

const metadata = '---\ntitle: Pacemaker article\nzone_pivot_groups: sap-pacemaker-fencing-solution\n---\n';
const groups = [
  '### YamlMime:ZonePivotGroups', 'groups:',
  '# Unrelated pivots must not be interpreted as top-level groups.',
  '- id: unrelated', '  title: Ignore', '  pivots:',
  '  - id: sap-pacemaker-fencing-solution', '    title: Not a group',
  '- id: sap-pacemaker-fencing-solution', '  title: Fencing solution',
  '  prompt: "Choose your fencing solution:"', '  pivots:',
  '  - id: sbd', '    title: SBD fencing',
  '  - id: azure-fence-agent', "    title: 'Azure fence agent'",
  '- id: next-group', '  title: Unrelated',
].join('\n');

test('authorized local ancestor config adds a generic selector immediately after intact frontmatter', async () => {
  await fixture(async (root, document, put) => {
    const config = await put('zone-pivot-groups.yml', groups);
    const markdown = `${metadata}\n:::zone pivot="sbd"\nSBD text\n:::zone-end\n`;
    const result = await preparePublishing(markdown, document, root);
    assert.equal(result.markdown, `${metadata}\n:::selector title="Choose your fencing solution:"\n- [SBD fencing](#variant/sbd)\n- [Azure fence agent](#variant/azure-fence-agent)\n:::selector-end\n\n\n:::zone pivot="sbd"\nSBD text\n:::zone-end\n`);
    assert.deepEqual(result.includes, []);
    assert.equal(await readFile(config, 'utf8'), groups);
    assert.equal(await readFile(document, 'utf8'), 'original saved document\n');
    assert.deepEqual(await preparePublishing(markdown, document, null), { markdown, includes: [] });
  });
});

test('local variant lookup supports standard indented YAML lists, quoted IDs and safe escaped labels', async () => {
  await fixture(async (root, document, put) => {
    await put('docs/zone-pivot-groups.yml', [
      'groups:', "  - id: 'sap-pacemaker-fencing-solution'",
      '    title: "Choose \\"A\\" & <B>"', '    pivots:',
      '      - id: sbd', "        title: 'It''s [SBD] *safe*'",
      '      - id: azure-fence-agent', '        title: C# agent # local comment',
    ].join('\n'));
    const result = await preparePublishing(`${metadata}Body`, document, root);
    assert.ok(result.markdown.includes(':::selector title="Choose &quot;A&quot; &amp; &lt;B&gt;"'));
    assert.ok(result.markdown.includes("- [It's \\[SBD\\] \\*safe\\*](#variant/sbd)"));
    assert.ok(result.markdown.includes('- [C# agent](#variant/azure-fence-agent)'));
  });
});

test('missing config/group, out-of-root ancestors and unsupported YAML leave metadata unchanged', async () => {
  await fixture(async (root, document, put) => {
    const markdown = `${metadata}Body`;
    assert.deepEqual(await preparePublishing(markdown, document, root), { markdown, includes: [] });
    await put('../zone-pivot-groups.yml', groups);
    assert.equal((await preparePublishing(markdown, document, root)).markdown, markdown);
    for (const config of [
      groups.replaceAll('sap-pacemaker-fencing-solution', 'different-group'),
      groups.replace('  prompt: "Choose your fencing solution:"', '  prompt: !execute dangerous'),
      groups.replace('  prompt: "Choose your fencing solution:"', '  prompt: &prompt Anchor'),
      groups.replace('  prompt: "Choose your fencing solution:"', '  prompt: *alias'),
      groups.replace('  prompt: "Choose your fencing solution:"', '  prompt: >\n    Multiline prompt'),
      groups.replace('  - id: sbd', '  - id: ../../private'),
      groups.replace('  - id: azure-fence-agent', '  - id: sbd'),
      groups.replace('    title: SBD fencing', '    title: ["flow", "array"]'),
    ]) {
      await put('zone-pivot-groups.yml', config);
      assert.equal((await preparePublishing(markdown, document, root)).markdown, markdown);
    }
  });
});

test('variant config is strictly bounded and not read for documents without supported frontmatter metadata', async () => {
  await fixture(async (root, document, put) => {
    await put('zone-pivot-groups.yml', `${groups}\n${'#'.repeat(1024 * 1024)}`);
    const markdown = `${metadata}Body`;
    assert.equal((await preparePublishing(markdown, document, root)).markdown, markdown);
    await rm(path.join(root, 'zone-pivot-groups.yml'));
    await mkdir(path.join(root, 'zone-pivot-groups.yml'));
    assert.equal((await preparePublishing(markdown, document, root)).markdown, markdown);
    for (const source of [
      'Body without metadata', '---\nzone_pivot_groups: [flow, array]\n---\nBody',
      '---\nzone_pivot_groups: !execute\n---\nBody', '---\nzone_pivot_groups: valid\nBody without closing frontmatter',
      '---\nzone_pivot_groups: one\nzone_pivot_groups: two\n---\nBody',
    ]) {
      assert.equal((await preparePublishing(source, document, root)).markdown, source);
    }
  });
});

test('nearest matching variant config wins and existing real selectors are never duplicated', async () => {
  await fixture(async (root, document, put) => {
    await put('zone-pivot-groups.yml', groups);
    await put('docs/zone-pivot-groups.yml', groups.replace('SBD fencing', 'Nearest SBD'));
    const result = await preparePublishing(`${metadata}Body`, document, root);
    assert.ok(result.markdown.includes('[Nearest SBD]'));
    const existing = `${metadata}\n:::selector title="Existing"\n- [Mine](#variant/sbd)\n:::selector-end\n`;
    assert.equal((await preparePublishing(existing, document, root)).markdown, existing);
    const code = `${metadata}\n\`\`\`\n:::selector title="Example only"\n\`\`\`\nBody`;
    const prepared = (await preparePublishing(code, document, root)).markdown;
    assert.ok(prepared.includes(':::selector title="Choose your fencing solution:"'));
    assert.ok(prepared.includes(':::selector title="Example only"'));
  });
});

test('variant config lookup combines with includes but never reads a symlink outside the authorized grant', async t => {
  await fixture(async (root, document, put) => {
    const outside = await put('../outside/zone-pivot-groups.yml', groups);
    await put('parts/part.md', 'Included body');
    const markdown = `${metadata}${include('../parts/part.md')}`;
    try { await symlink(path.dirname(outside), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        t.skip('The filesystem does not permit directory symlinks/junctions.');
        return;
      }
      throw error;
    }
    // The configuration filename itself may also be a directory junction; it must not be read.
    await symlink(path.dirname(outside), path.join(root, 'zone-pivot-groups.yml'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(preparePublishing(markdown, document, root), /variant configuration resolves outside/);
    await rm(path.join(root, 'zone-pivot-groups.yml'));
    await put('zone-pivot-groups.yml', groups);
    const result = await preparePublishing(markdown, document, root);
    assert.ok(result.markdown.includes(':::selector title="Choose your fencing solution:"'));
    assert.ok(result.markdown.endsWith('Included body'));
    assert.equal(result.includes.length, 1);
  });
});
