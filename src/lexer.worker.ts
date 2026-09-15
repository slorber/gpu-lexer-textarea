import { parse } from 'gpu-lexer';
import type { ParseRequest, ParseResponse } from './protocol';

// The model and its weights are bundled locally with this worker by Vite.
self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, code } = event.data;
  let response: ParseResponse;
  try {
    const spans = await parse(code);
    response = { id, spans };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
