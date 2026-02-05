import DOMPurify from 'dompurify';

// Detect if we are in a browser environment with a window/DOM
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

// Safe DOMPurify instance access
// In some environments (like Workers or Node without JSDOM), the default import might be a factory function
// or an uninitialized object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safePurify = (isBrowser && (DOMPurify as any).isSupported !== false) ? DOMPurify : undefined;

// Configure DOMPurify hooks once if available
if (safePurify && typeof safePurify.addHook === 'function') {
  safePurify.addHook('afterSanitizeAttributes', (node) => {
    // Fix Reverse Tabnabbing Vulnerability
    // Ensure all links with target="_blank" have rel="noopener noreferrer"
    if ('target' in node && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }

    // Security Hardening: Prevent External CSS Injection
    // Disallow <link> tags that point to external domains
    if (node.tagName === 'LINK') {
      const href = node.getAttribute('href');
      if (href && (href.startsWith('http:') || href.startsWith('https:') || href.startsWith('//'))) {
        node.remove();
      }
    }
  });
}

/**
 * Sanitizes HTML content to prevent XSS attacks while preserving book formatting.
 * Uses DOMPurify to strip dangerous tags (scripts, objects) and attributes (event handlers).
 *
 * NOTE: If run in a non-DOM environment (e.g., Web Worker), this returns the input unchanged
 * as DOMPurify requires a DOM implementation. Ensure sanitization happens on the main thread
 * or during ingestion.
 *
 * @param html - The raw HTML string.
 * @returns The sanitized HTML string.
 */
export function sanitizeContent(html: string): string {
  if (!safePurify) return html;

  return safePurify.sanitize(html, {
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
  if (!safePurify) return text; // Fallback in worker

  // RETURN_DOM: true returns a DocumentFragment (or HTMLElement).
  // We use textContent to get the plain text, effectively stripping tags and decoding entities.
  const cleanDOM = safePurify.sanitize(text, {
    ALLOWED_TAGS: [], // Strip all tags
    FORBID_TAGS: ['style', 'script'], // Explicitly forbid to remove content of these tags
    KEEP_CONTENT: true, // Keep content of other removed tags (e.g. <b>Text</b> -> Text)
    RETURN_DOM: true,
  });
  return cleanDOM.textContent || '';
}
