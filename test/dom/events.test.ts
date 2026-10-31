/**
 * Tests for createEventListener, createKeydownListener, createClickOutside
 */

import { testRoot } from '../support/root';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEventListener,
  createKeydownListener,
  createClickOutside,
} from '../../src/dom/events';
import { createRoot, Signal } from '../../src/reactivity';

describe('createEventListener', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  it('should attach event listener to element', () => {
    const handler = vi.fn();

    createRoot(() => {
      createEventListener(element, 'click', handler);
    });

    element.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should attach event listener to window', () => {
    const handler = vi.fn();

    createRoot(() => {
      createEventListener(window, 'resize', handler);
    });

    window.dispatchEvent(new Event('resize'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should attach event listener to document', () => {
    const handler = vi.fn();

    createRoot(() => {
      createEventListener(document, 'click', handler);
    });

    document.dispatchEvent(new MouseEvent('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should return cleanup function', () => {
    const handler = vi.fn();
    let cleanup: () => void;

    createRoot(() => {
      cleanup = createEventListener(element, 'click', handler);
    });

    element.click();
    expect(handler).toHaveBeenCalledTimes(1);

    cleanup!();

    element.click();
    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  it('should auto-cleanup when root is disposed', () => {
    const handler = vi.fn();
    let dispose: () => void;

    dispose = createRoot((d) => {
      createEventListener(element, 'click', handler);
      return d;
    }) as unknown as () => void;

    element.click();
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();

    element.click();
    expect(handler).toHaveBeenCalledTimes(1); // Still 1
  });

  it('should pass options to addEventListener', () => {
    const handler = vi.fn();
    const addSpy = vi.spyOn(element, 'addEventListener');

    createRoot(() => {
      createEventListener(element, 'click', handler, {
        passive: true,
        capture: true,
      });
    });

    expect(addSpy).toHaveBeenCalledWith('click', handler, {
      passive: true,
      capture: true,
    });
  });

  it('should handle reactive target', async () => {
    const handler = vi.fn();
    const element2 = document.createElement('div');
    document.body.appendChild(element2);

    await new Promise<void>((resolve) => {
      createRoot(() => {
        const target = new Signal<HTMLElement | null>(element);

        createEventListener(() => target.value, 'click', handler);

        // Click on first element
        queueMicrotask(() => {
          element.click();
          expect(handler).toHaveBeenCalledTimes(1);

          // Switch target
          target.value = element2;

          queueMicrotask(() => {
            // Click on first element should not trigger
            element.click();
            expect(handler).toHaveBeenCalledTimes(1);

            // Click on second element should trigger
            element2.click();
            expect(handler).toHaveBeenCalledTimes(2);

            document.body.removeChild(element2);
            resolve();
          });
        });
      });
    });
  });

  it('should handle null reactive target', async () => {
    const handler = vi.fn();

    await new Promise<void>((resolve) => {
      createRoot(() => {
        const target = new Signal<HTMLElement | null>(null);

        createEventListener(() => target.value, 'click', handler);

        queueMicrotask(() => {
          // No element, click on document shouldn't trigger
          document.dispatchEvent(new MouseEvent('click'));
          expect(handler).toHaveBeenCalledTimes(0);

          // Set target
          target.value = element;

          queueMicrotask(() => {
            element.click();
            expect(handler).toHaveBeenCalledTimes(1);
            resolve();
          });
        });
      });
    });
  });

  it('should handle custom events', () => {
    const handler = vi.fn();

    createRoot(() => {
      createEventListener(element, 'custom-event', handler);
    });

    element.dispatchEvent(new CustomEvent('custom-event', { detail: 'test' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('createKeydownListener', () => {
  it('should trigger on matching key', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 'Escape', handler);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not trigger on non-matching key', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 'Escape', handler);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('should handle array of keys', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, ['Enter', ' '], handler);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handler).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(handler).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should check ctrl modifier', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 's', handler, { ctrl: true });
    });

    // Without ctrl
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(handler).toHaveBeenCalledTimes(0);

    // With ctrl
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should check alt modifier', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 'a', handler, { alt: true });
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).toHaveBeenCalledTimes(0);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', altKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should check shift modifier', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 'Tab', handler, { shift: true });
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(handler).toHaveBeenCalledTimes(0);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should check meta modifier', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 'k', handler, { meta: true });
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(handler).toHaveBeenCalledTimes(0);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should check multiple modifiers', () => {
    const handler = vi.fn();

    createRoot(() => {
      createKeydownListener(document, 's', handler, {
        ctrl: true,
        shift: true,
      });
    });

    // Only ctrl
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(0);

    // Only shift
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', shiftKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(0);

    // Both
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('createClickOutside', () => {
  let container: HTMLDivElement;
  let target: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    target = document.createElement('div');
    outside = document.createElement('div');

    target.id = 'target';
    outside.id = 'outside';

    container.appendChild(target);
    container.appendChild(outside);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should trigger when clicking outside element', () => {
    const handler = vi.fn();

    createRoot(() => {
      createClickOutside(target, handler);
    });

    // Click outside
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not trigger when clicking inside element', () => {
    const handler = vi.fn();

    createRoot(() => {
      createClickOutside(target, handler);
    });

    // Click inside
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('should not trigger when clicking on nested element', () => {
    const handler = vi.fn();
    const nested = document.createElement('span');
    target.appendChild(nested);

    createRoot(() => {
      createClickOutside(target, handler);
    });

    // Click on nested element
    nested.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('should work with accessor function', () => {
    const handler = vi.fn();

    createRoot(() => {
      createClickOutside(() => target, handler);
    });

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle null element', () => {
    const handler = vi.fn();

    createRoot(() => {
      createClickOutside(() => null, handler);
    });

    // Should not throw, just not trigger
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('should return cleanup function', () => {
    const handler = vi.fn();
    let cleanup: () => void;

    createRoot(() => {
      cleanup = createClickOutside(target, handler);
    });

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    cleanup!();

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1); // Still 1
  });
});

describe('createClickOutside and shadow DOM', () => {
  it('counts a click inside a shadow root as inside', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = host.attachShadow({ mode: 'open' });
    const inner = root.appendChild(document.createElement('button'));
    const handler = vi.fn();
    testRoot(() => createClickOutside(inner, handler));

    inner.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true })
    );
    expect(handler).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    host.remove();
  });
});
