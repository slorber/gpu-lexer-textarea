import { test, expect } from '@playwright/test';

async function ready(page) {
  await expect(page.locator('#code')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
}

async function ranges(page) {
  return page.evaluate(() => [...CSS.highlights].flatMap(([name, highlight]) =>
    [...highlight].map(range => ({ name, kind: range.constructor.name, start: range.startOffset, end: range.endOffset })),
  ));
}

test('real GPU results paint native OpaqueRanges and editing remains live', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#code')).toHaveValue('');
  await expect(page.locator('#code')).toBeFocused();
  expect(await ranges(page)).toEqual([]);
  await expect(page.locator('button, select, aside')).toHaveCount(0);
  await page.keyboard.type('const first = 42;', { delay: 50 });
  await ready(page);
  expect((await ranges(page)).length).toBeGreaterThan(0);
  expect((await ranges(page)).every(range => range.kind === 'OpaqueRange')).toBe(true);
  await expect(page.locator('textarea')).toHaveCount(1);
  await expect(page.locator('[contenteditable], pre')).toHaveCount(0);

  // Astral characters before subsequent syntax exercise UTF-16 offsets.
  const source = '// 👋 café 日本語\nconst greeting = "Hello 🌍";\nconst answer = 42;\n';
  await page.locator('#code').fill(source);
  await ready(page);
  const actual = await ranges(page);
  expect(actual.length).toBeGreaterThan(0);
  expect(actual.every(range => range.start >= 0 && range.end <= source.length && range.end > range.start)).toBe(true);
  expect(actual.some(range => range.name === 'syntax-number' && source.slice(range.start, range.end).includes('42'))).toBe(true);

  // Multiple edits during an inference must converge to the latest value.
  await page.evaluate(() => {
    const code = document.querySelector('#code');
    for (let i = 0; i < 30; i++) {
      code.value = `const value${i} = ${i};`;
      code.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await ready(page);
  await expect(page.locator('#code')).toHaveValue('const value29 = 29;');
  expect((await ranges(page)).every(range => range.end <= 'const value29 = 29;'.length)).toBe(true);

  await page.locator('#code').fill('');
  await ready(page);
  expect(await ranges(page)).toEqual([]);
  await page.keyboard.type('print(123)');
  await ready(page);
  expect((await ranges(page)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('selection, IME, scrolling and native undo', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#code').fill('const greeting = \"hello\";');
  await ready(page);
  await page.locator('#code').focus();
  await page.locator('#code').evaluate(code => code.setSelectionRange(code.value.length, code.value.length));
  const before = await page.locator('#code').inputValue();
  await page.keyboard.type('x');
  await ready(page);
  await page.locator('#code').press('ControlOrMeta+z');
  await ready(page);
  await expect(page.locator('#code')).toHaveValue(before);

  await page.evaluate(() => {
    const code = document.querySelector('#code');
    code.dispatchEvent(new CompositionEvent('compositionstart'));
    code.value = 'const 日本語 = "こんにちは 🌍";';
    code.dispatchEvent(new InputEvent('input', { isComposing: true }));
  });
  // Composition retains the existing highlights until a fresh result arrives.
  expect((await ranges(page)).length).toBeGreaterThan(0);
  await page.locator('#code').dispatchEvent('compositionend');
  await ready(page);
  expect((await ranges(page)).length).toBeGreaterThan(0);

  await page.locator('#code').fill('const value = 1;\n'.repeat(100));
  await ready(page);
  await page.evaluate(() => {
    const code = document.querySelector('#code');
    code.scrollTop = 80;
    code.dispatchEvent(new Event('scroll'));
    code.setSelectionRange(3, 9);
  });
  expect(await page.locator('#code').evaluate(code => code.selectionEnd - code.selectionStart)).toBe(6);
  expect(await page.locator('#code').evaluate(code => code.scrollTop)).toBeGreaterThan(0);
});

test('unsupported OpaqueRange leaves an editable textarea and useful message', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'createValueRange', { value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('#notice')).toContainText('Chrome 152+');
  await page.locator('#code').fill('Still editable');
  await expect(page.locator('#code')).toHaveValue('Still editable');
});

test('unavailable WebGPU is explained', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.gpu; });
  await page.goto('/');
  await expect(page.locator('#notice')).toContainText('WebGPU is unavailable');
  await expect(page.locator('#code')).toHaveAttribute('data-state', 'error');
});

test('mobile layout stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('#code')).toBeVisible();
});

test('an in-flight stale response is discarded and queued edits are coalesced', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() { window.controlledWorker = this; this.requests = []; }
      postMessage(request) { this.requests.push(request); }
      terminate() {}
      reply(index, spans) {
        this.onmessage({ data: { id: this.requests[index].id, spans } });
      }
    };
  });
  await page.goto('/');
  expect(await page.evaluate(() => window.controlledWorker.requests.length)).toBe(0);
  await page.locator('#code').fill('const original = 1;');
  await expect.poll(() => page.evaluate(() => window.controlledWorker.requests.length)).toBe(1);
  await page.locator('#code').fill('const interim = 100;');
  await page.locator('#code').fill('const final = 7;');
  // Resolving the older, longer document must not create out-of-bounds ranges.
  await page.evaluate(() => window.controlledWorker.reply(0, [{ type: 'string', start: 200, end: 400 }]));
  await expect.poll(() => page.evaluate(() => window.controlledWorker.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.controlledWorker.requests[1].code)).toBe('const final = 7;');
  expect(await ranges(page)).toEqual([]);
  await page.evaluate(() => window.controlledWorker.reply(1, [{ type: 'keyword', start: 0, end: 5 }]));
  await ready(page);
  expect(await ranges(page)).toEqual([{ name: 'syntax-keyword', kind: 'OpaqueRange', start: 0, end: 5 }]);
  await expect(page.locator('#notice')).toBeHidden();
});

