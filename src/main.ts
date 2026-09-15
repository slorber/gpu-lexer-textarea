import './style.css';
import { syntaxTypes, type ColoredSyntax, type ParseRequest, type ParseResponse, type SyntaxSpan } from './protocol';

const textarea = document.querySelector<HTMLTextAreaElement>('#code')!;
const notice = document.querySelector<HTMLParagraphElement>('#notice')!;
const highlights = new Map<ColoredSyntax, Highlight>();

let worker: Worker | undefined;
let revision = 0;
let inFlight: ParseRequest | undefined;
let dirty = false;
let composing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;

function clearHighlights() {
  for (const highlight of highlights.values()) highlight.clear();
}

function fail(message: string) {
  clearTimeout(timeout);
  clearTimeout(timer);
  worker?.terminate();
  worker = undefined;
  inFlight = undefined;
  dirty = false;
  clearHighlights();
  textarea.dataset.state = 'error';
  notice.textContent = message;
  notice.hidden = false;
}

function paint(spans: SyntaxSpan[]) {
  clearHighlights();
  for (const { type, start, end } of spans) {
    if (type === 'plain') continue;
    // Both APIs use UTF-16 code-unit offsets, including for Unicode source.
    const highlight = highlights.get(type);
    if (!highlight || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > textarea.value.length) {
      throw new Error('The lexer returned an invalid syntax span.');
    }
    highlight.add(textarea.createValueRange(start, end));
  }
}

function dispatch() {
  clearTimeout(timer);
  if (!worker || composing || inFlight || !dirty) return;
  dirty = false;
  const code = textarea.value;
  if (!code) {
    clearHighlights();
    textarea.dataset.state = 'ready';
    return;
  }
  // One in-flight job; edits during inference collapse into the newest value.
  inFlight = { id: revision, code };
  worker.postMessage(inFlight);
  timeout = setTimeout(() => fail('The GPU did not respond within 30 seconds. Reload to retry, and check that Chrome graphics acceleration is enabled.'), 30_000);
}

function schedule() {
  revision++;
  dirty = true;
  clearTimeout(timer);
  // OpaqueRanges refer to a value snapshot; clear them when the value changes.
  clearHighlights();
  if (worker && !composing) {
    textarea.dataset.state = 'loading';
    timer = setTimeout(dispatch, 40);
  }
}

textarea.addEventListener('input', schedule);
textarea.addEventListener('compositionstart', () => { composing = true; revision++; clearHighlights(); });
textarea.addEventListener('compositionend', () => { composing = false; schedule(); });

if (!window.isSecureContext) {
  fail('Open this demo on localhost or HTTPS. WebGPU requires a secure context.');
} else if (typeof textarea.createValueRange !== 'function' || typeof Highlight === 'undefined' || !CSS.highlights) {
  fail('This demo needs Chrome 152+ with OpaqueRange and CSS Custom Highlights. You can still edit the plain text here.');
} else if (!('gpu' in navigator)) {
  fail('WebGPU is unavailable. Use Chrome 152+ with graphics acceleration enabled and a supported GPU, then reload.');
} else {
  try {
    for (const type of syntaxTypes) {
      const highlight = new Highlight();
      highlights.set(type, highlight);
      CSS.highlights.set(`syntax-${type}`, highlight);
    }
    worker = new Worker(new URL('./lexer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      const result = event.data;
      if (!inFlight || result.id !== inFlight.id) return;
      clearTimeout(timeout);
      const request = inFlight;
      inFlight = undefined;
      if ('error' in result) {
        fail(`gpu-lexer could not start or run: ${result.error}. Check Chrome graphics acceleration and reload to retry.`);
        return;
      }
      // Never paint an old GPU result onto a newer value or an IME composition.
      if (result.id === revision && request.code === textarea.value && !composing) {
        try {
          paint(result.spans);
          textarea.dataset.state = 'ready';
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      dispatch();
    };
    worker.onerror = () => fail('The lexer worker failed to load or run. Reload to retry and check the browser console.');
    worker.onmessageerror = () => fail('The lexer worker returned an unreadable response. Reload to retry.');
    // The textarea starts empty. GPU inference begins with the user's first input.
    textarea.dataset.state = 'ready';
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    clearTimeout(timer);
    clearTimeout(timeout);
    for (const type of syntaxTypes) CSS.highlights?.delete(`syntax-${type}`);
  });
}
