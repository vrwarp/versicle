import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';
import { extractSentencesFromNode, type ExtractionOptions, type SentenceNode } from '@lib/ingestion/sentence-extraction';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);
  let disconnectSandboxObserver: (() => void) | null = null;
  const fastTick = createZeroDelayTick();

  // SECURITY: sanitize-at-serialize via the shared epubSecurity module —
  // the SAME implementation the live reader renders through, so ingested
  // sentence CFIs are computed against the DOM the user will see. The
  // offscreen path never honors the E2E sanitization kill-switch.
  registerSanitizeHook(book as EpubJsBookLike, { allowTestBypass: false });

  try {
    await book.ready;

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

        // Extract sentences with CFIs
        const sentencesStart = performance.now();
        const { sentences, citationMarkers } = extractSentencesFromNode(body, (range) => {
          // contents.cfiFromRange returns the CFI for the range.
          // It should include the base CFI (spine index) if correctly initialized.
          return contents.cfiFromRange(range);
        }, options);
        sentencesMs += performance.now() - sentencesStart;

        // Table Capture
        const tablesStart = performance.now();
        const tables = doc.querySelectorAll('table');
        for (const table of tables) {
          try {
            const cfi = contents.cfiFromNode(table);

            const blob = await snapdom.toBlob(table, {
              type: 'webp',
              quality: 0.1,
              scale: 0.5,
              backgroundColor: '#ffffff',
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
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
