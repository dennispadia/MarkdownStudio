import { diagramLimits, prepareMermaid, type MermaidAsset } from '../lib/diagrams.js';
import { parser } from '../lib/markdown.js';
import { isMermaidLanguage } from '../lib/diagrams.js';

let engine: Promise<typeof import('mermaid')['default']> | undefined;
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();
const generations = new WeakMap<HTMLElement, number>();

async function mermaidEngine() {
  engine ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      maxTextSize: diagramLimits.sourceLength, maxEdges: 200,
      htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: false },
      journey: { textPlacement: 'tspan' },
      theme: 'default', deterministicIds: true,
      secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'secure'],
    });
    return mermaid;
  });
  return engine;
}

function safeSVG(markup: string): SVGSVGElement {
  if (markup.length > 2_000_000) throw new Error('Rendered Mermaid diagram is too large.');
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Mermaid returned an invalid SVG.');
  const allowed = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'marker', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'style', 'clipPath', 'filter', 'feDropShadow', 'feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feBlend']);
  const safeCSS = (value: string) => !/@import|expression\s*\(|(?:https?|file|data|javascript|vbscript):|\\\\|<\/style/i.test(value)
    && [...value.matchAll(/url\s*\(([^)]*)\)/gi)].every(match => /^["']?#[\w:.-]+["']?$/.test(match[1].trim()));
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg' || !allowed.has(element.localName)) throw new Error(`Unsafe Mermaid SVG element: ${element.localName}.`);
    if (element.localName === 'style' && !safeCSS(element.textContent ?? '')) throw new Error('Unsafe Mermaid SVG styles.');
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'xmlns' && attribute.value === 'http://www.w3.org/2000/svg') continue;
      if (attribute.name === 'xmlns:xlink' && attribute.value === 'http://www.w3.org/1999/xlink') { element.removeAttribute(attribute.name); continue; }
      if (element.localName === 'use' && attribute.localName === 'href' && /^#[\w:.-]+$/.test(attribute.value)) continue;
      if (/^on/i.test(attribute.name) || /(?:href|src)$/i.test(attribute.localName)) throw new Error('Mermaid SVG links and resources are disabled.');
      if (!safeCSS(attribute.value)) throw new Error('Unsafe Mermaid SVG resource.');
    }
  }
  const imported = document.importNode(svg, true);
  if (!(imported instanceof SVGSVGElement)) throw new Error('Mermaid returned an invalid SVG root.');
  return imported;
}

/** Serialized because Mermaid has global configuration and temporary layout DOM. */
export function renderMermaidSVG(source: string, active: () => boolean = () => true): Promise<SVGSVGElement> {
  const job = queue.then(async () => {
    if (!active()) throw new Error('Diagram render was superseded.');
    const clean = prepareMermaid(source);
    const mermaid = await mermaidEngine();
    if (!active()) throw new Error('Diagram render was superseded.');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    document.body.append(host);
    try {
      const { svg } = await mermaid.render(`lekh-mermaid-${++sequence}`, clean, host);
      const result = safeSVG(svg);
      result.style.maxWidth = '100%';
      result.style.height = 'auto';
      result.setAttribute('role', 'img');
      result.setAttribute('aria-label', 'Mermaid diagram');
      return result;
    } finally { host.remove(); }
  });
  queue = job.catch(() => {});
  return job;
}

function errorPanel(error: unknown): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mermaid-error';
  panel.setAttribute('role', 'alert');
  panel.style.cssText = 'white-space:pre-wrap;padding:12px;border:1px solid #b42318;border-radius:6px;color:#b42318';
  panel.textContent = `Mermaid diagram could not be rendered: ${error instanceof Error ? error.message.slice(0, 500) : 'Invalid diagram.'}`;
  return panel;
}

/** Keeps the editable source untouched; each preview is a non-editable sibling. */
export async function renderMermaidBlocks(root: HTMLElement, showSource = false): Promise<void> {
  const generation = (generations.get(root) ?? 0) + 1;
  generations.set(root, generation);
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code')]
    .filter(code => [...code.classList].some(name => /^language-mermaid$/i.test(name)));
  await Promise.all(blocks.map(async (code, index) => {
    const pre = code.parentElement!;
    const source = code.textContent ?? '';
    let panel = pre.nextElementSibling;
    if (!(panel instanceof HTMLElement) || !panel.classList.contains('mermaid-preview')) {
      panel = document.createElement('div');
      panel.className = 'mermaid-preview';
      panel.setAttribute('contenteditable', 'false');
      pre.after(panel);
    }
    const target = panel as HTMLElement;
    const current = () => generations.get(root) === generation && root.contains(code) && code.textContent === source && pre.nextElementSibling === target;
    try {
      if (index >= diagramLimits.diagrams) throw new Error('A preview supports at most 32 Mermaid diagrams.');
      // Avoid queueing obsolete layouts during rapid editor updates.
      if (!current()) return;
      const svg = await renderMermaidSVG(source, current);
      if (current()) {
        // An SVG image is inert: diagram styles cannot affect the editor document.
        const image = document.createElement('img');
        image.alt = 'Mermaid diagram';
        image.style.cssText = 'max-width:100%;height:auto';
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await image.decode();
        if (current()) { target.replaceChildren(image); pre.hidden = !showSource; }
      }
    } catch (error) {
      if (current()) { target.replaceChildren(errorPanel(error)); pre.hidden = false; }
    }
  }));
}

export async function mermaidPNG(source: string): Promise<string> {
  const svg = await renderMermaidSVG(source);
  const viewBox = svg.viewBox.baseVal;
  const width = Math.ceil(viewBox.width || parseFloat(svg.getAttribute('width') ?? '') || 800);
  const height = Math.ceil(viewBox.height || parseFloat(svg.getAttribute('height') ?? '') || 600);
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 8_000_000) {
    throw new Error('Mermaid diagram exceeds the export image dimensions.');
  }
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Diagram image conversion is unavailable.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  const png = canvas.toDataURL('image/png');
  if (png.length > diagramLimits.pngBytes * 4 / 3 + 32) throw new Error('Mermaid export image is too large.');
  return png;
}

/** Assets are keyed by exact, original fence content; never trust a document-supplied path. */
export async function collectMermaidAssets(markdown: string): Promise<MermaidAsset[]> {
  const fences = parser.parse(markdown, {}).filter(token => token.type === 'fence' && isMermaidLanguage(token.info));
  if (fences.length > diagramLimits.diagrams) throw new Error('An export supports at most 32 Mermaid diagrams.');
  const assets: MermaidAsset[] = [];
  for (const source of new Set(fences.map(token => token.content))) assets.push({ source, png: await mermaidPNG(source) });
  return assets;
}
