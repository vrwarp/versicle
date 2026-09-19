import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';
import { extractSentencesFromNodeAsync, type ExtractionOptions, type SentenceNode } from '@lib/ingestion/sentence-extraction';
import type { CitationMarker } from '~types/cache';
import {
  registerSanitizeHook,
  observeAndPatchSandbox,
  type EpubJsBookLike,
} from '../epubSecurity';
import type { TableImage } from '~types/cache';
import { CancellationError } from '@lib/cancellable-task-runner';
import { createLogger } from '@lib/logger';
import { measureTotal } from '@lib/perf';
import { internals } from '../epubjsInternals';
import type { Rendition } from 'epubjs';
import {
  accumulateChapterStyles,
  calculateDominantStyle,
  createZeroDelayTick,
  type StyleAccumulator,
} from './styleSampling';
import { collectSpineItems, deriveChapterTitle, shouldYieldToMainThread } from './chapterShape';

const logger = createLogger('OffscreenRenderer');

/**
 * epub.js 0.3.93 `Archive`/`Resources` internals the asset-scoping pass
 * below drives. All of it is real at runtime and undeclared upstream; these
 * structural types exist so the pass needs no `any` (epubjsInternals.ts
 * covers the RENDITION internals the live reader shares — this is the one
 * ingestion-only surface, so it stays local to the extractor).
 */
interface EpubArchiveLike {
  getText(url: string): Promise<string> | undefined;
  getBlob(url: string, mimeType?: string): Promise<Blob> | undefined;
}

interface EpubManifestItemLike {
  href: string;
  type?: string;
}

interface EpubResourcesLike {
  /** Non-HTML manifest hrefs; index-aligned with `assets`/`replacementUrls`. */
  urls: string[];
  assets: EpubManifestItemLike[];
  html: EpubManifestItemLike[];
  /**
   * Sparse by design: the spine's serialize hook rewrites `urls[i]` to
   * `replacementUrls[i]` in every section it renders, skipping the holes.
   */
  replacementUrls: (string | undefined)[];
  settings: { archive?: EpubArchiveLike; resolver?: (path: string) => string };
  replaceCss?: () => Promise<unknown>;
}

/** Manifest media types whose bytes are the import-time memory problem. */
const HEAVY_MEDIA_TYPE_PATTERN = /^(?:image|audio|video)\//i;
/** Fallback for manifests that omit `media-type`. */
const HEAVY_MEDIA_EXTENSION_PATTERN =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|svgz?|ico|mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)$/i;
/** Non-greedy so adjacent tables stay separate blocks; `(?=[\s/>])` so `<tablefoo>` never matches. */
const TABLE_BLOCK_PATTERN = /<table(?=[\s/>])[\s\S]*?<\/table\s*>/gi;

/**
 * Is this manifest entry one of the bulk media payloads — the images, audio
 * and video that make up nearly all of an illustrated EPUB's bytes?
 */
