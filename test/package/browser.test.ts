/**
 * The script tag builds in a real browser page: each defines its global, and
 * the full builds render and update an app. Run after `npm run build:all`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

const dist = (file: string) =>
  decodeURIComponent(new URL(`../../dist/${file}`, import.meta.url).pathname);

/** Build file, the global it defines and the build it needs loaded first */
const builds: Array<[string, string, ...string[]]> = [
  ['signy.global.js', 'Signy'],
  ['signy.global.prod.js', 'Signy'],
  ['signy.global.es2017.js', 'Signy'],
  ['signy.global.es2017.prod.js', 'Signy'],
  ['signy.global.es5.js', 'Signy'],
  ['signy.global.es5.prod.js', 'Signy'],
  ['signy.core.global.prod.js', 'Signy'],
  ['signy.web.global.prod.js', 'Signy'],
  ['signy.store.global.prod.js', 'SignyStore', 'signy.core.global.prod.js'],
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function load(
  ...files: string[]
): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><div id="app"></div>');
  for (const file of files) await page.addScriptTag({ path: dist(file) });
  return { page, errors };
}

describe('script tag builds in a browser', () => {
  it.each(builds)('%s defines %s', async (file, name, ...hosts) => {
    const { page, errors } = await load(...hosts, file);
    const keys = await page.evaluate(
      (global) =>
        Object.keys(
          (window as unknown as Record<string, object>)[global] ?? {}
        ),
      name
    );
    expect(errors).toEqual([]);
    expect(keys.length).toBeGreaterThan(2);
    await page.close();
  });

  it.each(builds.slice(0, 4))('%s renders and updates an app', async (file) => {
    const { page, errors } = await load(file);
    const text = await page.evaluate(() => {
      const { Component, Signal, html, application, flushAll } = (
        window as unknown as {
          Signy: {
            Component: new () => object;
            Signal: new <T>(value: T) => { value: T };
            html: (strings: TemplateStringsArray, ...values: unknown[]) => Node;
            application: (root: unknown) => { mount(target: string): void };
            flushAll: () => void;
          };
        }
      ).Signy;
      const count = new Signal(1);
      class Root extends Component {
        render() {
          return html`<button onClick=${() => count.value++}>
            ${() => count.value}
          </button>`;
        }
      }
      application(Root).mount('#app');
      document.querySelector('button')!.click();
      flushAll();
      return document.querySelector('button')!.textContent!.trim();
    });
    expect(errors).toEqual([]);
    expect(text).toBe('2');
    await page.close();
  });

  // The store add-on reads the runtime off window.Signy. With a copy of its
  // own, store writes notified a scheduler the app's effects never used.
  it.each([
    ['signy.core.global.js', 'signy.store.global.js'],
    ['signy.core.global.prod.js', 'signy.store.global.prod.js'],
    ['signy.web.global.js', 'signy.store.global.js'],
    ['signy.global.js', 'signy.store.global.js'],
  ])('%s with %s runs effects on store writes', async (...files) => {
    const { page, errors } = await load(...files);
    const seen = await page.evaluate(async () => {
      const { effect } = (
        window as unknown as { Signy: { effect: (fn: () => void) => void } }
      ).Signy;
      const tick = () => new Promise((resolve) => setTimeout(resolve));
      const { store: createStore } = (
        window as unknown as {
          SignyStore: {
            store: <T extends object>(
              value: T
            ) => { state: T; set(key: keyof T, value: unknown): void };
          };
        }
      ).SignyStore;
      const store = createStore({ count: 1 });
      const values: number[] = [];
      effect(() => {
        values.push(store.state.count);
      });
      await tick();
      store.set('count', 2);
      await tick();
      return values;
    });
    expect(errors).toEqual([]);
    expect(seen).toEqual([1, 2]);
    await page.close();
  });

  it('signy.store.global.js alone says what to load first', async () => {
    const { page, errors } = await load('signy.store.global.js');
    expect(errors).toEqual([
      expect.stringMatching(/^signy\.store\.global\.js needs signy\./),
    ]);
    await page.close();
  });
});
