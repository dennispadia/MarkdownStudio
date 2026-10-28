/// <reference lib="webworker" />
import { searchMarkdown, type SearchOptions } from '../lib/search.js';

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<{ text: string; query: string; options: SearchOptions; replacement: string }>) => {
  try { self.postMessage({ ok: true, value: searchMarkdown(event.data.text, event.data.query, event.data.options, event.data.replacement) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
