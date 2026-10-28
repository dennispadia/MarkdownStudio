import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

export async function readImage(source: string, documentPath: string | null): Promise<{ data: Buffer; mime: string }> {
  const embedded = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(source);
  if (embedded) {
    if (embedded[2].length > MAX_IMAGE_BYTES * 1.4) throw new Error('Image exceeds the 20 MB limit.');
    return { data: Buffer.from(embedded[2], 'base64'), mime: embedded[1].toLowerCase() };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source) || path.isAbsolute(source)) {
    throw new Error('Only embedded images and relative local images are supported. Insert an image from the toolbar to embed it.');
  }
  if (!documentPath) throw new Error('Save the Markdown file before using relative image paths.');
  const root = await realpath(path.dirname(documentPath));
  const file = await realpath(path.resolve(root, decodeURIComponent(source)));
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Images must be inside the Markdown file\'s folder. Use Insert image to embed an image from another folder.');
  }
  const mime = mimeTypes[path.extname(file).toLowerCase()];
  if (!mime) throw new Error('Supported image formats are PNG, JPEG, GIF, and WebP.');
  if ((await stat(file)).size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit.');
  const data = await readFile(file);
  if (data.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit.');
  return { data, mime };
}

export function imageMime(file: string): string {
  const mime = mimeTypes[path.extname(file).toLowerCase()];
  if (!mime) throw new Error('Supported image formats are PNG, JPEG, GIF, and WebP.');
  return mime;
}
