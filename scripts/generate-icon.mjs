import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const source = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => Buffer.from(new Resvg(source, {
  fitTo: { mode: 'width', value: size },
}).render().asPng()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size;
  directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL('../assets/icon.ico', import.meta.url), Buffer.concat([directory, ...images]));
await writeFile(new URL('../assets/icon.png', import.meta.url), images.at(-1));
console.log(`Generated original application artwork: ${sizes.join(', ')} px Windows icons and 256 px PNG.`);
