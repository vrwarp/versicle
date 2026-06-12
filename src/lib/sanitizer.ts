import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML content to prevent XSS attacks while preserving book formatting.
 * Uses DOMPurify to strip dangerous tags (scripts, objects) and attributes (event handlers).
 *
 * @param html - The raw HTML string.
 * @returns The sanitized HTML string.
 */

/** http:, https:, or protocol-relative — anything that leaves the origin. */
const REMOTE_URL_RE = /^\s*(?:https?:|\/\/)/i;

/** Resource-loading elements whose remote references are stripped. */
const REMOTE_REF_TAGS = new Set(['IMG', 'SOURCE', 'VIDEO', 'AUDIO', 'TRACK', 'IMAGE', 'USE']);
const REMOTE_REF_ATTRS = ['src', 'srcset', 'poster', 'href', 'xlink:href'];

/** True when a srcset value contains any remote candidate URL. */
const srcsetHasRemote = (value: string): boolean =>
  value.split(',').some((candidate) => REMOTE_URL_RE.test(candidate.trim()));
// Configure DOMPurify hooks once. DOMPurify only binds its API (addHook/sanitize) when a DOM
// is present; in a Web Worker there is no `window`, so it's a no-op shell. Guard the init so
// this module can be imported in a worker (e.g. transitively via the worker engine's data-repo
// imports) — TTS
// orchestration never sanitizes HTML off the main thread.
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Fix Reverse Tabnabbing Vulnerability
    // Ensure all links with target="_blank" have rel="noopener noreferrer"
    if ('getAttribute' in node) {
      const target = node.getAttribute('target');
      if (target && target.toLowerCase() === '_blank') {
        const currentRel = node.getAttribute('rel') || '';
        const rels = new Set(currentRel.toLowerCase().split(/\s+/).filter(Boolean));
        rels.add('noopener');
        rels.add('noreferrer');
        node.setAttribute('rel', Array.from(rels).join(' '));
      }
    }

    // Security Hardening: Prevent External CSS Injection
    // Disallow <link> tags that point to external domains
    if (node.tagName === 'LINK') {
      const href = node.getAttribute('href');
      if (href && (href.startsWith('http:') || href.startsWith('https:') || href.startsWith('//'))) {
        node.remove();
      }
    }

    // Privacy hardening (Phase 8 §H, the `img-src https:` strict-flip
    // replacement): EPUB content must never trigger remote fetches —
    // a 1×1 remote image is a read-tracking beacon. Strip remote
    // references from resource-loading elements; legitimate EPUB images
    // are zip-internal and arrive as blob:/data: URLs (untouched). The
    // element itself stays, so alt text still renders as the
    // placeholder. The strict CSP (img-src 'self' data: blob:) is the
    // defense-in-depth backstop on every deploy copy.
    if ('getAttribute' in node && REMOTE_REF_TAGS.has(node.tagName.toUpperCase())) {
      for (const attr of REMOTE_REF_ATTRS) {
        const value = node.getAttribute(attr);
        if (value === null) continue;
        if (attr === 'srcset' ? srcsetHasRemote(value) : REMOTE_URL_RE.test(value)) {
          node.removeAttribute(attr);
        }
      }
    }
  });
}

export function sanitizeContent(html: string): string {
  return DOMPurify.sanitize(html, {
    // Allow standard HTML tags and attributes
    // We explicitly enable WHOLE_DOCUMENT to handle full chapter files
    WHOLE_DOCUMENT: true,

    // Ensure we don't break SVGs or MathML if present (common in EPUBs)
    ADD_TAGS: ['link', 'style', 'svg', 'path', 'g', 'circle', 'rect', 'line', 'image', 'text'],
    ADD_ATTR: ['xmlns', 'epub:type', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'target'],

    // Explicitly forbid known XSS vectors that might sneak in
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base'],
    FORBID_ATTR: ['on*', 'javascript:', 'data:', 'formaction'],

    // Ensure we return a string
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
}

/**
 * Sanitizes a string for use in metadata (Title, Author, etc.).
 * Strips ALL HTML tags to ensure plain text, and decodes HTML entities.
 *
 * @param text - The input string.
 * @returns The sanitized plain text string.
 */
export function sanitizeMetadata(text: string): string {
  if (!text) return '';
  // RETURN_DOM: true returns a DocumentFragment (or HTMLElement).
  // We use textContent to get the plain text, effectively stripping tags and decoding entities.
  const cleanDOM = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: [], // Strip all tags
    FORBID_TAGS: ['style', 'script'], // Explicitly forbid to remove content of these tags
    KEEP_CONTENT: true, // Keep content of other removed tags (e.g. <b>Text</b> -> Text)
    RETURN_DOM: true,
  });
  return cleanDOM.textContent || '';
}
