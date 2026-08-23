/**
 * `epubSecurity` — the sandbox patcher, its MutationObserver, and the
 * build-environment gate on the sanitization kill-switch.
 *
 * epubSecurity.test.ts pins sanitize-at-serialize itself. This covers the
 * mechanics around it: the kill-switch must be unreachable in a production
 * build BY CONSTRUCTION (not merely unset), and the observer has to catch
 * iframes epub.js creates nested, appended, or re-sandboxed after the fact
 * — while never looping on its own writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  observeAndPatchSandbox,
  patchIframeSandbox,
  registerSanitizeHook,
  type EpubJsBookLike,
} from './epubSecurity';

const bookWith = (): { book: EpubJsBookLike; hooks: Array<(html: string) => string> } => {
  const hooks: Array<(html: string) => string> = [];
  const book = {
    spine: { hooks: { serialize: { register: (h: (html: string) => string) => hooks.push(h) } } },
  } as unknown as EpubJsBookLike;
  return { book, hooks };
};

const flushObserver = () => new Promise((r) => setTimeout(r, 0));

const containers: HTMLElement[] = [];
const makeContainer = (): HTMLElement => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  containers.push(node);
  return node;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  while (containers.length) containers.pop()?.remove();
  delete window.__VERSICLE_SANITIZATION_DISABLED__;
});

describe('registerSanitizeHook — the build-environment gate', () => {
  it('does nothing when the book exposes no serialize hook', () => {
    expect(() =>
      registerSanitizeHook({} as EpubJsBookLike, { allowTestBypass: true })
    ).not.toThrow();
    expect(() =>
      registerSanitizeHook({ spine: {} } as EpubJsBookLike, { allowTestBypass: true })
    ).not.toThrow();
  });

  it('sanitizes by default', () => {
    const { book, hooks } = bookWith();
    registerSanitizeHook(book, { allowTestBypass: true, env: { dev: false, e2e: false } });

    expect(hooks[0]('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });

  it('honours the kill-switch only when the path opts in AND the build allows it', () => {
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    const dirty = '<p onclick="alert(1)">hi</p>';

    const dev = bookWith();
    registerSanitizeHook(dev.book, { allowTestBypass: true, env: { dev: true, e2e: false } });
    expect(dev.hooks[0](dirty)).toBe(dirty);

    const e2e = bookWith();
    registerSanitizeHook(e2e.book, { allowTestBypass: true, env: { dev: false, e2e: true } });
    expect(e2e.hooks[0](dirty)).toBe(dirty);
  });

  it('is UNREACHABLE in a production build even with the flag set', () => {
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    const { book, hooks } = bookWith();

    registerSanitizeHook(book, { allowTestBypass: true, env: { dev: false, e2e: false } });

    expect(hooks[0]('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });

  it('is unreachable for a path that does NOT opt in — ingestion always sanitizes', () => {
    window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    const { book, hooks } = bookWith();

    registerSanitizeHook(book, { allowTestBypass: false, env: { dev: true, e2e: true } });

    expect(hooks[0]('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });

  it('sanitizes in a bypass-reachable build while the flag is unset', () => {
    const { book, hooks } = bookWith();

    registerSanitizeHook(book, { allowTestBypass: true, env: { dev: true, e2e: true } });

    expect(hooks[0]('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });

  it('falls back to the real build gates when no env is injected', () => {
    const { book, hooks } = bookWith();

    registerSanitizeHook(book, { allowTestBypass: true });

    expect(hooks).toHaveLength(1);
    expect(hooks[0]('<p>clean</p>')).toContain('clean');
  });
});

describe('patchIframeSandbox', () => {
  it('adds both required tokens to a bare iframe', () => {
    const iframe = document.createElement('iframe');

    patchIframeSandbox(iframe);

    const tokens = (iframe.getAttribute('sandbox') ?? '').split(' ');
    expect(tokens).toContain('allow-scripts');
    expect(tokens).toContain('allow-same-origin');
  });

  it('PRESERVES tokens the publisher already set', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-forms allow-popups');

    patchIframeSandbox(iframe);

    const tokens = (iframe.getAttribute('sandbox') ?? '').split(' ');
    expect(new Set(tokens)).toEqual(
      new Set(['allow-forms', 'allow-popups', 'allow-scripts', 'allow-same-origin'])
    );
  });

  it('never duplicates a token that is already present', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    patchIframeSandbox(iframe);

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });

  it('does NOT rewrite an already-correct attribute (observer-loop guard)', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const setAttribute = vi.spyOn(iframe, 'setAttribute');

    patchIframeSandbox(iframe);

    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('tolerates messy whitespace, including newlines and tabs', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', '  allow-forms \n\t allow-popups  ');

    patchIframeSandbox(iframe);

    const value = iframe.getAttribute('sandbox') ?? '';
    expect(value.split(' ').filter(Boolean)).toEqual([
      'allow-forms',
      'allow-popups',
      'allow-scripts',
      'allow-same-origin',
    ]);
    expect(value).not.toMatch(/\s\s/);
  });

  it('treats an empty sandbox attribute as no tokens', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', '');

    patchIframeSandbox(iframe);

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });
});

describe('observeAndPatchSandbox', () => {
  it('patches iframes that already exist, immediately', () => {
    const root = makeContainer();
    const iframe = document.createElement('iframe');
    root.appendChild(iframe);

    observeAndPatchSandbox(root);

    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('patches an iframe added DIRECTLY afterwards', async () => {
    const root = makeContainer();
    observeAndPatchSandbox(root);

    const iframe = document.createElement('iframe');
    root.appendChild(iframe);
    await flushObserver();

    expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin');
  });

  it('patches an iframe added NESTED inside a new subtree', async () => {
    const root = makeContainer();
    observeAndPatchSandbox(root);

    const wrapper = document.createElement('div');
    const iframe = document.createElement('iframe');
    wrapper.appendChild(iframe);
    root.appendChild(wrapper);
    await flushObserver();

    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('RE-patches an iframe whose sandbox was overwritten', async () => {
    const root = makeContainer();
    const iframe = document.createElement('iframe');
    root.appendChild(iframe);
    observeAndPatchSandbox(root);

    iframe.setAttribute('sandbox', 'allow-forms');
    await flushObserver();

    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).toContain('allow-forms');
  });

  it('ignores added nodes that are neither iframes nor elements', async () => {
    const root = makeContainer();
    observeAndPatchSandbox(root);

    root.appendChild(document.createTextNode('just text'));
    await flushObserver();

    expect(root.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('stops patching once disconnected', async () => {
    const root = makeContainer();

    observeAndPatchSandbox(root)();
    const iframe = document.createElement('iframe');
    root.appendChild(iframe);
    await flushObserver();

    expect(iframe.getAttribute('sandbox')).toBeNull();
  });
});