test('worker failures are reported and leave editing available', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage(request) {
        queueMicrotask(() => this.onmessage({ data: { id: request.id, error: 'WebGPU unavailable' } }));
      }
      terminate() {}
    };
  });
  await page.goto('/');
  await page.locator('#code').fill('const trigger = 1;');
  await expect(page.locator('#notice')).toContainText('gpu-lexer could not start or run');
  await page.locator('#code').fill('Editable after GPU failure');
  await expect(page.locator('#code')).toHaveValue('Editable after GPU failure');
});

test('live ranges remain visible during edits and composition while inference is pending', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() { window.controlledWorker = this; this.requests = []; }
      postMessage(request) { this.requests.push(request); }
      terminate() {}
      reply(index, spans) { this.onmessage({ data: { id: this.requests[index].id, spans } }); }
    };
  });
  await page.goto('/');
  await page.locator('#code').fill('const message = "hello";');
  await expect.poll(() => page.evaluate(() => window.controlledWorker.requests.length)).toBe(1);
  await page.evaluate(() => {
    window.controlledWorker.reply(0, [
      { type: 'keyword', start: 0, end: 5 },
      { type: 'string', start: 16, end: 23 },
    ]);
    window.originalKeywordRange = [...CSS.highlights.get('syntax-keyword')][0];
    document.querySelector('#code').setSelectionRange(0, 0);
  });
  await ready(page);
  // Hold all subsequent GPU responses, so a fast inference cannot mask a flicker.
  await page.keyboard.insertText('  ');
  await expect.poll(() => page.evaluate(() => window.controlledWorker.requests.length)).toBe(2);
  expect(await ranges(page)).toEqual([
    { name: 'syntax-string', kind: 'OpaqueRange', start: 18, end: 25 },
    // Insertion exactly at the start is included in Chrome's live range.
    { name: 'syntax-keyword', kind: 'OpaqueRange', start: 0, end: 7 },
  ]);
  expect(await page.evaluate(() => [...CSS.highlights.get('syntax-keyword')][0] === window.originalKeywordRange)).toBe(true);

  await page.locator('#code').press('Backspace');
  expect((await ranges(page)).find(range => range.name === 'syntax-keyword')).toMatchObject({ start: 0, end: 6 });
  await page.locator('#code').dispatchEvent('compositionstart');
  await page.keyboard.insertText('日');
  expect((await ranges(page)).find(range => range.name === 'syntax-keyword')).toMatchObject({ start: 0, end: 7 });
  await page.locator('#code').dispatchEvent('compositionend');

  // This response predates the deletion and composition and must be discarded.
  await page.evaluate(() => window.controlledWorker.reply(1, [{ type: 'number', start: 0, end: 1 }]));
  await expect.poll(() => page.evaluate(() => window.controlledWorker.requests.length)).toBe(3);
  expect((await ranges(page)).some(range => range.name === 'syntax-number')).toBe(false);
  expect(await page.evaluate(() => [...CSS.highlights.get('syntax-keyword')][0] === window.originalKeywordRange)).toBe(true);
  await page.evaluate(() => window.controlledWorker.reply(2, [
    { type: 'keyword', start: 2, end: 7 },
    { type: 'string', start: 18, end: 25 },
  ]));
  await ready(page);
  expect(await page.evaluate(() => [...CSS.highlights.get('syntax-keyword')][0] === window.originalKeywordRange)).toBe(false);
  expect((await ranges(page)).length).toBe(2);

  await page.locator('#code').fill('');
  expect(await ranges(page)).toEqual([]);
});
