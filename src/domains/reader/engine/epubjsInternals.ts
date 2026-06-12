/**
 * Typed epub.js INTERNALS for the reader engine — Phase 6 §8
 * (prep/phase6-reader-engine.md), the Phase 1 audit's "typed refactor task"
 * (prep/phase1-deletions.md §1.23).
 *
 * The legacy `src/types/epubjs.d.ts` was an ambient `declare module 'epubjs'`
 * that SHADOWED the package's shipped types (`epubjs/types/*`), so every
 * epubjs import in the tree type-checked against a hand-rolled 136-line
 * approximation. It is deleted in the same commit that adds this file;
 * imports now resolve to the real upstream 0.3.93 declarations.
 *
 * DECISION RECORD (the doc's §8.5 fallback, taken deliberately): the doc's
 * preferred mechanism — module augmentation over `epubjs/types/*` — is
 * structurally impossible here. Upstream declares every surface as an
 * `export default class` (Rendition, Book, Section, View, …), and TypeScript
 * cannot declaration-merge new members into a DEFAULT export via module
 * augmentation (only named exports can be augmented; under `skipLibCheck`
 * the attempt even fails silently). So the genuinely untyped internals from
 * the §2a API table are typed HERE as intersection types over the upstream
 * declarations, consumed only inside `domains/reader/engine/` (the sole
 * runtime epubjs importer, boundary rule 8). Everything else the doc lists
 * (rendition.location, flow/spread/resize, on('keydown', …),
 * hooks.content.register, book.spine.hooks.serialize, contents.cfiFromRange,
 * annotations' className/styles args) IS declared upstream — verified
 * against node_modules/epubjs/types at 0.3.93.
 *
 * Kept alongside: `src/types/epubjs-epubcfi.d.ts` (7 lines, maps the
 * worker-safe `epubjs/src/epubcfi` runtime submodule; analysis and audit
 * concur it stays).
 */
import type { Book, Contents, Rendition } from 'epubjs';
import type Section from 'epubjs/types/section';
import type View from 'epubjs/types/managers/view';

/**
 * The live view manager (epub.js `DefaultViewManager`) — an undeclared
 * runtime property of Rendition. The engine reaches in for the overlay
 * container (geometry portals) and the per-view Contents list.
 */
export interface RenditionManager {
  container: HTMLElement;
  getContents(): Contents[];
}

/** A rendered view with the annotations SVG pane epub.js attaches to it. */
export type ViewWithPane = View & {
  pane?: { element: SVGElement };
};

/**
 * Rendition plus its untyped internals. Upstream types `getContents()` as a
 * single `Contents`, but the default manager returns an ARRAY at runtime —
 * the override below documents the real shape once instead of casting at
 * every call site.
 */
export type RenditionInternals = Omit<Rendition, 'getContents' | 'views'> & {
  manager?: RenditionManager;
  getContents(): Contents[];
  views(): ViewWithPane[];
};

/**
 * Spine section plus the human-readable `label` epub.js copies from the
 * navigation onto spine items during unpack (present at runtime, undeclared
 * upstream).
 */
export type SpineSection = Section & {
  label?: string;
};

/** Book whose spine.get() returns the label-carrying section. */
export type BookInternals = Omit<Book, 'spine'> & {
  spine: Omit<Book['spine'], 'get'> & {
    get(target?: string | number): SpineSection;
    items?: SpineSection[];
  };
};

/** The one sanctioned widening from the public epubjs surface. */
export function internals(rendition: Rendition): RenditionInternals {
  return rendition as unknown as RenditionInternals;
}

export function bookInternals(book: Book): BookInternals {
  return book as unknown as BookInternals;
}
