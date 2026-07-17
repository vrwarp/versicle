/**
 * Build-time replacement for `@xmldom/xmldom` (wired via `resolve.alias` in
 * vite.config.ts — app builds only; vitest keeps the real package).
 *
 * epub.js imports xmldom in two places (`utils/core.js` parse(),
 * `section.js` render()) purely as a fallback for environments WITHOUT the
 * native `DOMParser`/`XMLSerializer` (Node, IE). The package declares no
 * `sideEffects`, so bundlers cannot tree-shake the import even though the
 * fallback branch is unreachable — costing ~158KB (minified) of parse/eval
 * in BOTH the entry chunk (via kernel/cfi → epubjs/src/epubcfi →
 * utils/core) and the TTS worker chunk, on every boot.
 *
 * In this app the fallback can never legitimately run: the main thread has
 * native DOMParser/XMLSerializer, and the TTS worker imports epubcfi only
 * for CFI string algebra (no markup parsing or section rendering). If a
 * future code path DOES reach it, these stubs throw loudly instead of
 * silently mis-parsing.
 */
const FALLBACK_ERROR =
  '@xmldom/xmldom is stubbed out in browser builds (see src/lib/xmldom-browser-stub.ts). ' +
  'A code path reached the epub.js non-native-DOM fallback, which this app never expects to run.';

export class DOMParser {
  constructor() {
    throw new Error(FALLBACK_ERROR);
  }
}

export class XMLSerializer {
  constructor() {
    throw new Error(FALLBACK_ERROR);
  }
}
