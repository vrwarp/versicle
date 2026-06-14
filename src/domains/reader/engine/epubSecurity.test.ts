/**
 * epubSecurity unit suite (Phase 6 §3): the ONE security module both render
 * paths consume. The critical pin is the bypass gate — the
 * `__VERSICLE_SANITIZATION_DISABLED__` kill-switch is honored ONLY when
 * (DEV || VITE_E2E) AND the caller opted in. Production builds ignore it
 * (this closed the prod-reachable bypass, prep doc Reality #10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerSanitizeHook,
  patchIframeSandbox,
  observeAndPatchSandbox,
  type EpubJsBookLike,
} from './epubSecurity';
import * as sanitizer from '@lib/sanitizer';

const sanitizeSpy = vi.spyOn(sanitizer, 'sanitizeContent');

const makeBook = () => {
  const register = vi.fn<(hook: (html: string) => string) => void>();
  const book: EpubJsBookLike = { spine: { hooks: { serialize: { register } } } };
  return { book, register };
};

const DIRTY = '<script>alert(1)</script><b>Safe</b>';

describe('registerSanitizeHook', () => {
  beforeEach(() => {
    sanitizeSpy.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__VERSICLE_SANITIZATION_DISABLED__;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__VERSICLE_SANITIZATION_DISABLED__;
  });

  it('registers a serialize hook that sanitizes content', () => {
    const { book, register } = makeBook();
    registerSanitizeHook(book, { allowTestBypass: true });
    expect(register).toHaveBeenCalledTimes(1);

    const hook = register.mock.calls[0][0];
    const result = hook(DIRTY);
    expect(sanitizeSpy).toHaveBeenCalledWith(DIRTY);
    expect(result).toContain('<b>Safe</b>');
    expect(result).not.toContain('<script>');
  });

  it('tolerates books without a serialize hook surface', () => {
    expect(() => registerSanitizeHook({}, { allowTestBypass: true })).not.toThrow();
    expect(() => registerSanitizeHook({ spine: {} }, { allowTestBypass: true })).not.toThrow();
  });

  it('honors the E2E kill-switch in DEV/E2E builds for opted-in paths (live reader)', () => {
    const { book, register } = makeBook();
    registerSanitizeHook(book, { allowTestBypass: true, env: { dev: true, e2e: false } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__VERSICLE_SANITIZATION_DISABLED__ = true;

    const hook = register.mock.calls[0][0];
    expect(hook(DIRTY)).toBe(DIRTY); // raw passthrough
    expect(sanitizeSpy).not.toHaveBeenCalled();
  });

  it('IGNORES the kill-switch in production builds even for opted-in paths (the closed bypass)', () => {
    const { book, register } = makeBook();
    registerSanitizeHook(book, { allowTestBypass: true, env: { dev: false, e2e: false } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__VERSICLE_SANITIZATION_DISABLED__ = true;

    const hook = register.mock.calls[0][0];
    const result = hook(DIRTY);
    expect(sanitizeSpy).toHaveBeenCalledWith(DIRTY);
    expect(result).not.toContain('<script>');
  });

  it('IGNORES the kill-switch for non-opted-in paths (offscreen ingestion) in every build', () => {
    const { book, register } = makeBook();
    registerSanitizeHook(book, { allowTestBypass: false, env: { dev: true, e2e: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__VERSICLE_SANITIZATION_DISABLED__ = true;

    const hook = register.mock.calls[0][0];
    expect(hook(DIRTY)).not.toContain('<script>');
    expect(sanitizeSpy).toHaveBeenCalled();
  });
});

describe('patchIframeSandbox', () => {
  it('adds allow-scripts and allow-same-origin, preserving existing tokens', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-forms');
    patchIframeSandbox(iframe);
    const tokens = (iframe.getAttribute('sandbox') || '').split(/\s+/);
    expect(tokens).toContain('allow-forms');
    expect(tokens).toContain('allow-scripts');
    expect(tokens).toContain('allow-same-origin');
  });

  it('does not rewrite the attribute when already complete (MutationObserver loop guard)', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const spy = vi.spyOn(iframe, 'setAttribute');
    patchIframeSandbox(iframe);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('observeAndPatchSandbox', () => {
  it('patches pre-existing iframes immediately', () => {
    const root = document.createElement('div');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    root.appendChild(iframe);

    const disconnect = observeAndPatchSandbox(root);
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    disconnect();
  });

  it('patches iframes added later and re-patches attribute resets', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const disconnect = observeAndPatchSandbox(root);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    root.appendChild(iframe);
    await vi.waitFor(() =>
      expect(iframe.getAttribute('sandbox')).toContain('allow-scripts'),
    );

    // epubjs resetting the attribute gets re-patched.
    iframe.setAttribute('sandbox', 'allow-forms');
    await vi.waitFor(() => {
      const tokens = (iframe.getAttribute('sandbox') || '').split(/\s+/);
      expect(tokens).toContain('allow-forms');
      expect(tokens).toContain('allow-scripts');
      expect(tokens).toContain('allow-same-origin');
    });

    disconnect();
    document.body.removeChild(root);
  });

  it('stops patching after disconnect', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const disconnect = observeAndPatchSandbox(root);
    disconnect();

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    root.appendChild(iframe);
    // Give a microtask cycle for any (wrongly) surviving observer to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');
    document.body.removeChild(root);
  });
});
