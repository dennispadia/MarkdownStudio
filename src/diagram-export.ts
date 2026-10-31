import { mermaidPNG } from './diagrams.js';

declare global {
  interface Window { lekhRenderDiagram: (source: string) => Promise<string> }
}
window.lekhRenderDiagram = mermaidPNG;
