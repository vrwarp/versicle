/**
 * epubSecurity — the ONE security module for BOTH epub.js render paths
 * (contract C7/C8 boundary): the live reader (useEpubReader) and the
 * offscreen ingestion renderer (engine/offscreen/offscreen-renderer) share
 * the sanitize-at-serialize hook and the iframe-sandbox MutationObserver
 * patch. One implementation makes the CFI-agreement invariant ("ingested
 * sentence CFIs must resolve against the live DOM") structural: the two
 * pipelines cannot drift on what HTML they sanitize or how the iframe is
 * sandboxed.
 *
 * The `__VERSICLE_SANITIZATION_DISABLED__` E2E kill-switch is honored ONLY
 * when (import.meta.env.DEV || VITE_E2E) AND the caller opts in
 * (`allowTestBypass: true` — the live reader). Production builds ignore the
 * flag entirely (pinned by epubSecurity.test.ts). The offscreen path passes
 * `false`: ingestion always sanitizes.
 */
import { sanitizeContent } from '@lib/sanitizer';
import { isSanitizationDisabled } from '../../../test-flags';

/** Structural slice of an epub.js Book that carries the serialize hook. */
export interface EpubJsBookLike {
  spine?: {
    hooks?: {
      serialize?: {
        register(hook: (html: string) => string): void;
      };
    };
  };
}

/** Build-environment gate, injectable for tests (prod path is untestable otherwise). */
interface SecurityEnv {
  dev: boolean;
  e2e: boolean;
}

const buildEnv = (): SecurityEnv => ({
  dev: import.meta.env.DEV,
  e2e: import.meta.env.VITE_E2E === 'true',
});

export interface RegisterSanitizeHookOptions {
  /**
   * Whether THIS render path may honor `__VERSICLE_SANITIZATION_DISABLED__`
   * (and only in DEV/VITE_E2E builds). Live reader: true. Offscreen
   * ingestion: false — ingestion always sanitizes.
   */
  allowTestBypass: boolean;
  /** Test seam; defaults to the real import.meta.env gates. */
  env?: SecurityEnv;
}

/**
 * Registers the XSS sanitize-at-serialize hook on an epub.js Book.
 * Every byte of EPUB HTML passes through `sanitizeContent` before epub.js
 * renders it (the sanitize-at-serialize boundary).
 */
export function registerSanitizeHook(
  book: EpubJsBookLike,
  opts: RegisterSanitizeHookOptions,
): void {
  const serialize = book.spine?.hooks?.serialize;
  if (!serialize) return;

  const env = opts.env ?? buildEnv();
  const bypassReachable = opts.allowTestBypass && (env.dev || env.e2e);

  serialize.register((html: string) => {
    // E2E performance kill-switch — DEV/VITE_E2E builds only, opted-in
    // paths only. Unreachable in production by construction.
    if (bypassReachable && isSanitizationDisabled()) {
      return html;
    }
    return sanitizeContent(html);
  });
}

/**
 * Patches an iframe's sandbox attribute to ensure allow-scripts and
 * allow-same-origin are present. Required for event handling in strict
 * environments like WebKit.
 */
export function patchIframeSandbox(iframe: HTMLIFrameElement): void {
  const sandbox = iframe.getAttribute('sandbox') || '';
  const tokens = new Set(sandbox.split(/\s+/).filter(Boolean));

  tokens.add('allow-scripts');
  tokens.add('allow-same-origin');

  const newValue = Array.from(tokens).join(' ');
  // Only set if different to avoid infinite MutationObserver loops
  if (newValue !== sandbox) {
    iframe.setAttribute('sandbox', newValue);
  }
}

/**
 * Watches a container for iframes (epub.js recreates them per section) and
 * keeps their sandbox attributes patched; also patches any iframes already
 * present. Returns the disconnect function.
 */
export function observeAndPatchSandbox(root: HTMLElement): () => void {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          const element = node as HTMLElement;
          if (element.tagName === 'IFRAME') {
            patchIframeSandbox(element as HTMLIFrameElement);
          } else if (element.querySelectorAll) {
            element.querySelectorAll('iframe').forEach(patchIframeSandbox);
          }
        });
      } else if (mutation.type === 'attributes' && mutation.target.nodeName === 'IFRAME') {
        patchIframeSandbox(mutation.target as HTMLIFrameElement);
      }
    });
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['sandbox'],
  });

  // Patch immediately for iframes that already exist.
  root.querySelectorAll('iframe').forEach(patchIframeSandbox);

  return () => observer.disconnect();
}
