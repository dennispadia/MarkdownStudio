import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

test('Windows icon contains every supported resolution with valid PNG entries', async () => {
  const icon = await readFile(new URL('../assets/icon.ico', import.meta.url));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  assert.equal(icon.readUInt16LE(4), sizes.length);
  let end = 6 + sizes.length * 16;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    assert.equal(icon[entry] || 256, size);
    assert.equal(icon[entry + 1] || 256, size);
    assert.equal(icon.readUInt16LE(entry + 4), 1);
    assert.equal(icon.readUInt16LE(entry + 6), 32);
    const length = icon.readUInt32LE(entry + 8);
    const offset = icon.readUInt32LE(entry + 12);
    assert.equal(offset, end);
    const png = icon.subarray(offset, offset + length);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    end = offset + length;
    if (size === 256) assert.deepEqual(png, await readFile(new URL('../assets/icon.png', import.meta.url)));
  }
  assert.equal(end, icon.length);
  const source = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
  const rendered = new Resvg(source, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
  assert.deepEqual(await readFile(new URL('../assets/icon.png', import.meta.url)), Buffer.from(rendered), 'Generated icons match the current SVG artwork');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.build.win.icon, 'assets/icon.ico');
  assert.equal(manifest.build.win.signExecutable, false);
  assert.notEqual(manifest.build.win.signAndEditExecutable, false);
  assert.ok(manifest.build.files.includes('assets/icon.png'), 'The native window icon is shipped inside the application');
});

test('dark sidebar artwork preserves the quill and increases contrast against the Dark sidebar', async () => {
  const light = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
  const dark = await readFile(new URL('../assets/icon-dark.svg', import.meta.url), 'utf8');
  const paths = (svg: string) => Array.from(svg.matchAll(/<path d="([^"]+)"/g), match => match[1]);
  assert.equal(paths(light).length, 4);
  assert.deepEqual(paths(dark), paths(light));
  const luminance = (rgb: Uint8Array) => {
    const linear = Array.from(rgb, channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const tileLuminance = (svg: string) => {
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 240 } }).render();
    assert.equal(rendered.width, 240);
    assert.equal(rendered.height, 240);
    const offset = (40 * rendered.width + 40) * 4;
    assert.equal(rendered.pixels[offset + 3], 255);
    return luminance(rendered.pixels.subarray(offset, offset + 3));
  };
  const lightTile = tileLuminance(light);
  const darkTile = tileLuminance(dark);
  for (const panel of [new Uint8Array([1, 4, 9])]) {
    const background = luminance(panel);
    const originalContrast = (lightTile + 0.05) / (background + 0.05);
    const darkContrast = (darkTile + 0.05) / (background + 0.05);
    assert.ok(darkContrast > originalContrast);
    assert.ok(darkContrast >= 2, `The brighter tile has at least 2:1 contrast: ${darkContrast}`);
  }
});