export function isHeavyMediaAsset(asset: EpubManifestItemLike): boolean {
  if (asset.type) return HEAVY_MEDIA_TYPE_PATTERN.test(asset.type);
  return HEAVY_MEDIA_EXTENSION_PATTERN.test(asset.href.replace(/[?#].*$/, ''));
}

/** Every `<table>` element's raw markup in `html`, concatenated ('' if none). */
export function tableMarkupOf(html: string): string {
  const blocks = html.match(TABLE_BLOCK_PATTERN);
  return blocks ? blocks.join('\n') : '';
}

/**
 * Does `source` (table markup, or a stylesheet's text) name the asset `href`?
 *
 * Matched on the FILE NAME rather than a resolved URL on purpose: the same
 * asset is written `../images/x.png`, `images/x.png` or `x.png` depending on
 * where the referrer sits, and percent-encoding differs between the manifest
 * and the markup. Comparing the (decoded and re-encoded) leaf name matches
 * all of those. It can only over-match — two same-named files in different
 * folders — which costs one extra inflated asset and never loses one.
 */
export function referencesAssetFile(source: string, href: string): boolean {
  const path = href.replace(/[?#].*$/, '');
  const raw = path.slice(path.lastIndexOf('/') + 1);
  if (!raw) return false;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escape: the raw form is the only candidate.
  }
  return source.includes(raw) || source.includes(decoded) || source.includes(encodeURI(decoded));
}

/**
 * Scope epub.js's asset inflation to what extraction OUTPUT depends on.
 *
 * Opening an ARCHIVED book runs `Book.replacements()` no matter what
 * `replacements` is set to, and that does a `Promise.all` over EVERY
 * non-HTML manifest entry — each one inflated to a `Uint8Array`, then a
 * `Blob`, then an object URL, all concurrently, before the first chapter
 * renders. On a 25 MB illustrated EPUB that is the whole image payload
 * resident at once (and epub.js's `Archive.destroy()` iterates its url cache
 * by KEY, so it revokes nothing and the blobs stay for the session). The
 * live reader needs those URLs; this pass extracts text and CFIs.
 *
 * `{ replacements: 'none' }` makes `Resources.replacements()` early-return
 * while `Resources.replaceCss()` still runs, so stylesheets are still served
 * as blob URLs — text, DOM shape and therefore CFIs are untouched. What it
 * DOES lose is images inside `<table>`s, and snapdom's captures of those
 * tables are persisted extraction output (`cache_table_images`). So this
 * pass puts back exactly what the output depends on:
 *
 *   - everything that is not bulk media (stylesheets, fonts, scripts, …) —
 *     a small, bounded set that decides how captured tables are typeset;
 *   - plus any image/audio/video a `<table>` anywhere in the book points at;
 *   - plus anything a STYLESHEET names, since `background-image` on a cell
 *     lands in the capture too and telling which rule hits a table would
 *     take a CSS parser. A book that drives its art from CSS therefore just
 *     keeps epub.js's old behavior — no win, never a different output.
 *
 * Inflation is sequential (never `Promise.all`) so the kept set is the peak,
 * and `replaceCss()` is re-run afterwards so stylesheet-internal `url()`s
 * (`@font-face` above all) resolve against the URLs we just created — the
 * open-time run saw an empty replacement table.
 *
 * Object URLs created here are appended to `objectUrls` for the caller to
 * revoke; epub.js's own never are.
 */
async function inflateExtractionAssets(
  resources: EpubResourcesLike,
  objectUrls: string[],
  signal?: AbortSignal,
): Promise<void> {
  const archive = resources.settings?.archive;
  const resolver = resources.settings?.resolver;
  if (!archive || !resolver || !Array.isArray(resources.urls)) return;

  const assets = resources.assets ?? [];
  const keep: number[] = [];
  /** Heavy media held back until something extraction renders asks for it. */
  const deferred = new Map<number, string>();
  const stylesheets: string[] = [];
  for (let i = 0; i < resources.urls.length; i++) {
    const href = resources.urls[i];
    const asset = assets[i] ?? { href };
    if (asset.type === 'text/css' || (!asset.type && /\.css$/i.test(href))) stylesheets.push(href);
    if (isHeavyMediaAsset(asset)) deferred.set(i, href);
    else keep.push(i);
  }

  const claimReferenced = (source: string) => {
    for (const [index, href] of deferred) {
      if (referencesAssetFile(source, href)) {
        keep.push(index);
        deferred.delete(index);
      }
    }
  };

  const readText = async (href: string): Promise<string | undefined> => {
    try {
      return await archive.getText(resolver(href));
    } catch {
      return undefined; // Unreadable entry: the render loop reports it properly.
    }
  };

  for (const href of stylesheets) {
    if (deferred.size === 0 || signal?.aborted) break;
    const css = await readText(href);
    if (css) claimReferenced(css);
  }

  for (const doc of resources.html ?? []) {
    if (deferred.size === 0 || signal?.aborted) break;
    const text = await readText(doc.href);
    const markup = text ? tableMarkupOf(text) : '';
    if (markup) claimReferenced(markup);
  }
  if (signal?.aborted) return;

  keep.sort((a, b) => a - b);
  for (const index of keep) {
    // Already inflated by the open-time replaceCss() (the stylesheets).
    if (resources.replacementUrls[index]) continue;
    try {
      const blob = await archive.getBlob(resolver(resources.urls[index]));
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      resources.replacementUrls[index] = url;
    } catch (e) {
      logger.warn(`Failed to inflate asset ${resources.urls[index]}`, e);
    }
  }

  if (typeof resources.replaceCss !== 'function') return;
  const staleCssUrls = resources.replacementUrls.slice();
  try {
    await resources.replaceCss();
  } catch (e) {
    logger.warn('replaceCss re-run failed; stylesheet url() refs stay relative', e);
    return;
  }
  resources.replacementUrls.forEach((url, index) => {
    const stale = staleCssUrls[index];
    if (stale && stale !== url && stale.startsWith('blob:')) URL.revokeObjectURL(stale);
    if (url && url !== stale && url.startsWith('blob:')) objectUrls.push(url);
  });
  logger.info(
    `Extraction assets: ${keep.length} inflated, ${deferred.size} bulk media skipped`,
  );
}

export interface ProcessedChapter {
  href: string;
  sentences: SentenceNode[];
  citationMarkers: CitationMarker[];
  textContent: string;
  title?: string;
  tables?: Omit<TableImage, 'bookId' | 'id' | 'sectionId'>[]; // sectionId is contextually known by ProcessedChapter.href
}

export interface OffscreenExtractionResult {
  chapters: ProcessedChapter[];
  baseFontSize?: number;
  baseLineHeight?: number;
}

/**
 * Extracts content from an EPUB file using an offscreen renderer.
 * This ensures that the extracted text and CFIs match exactly what the user sees during playback.
 */
export async function extractContentOffscreen(
  file: File | Blob | ArrayBuffer,
  options: ExtractionOptions = {},
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal
): Promise<OffscreenExtractionResult> {
  // 1. Create a hidden container
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    left: '-10000px',
    top: '-10000px',
    width: '1000px',
    height: '1000px',
    visibility: 'hidden',
    overflow: 'hidden' // Ensure no scrollbars appear on main page
  });
  document.body.appendChild(container);

  const results: ProcessedChapter[] = [];
  const globalStyleAccumulator: StyleAccumulator = new Map();

  // 2. Initialize ePub
  // ePub can take File, ArrayBuffer, or URL.
  // `replacements: 'none'` + inflateExtractionAssets() below replaces epub.js's
  // inflate-every-asset-at-open behavior with an output-scoped one; see that
  // function's header for what stays inflated and why.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file, { replacements: 'none' });
  let disconnectSandboxObserver: (() => void) | null = null;
  const fastTick = createZeroDelayTick();
  /** Object URLs THIS pass created (epub.js leaks its own — see Archive.destroy). */
  const ownedObjectUrls: string[] = [];

  // SECURITY: sanitize-at-serialize via the shared epubSecurity module —
  // the SAME implementation the live reader renders through, so ingested
  // sentence CFIs are computed against the DOM the user will see. The
  // offscreen path never honors the E2E sanitization kill-switch.
  registerSanitizeHook(book as EpubJsBookLike, { allowTestBypass: false });

  try {
    await book.ready;

    // `book.ready` resolves off `loaded.*` only — `book.opened` is the one
    // that waits for Book.replacements()/replaceCss(). Awaiting it here is
    // what makes the replacement table below deterministic (and, under
    // 'none', it cannot hang: replacements() early-returns and every
    // createCssFile branch resolves).
    if (book.resources) {
      await book.opened;
      const assetsStart = performance.now();
      await inflateExtractionAssets(
        book.resources as EpubResourcesLike,
        ownedObjectUrls,
        signal,
      );
      measureTotal('import:offscreen:assets', performance.now() - assetsStart);
    }

    // Create a rendition
    // flow: 'scrolled-doc' creates a single scrollable view for the chapter, avoiding columnization logic
    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'scrolled-doc',
      manager: 'default' // Display one chapter at a time
    });

    // Re-tick the display queue onto the zero-delay scheduler (see
    // createZeroDelayTick) BEFORE the first task runs, so even the initial
    // start/attach tasks skip the rAF wait. `q` is an epub.js internal —
    // absent on the unit-test rendition double, so patch conditionally.
    const renditionQueue = internals(rendition as Rendition).q;
    if (renditionQueue) renditionQueue.tick = fastTick.tick;

    // PATCH: Ensure all iframes (current and future) have allow-scripts to
    // prevent blocking in strict environments — shared epubSecurity observer
    // (epubjs might recreate the iframe when displaying new chapters; the
    // helper also patches iframes already present).
    disconnectSandboxObserver = observeAndPatchSandbox(container);

    // Access spine items (epub.js exposes `each` or `items` by version)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = collectSpineItems<any>(book.spine);

    const totalItems = items.length;
    // OPTIMIZATION: Track time to yield only when necessary to avoid artificial delays
    let lastYieldTime = performance.now();
    // Per-phase accumulators, emitted as User Timing totals after the loop.
    let displayMs = 0;
    let stylesMs = 0;
    let sentencesMs = 0;
    let sentencesYieldMs = 0;
    let tablesMs = 0;

    for (let i = 0; i < totalItems; i++) {
      // Cancellation point between chapters (Phase 7: extractBook's
      // `signal`). The finally block below releases the rendition/container.
      if (signal?.aborted) {
        throw new CancellationError('Extraction cancelled');
      }
      const item = items[i];
      const progress = Math.round((i / totalItems) * 100);
      onProgress?.(progress, `Processing chapter ${i + 1} of ${totalItems}`);

      // Render the chapter
      const displayStart = performance.now();
      await rendition.display(item.href);
      displayMs += performance.now() - displayStart;

      // Get the content document
      // We might need to wait a tick for the iframe to be fully ready if display() resolves too early
      // But usually display() resolves when the view is attached.
      // Let's verify we have contents.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any[])[0];
      const capturedTables: Omit<TableImage, 'bookId' | 'id' | 'sectionId'>[] = [];

      if (contents && contents.document && contents.document.body) {
        const doc = contents.document;
        const body = doc.body;
        const win = contents.window || doc.defaultView;

        // New logic: Accumulate styles for global evaluation
        if (win) {
          const stylesStart = performance.now();
          accumulateChapterStyles(doc, win, globalStyleAccumulator);
          stylesMs += performance.now() - stylesStart;
        }

        // Determine title
        const title = deriveChapterTitle(doc, body.textContent || '', i);

        // Extract sentences with CFIs. The async variant hands the main
        // thread back at block boundaries on the SAME 16 ms budget the
        // chapter loop uses below — a single-XHTML book used to block for
        // the whole book, since the only yield was between chapters.
        const sentencesStart = performance.now();
        // The yields are deliberate sleeps INSIDE this window, and a chained
        // zero-delay timeout is clamped once nesting passes a few levels — so
        // wall-clock here would charge extraction hundreds of ms of pure sleep
        // and make the one phase this loop optimized look like the slow one.
        // The sibling accumulators measure work that never sleeps, so the
        // yielded time is subtracted out (and reported on its own) to keep
        // `sentences` a CPU measure comparable with them.
        let yieldedMs = 0;
        const { sentences, citationMarkers } = await extractSentencesFromNodeAsync(body, (range) => {
          // contents.cfiFromRange returns the CFI for the range.
          // It should include the base CFI (spine index) if correctly initialized.
          return contents.cfiFromRange(range);
        }, options, {
          shouldYield: () => shouldYieldToMainThread(lastYieldTime, performance.now()),
          yieldFn: async () => {
            const yieldStart = performance.now();
            await new Promise((r) => setTimeout(r, 0));
            lastYieldTime = performance.now();
            yieldedMs += lastYieldTime - yieldStart;
          },
        });
        sentencesMs += performance.now() - sentencesStart - yieldedMs;
        sentencesYieldMs += yieldedMs;

        // Table Capture
        const tablesStart = performance.now();
        const tables = doc.querySelectorAll('table');
        // snapdom's caches are MODULE-GLOBAL and its default policy ('soft')
        // clears only the per-capture style maps, so a whole book's table
        // images/backgrounds/resources stayed resident for the rest of the
        // session. 'disabled' resets EVERY cache at the start of a capture
        // (`_t(options.cache)`, run first thing in the capture path), and also
        // skips installing snapdom's document-wide MutationObserver.
        //
        // But 'disabled' also empties `defaultStyle` and `baseStyle`, which
        // are keyed by TAG NAME — bounded by the HTML vocabulary, and the most
        // expensive things snapdom caches: each miss appends a fresh element
        // to a sandbox in the MAIN document and walks a full getComputedStyle.
        // Per capture, a 300-table reference book re-probes ~10 tags 300 times
        // over. So the reset runs at CHAPTER granularity: the first capture of
        // the chapter reclaims the unbounded maps, the rest reuse the tag
        // probes. Neither policy changes a capture's output — `defaultStyle`
        // and `baseStyle` are derived from tag names in the MAIN document, not
        // from the chapter, and the URL caches key on absolute URLs; only what
        // is remembered between captures changes.
        //
        // Trade-off worth knowing: snapdom's observer install is a
        // module-global latch, so the first non-'disabled' capture installs it
        // once for the tab. One observer beats re-probing every tag per table.
        let resetCachesForChapter = true;
        for (const table of tables) {
          try {
            const cfi = contents.cfiFromNode(table);
            const cache = resetCachesForChapter ? 'disabled' : 'soft';
            resetCachesForChapter = false;

            const blob = await snapdom.toBlob(table, {
              type: 'webp',
              quality: 0.1,
              scale: 0.5,
              backgroundColor: '#ffffff',
              cache,
            });

            if (blob) {
              capturedTables.push({
                cfi: cfi,
                imageBlob: blob
              });
            }
          } catch (e) {
            logger.warn('Failed to snap table', e);
          }
        }
        tablesMs += performance.now() - tablesStart;

        results.push({
          href: item.href,
          sentences,
          citationMarkers,
          textContent: body.textContent || '',
          title,
          tables: capturedTables
        });
      }

      // Yield to main thread
      // OPTIMIZATION: Instead of waiting 50ms every chapter (which adds seconds of delay for large books),
      // we only yield if we've been blocking the main thread for more than 16ms (1 frame).
      // When we do yield, we use setTimeout(0) to resume as soon as possible.
      if (shouldYieldToMainThread(lastYieldTime, performance.now())) {
        await new Promise(r => setTimeout(r, 0));
        lastYieldTime = performance.now();
      }
    }

    measureTotal('import:offscreen:display', displayMs);
    measureTotal('import:offscreen:styles', stylesMs);
    measureTotal('import:offscreen:sentences', sentencesMs);
    // Emitted alongside, not folded in: the cost of being interruptible.
    measureTotal('import:offscreen:sentences-yield', sentencesYieldMs);
    measureTotal('import:offscreen:tables', tablesMs);

    // After the for loop before finally block:
    const baseStyles = calculateDominantStyle(globalStyleAccumulator);
    if (baseStyles) {
      logger.info(`Calculated global base font size: ${baseStyles.fontSize}px`);
    }

    onProgress?.(100, 'Ingestion complete');
    return {
      chapters: results,
      baseFontSize: baseStyles?.fontSize,
      baseLineHeight: baseStyles?.lineHeight
    };

    } finally {
    // Cleanup
    fastTick.dispose();
    if (disconnectSandboxObserver) {
      disconnectSandboxObserver();
    }
    if (book) {
      await book.opened.catch(() => { });
      book.destroy();
    }
    for (const url of ownedObjectUrls) URL.revokeObjectURL(url);
    ownedObjectUrls.length = 0;
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
