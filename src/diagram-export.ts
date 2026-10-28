import { mermaidPNG } from './diagrams.js';

declare global {
  interface Window { studioRenderDiagram: (source: string) => Promise<string> }
}
window.studioRenderDiagram = mermaidPNG;
