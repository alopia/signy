// @vitest-environment jsdom
/**
 * The script tag builds define window.Signy.
 */

import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';
import globalBuild from '../../dist/signy.global.js?raw';
import globalProdBuild from '../../dist/signy.global.prod.js?raw';

const builds: Record<string, string> = {
  'dist/signy.global.js': globalBuild,
  [pkg.unpkg]: globalProdBuild,
};

function load(file: string): Record<string, unknown> {
  const code = builds[file]!;
  // Indirect eval runs at global scope, like a <script> tag
  (0, eval)(code);
  return (globalThis as unknown as { Signy: Record<string, unknown> }).Signy;
}

describe('global build', () => {
  it.each(['dist/signy.global.js', pkg.unpkg])('%s defines Signy', (file) => {
    const Signy = load(file);
    expect(Signy['VERSION']).toBe(pkg.version);
    expect(Signy['html']).toBeTypeOf('function');
    expect(Signy['Component']).toBeTypeOf('function');
  });

  // Lowered, each field of each effect, row and signal is a defineProperty call
  it('keeps class fields native', () => {
    expect(globalBuild).not.toContain('__publicField');
    expect(globalBuild).toMatch(/^\s+_queued = false;$/m);
  });

  it('renders an app from the production build', () => {
    const Signy = load(pkg.unpkg) as {
      Component: new () => object;
      Signal: new <T>(v: T) => { value: T };
      html: (s: TemplateStringsArray, ...v: unknown[]) => Node;
      application: (root: unknown) => { mount(t: string): void };
      flushAll: () => void;
    };
    document.body.innerHTML = '<div id="app"></div>';
    const count = new Signy.Signal(1);
    const { html } = Signy;
    class Root extends (Signy.Component as new () => { render?(): unknown }) {
      render() {
        return html`<p>${() => count.value}</p>`;
      }
    }

    Signy.application(Root).mount('#app');
    count.value = 2;
    Signy.flushAll();
    expect(document.querySelector('#app p')?.textContent).toBe('2');
  });
});
