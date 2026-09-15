# gpu-lexer × OpaqueRange playground

An empty, focused textarea with a maximum content width of 80 monospace characters, plus a short title and linked explanation. Type or paste any code to see live syntax highlighting **inside the native `<textarea>`**, using [`gpu-lexer`](https://gpu-lexer.vercel.app/) and [`OpaqueRange`](https://olliewilliams.xyz/blog/opaquerange/). The centered layout keeps the explanation and editor together for screen recordings.

## Run locally

Use Node.js 22.12+ and pnpm (the lockfile was generated with pnpm 12.3.4).

```sh
pnpm install
pnpm start
```

Open the localhost URL printed by Vite (normally **http://127.0.0.1:5173**) in **Chrome 152+**, with WebGPU and graphics acceleration available.

## Build a static website

```sh
pnpm build
```

Deploy the **contents of `dist/`** to any static HTTPS host. No server runtime, API keys, external model downloads, or environment variables are needed. Vite uses relative asset URLs (`base: './'`), so deployments also work beneath a subdirectory.

To check the build locally:

```sh
pnpm preview
```

Serve the files over HTTP on localhost or over HTTPS when deployed. Opening `dist/index.html` with `file://` will not work with the module worker; ordinary remote HTTP is not a secure context for WebGPU.

## How highlighting works

1. The textarea's `input` event queues its latest value, with a 40 ms debounce.
2. A module Web Worker calls `await parse(code)` from `gpu-lexer`. The package and model weights are bundled into the worker.
3. Each returned colored span becomes `textarea.createValueRange(start, end)`, producing an `OpaqueRange`.
4. Ranges are grouped by syntax type in `Highlight` objects registered with `CSS.highlights`.
5. CSS `::highlight(syntax-keyword)` and the other palette rules color the textarea text.

The core API looks like this (the demo runs `parse` in its worker):

```ts
import { parse } from 'gpu-lexer';

const spans = await parse(textarea.value);
const keywords = new Highlight();

for (const span of spans) {
  if (span.type === 'keyword') {
    keywords.add(textarea.createValueRange(span.start, span.end));
  }
}

CSS.highlights.set('syntax-keyword', keywords);
```

```css
::highlight(syntax-keyword) {
  color: #cbb0e8;
}
```

`gpu-lexer` and the textarea range API use UTF-16 offsets, including for Unicode source. Each edit clears ranges for the old value. There is at most one GPU request in flight; additional edits collapse into the newest value, and outdated results are discarded. IME composition pauses highlighting until composition ends. Native selection, clipboard operations, scrolling, and undo remain browser-managed. Tab retains its native focus-navigation behavior.

The page starts empty on every load. There are no presets, controls, or surrounding panels. The model infers syntax from whatever you type; no language selection is needed. GPU inference starts with the first input. An error message appears only if highlighting is unavailable.

## Browser support

The supported target is **Chrome 152+ only**. Runtime checks use `createValueRange`, CSS Custom Highlights, secure-context status, and WebGPU availability instead of user-agent sniffing. Browsers with equivalent APIs may also work, but are not a supported target.

If support is missing or GPU initialization fails, the page explains the issue and keeps the textarea editable as plain text. There is no overlay, contenteditable editor, or alternative syntax-highlighting backend. Reload to retry a failed GPU initialization.

`gpu-lexer` is experimental and predicts syntax classes; it is not a grammar-based parser and may assign imperfect colors. Very large documents can exceed a device's GPU buffer limits; such failures are reported in the page.

## Verification

```sh
pnpm test
pnpm build
```

Browser tests use **installed Google Chrome 152+** via Playwright's `chrome` channel. WebGPU must be available to that browser; tests deliberately require real GPU inference and native OpaqueRanges rather than skipping them when unsupported. The test runner starts the dev server automatically.

## Project layout

- `src/main.ts`: feature checks, editor interactions, inference scheduling, OpaqueRanges.
- `src/lexer.worker.ts`: bundled GPU lexer running outside the main thread.
- `src/protocol.ts`: worker message types and syntax classes.
- `src/opaque-range.d.ts`: the new textarea API's TypeScript declaration.
- `src/style.css`: the centered layout, textarea sizing, and native highlight styles.
- `tests/playground.spec.js`: browser integration tests.

## References

- [Shu Ding's gpu-lexer announcement](https://x.com/shuding/status/2097348783415939541)
- [gpu-lexer project and live examples](https://gpu-lexer.vercel.app/)
- [Ollie Williams: highlighting text inside an input or textarea](https://olliewilliams.xyz/blog/opaquerange/)
