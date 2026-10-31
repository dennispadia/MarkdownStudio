import { handleGrammarRequest, type GrammarRequest, type GrammarResponse } from '../lib/grammar.js';

const worker = self as unknown as {
  onmessage: (event: MessageEvent<GrammarRequest>) => void;
  postMessage: (response: GrammarResponse) => void;
};

worker.onmessage = async event => {
  worker.postMessage(await handleGrammarRequest(event.data));
};
