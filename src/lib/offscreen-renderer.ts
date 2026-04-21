import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';
import { extractSentencesFromNode, type ExtractionOptions, type SentenceNode } from './tts';
import { sanitizeContent } from './sanitizer';
import type { TableImage } from '../types/db';
import { createLogger } from './logger';

const logger = createLogger('OffscreenRenderer');

export interface ProcessedChapter {
  href: string;
  sentences: SentenceNode[];
  textContent: string;
  title?: string;
  tables?: Omit<TableImage, 'bookId' | 'id' | 'sectionId'>[]; // sectionId is contextually known by ProcessedChapter.href
}

export interface OffscreenExtractionResult {
  chapters: ProcessedChapter[];
  baseFontSize?: number;
  baseLineHeight?: number;
}

type StyleAccumulator = Map<number, { count: number; charCount: number; totalLineHeight: number }>;

function getCanvasLineHeight(element: HTMLElement, win: Window = window) {
    const computedStyle = win.getComputedStyle(element);
    
    if (computedStyle.lineHeight !== "normal") {
        return parseFloat(computedStyle.lineHeight);
    }

    // Create an off-screen canvas
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return 0;
    
    // Reconstruct the exact font string (e.g., "400 16px Times")
    context.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    
    // Measure a standard character
    const metrics = context.measureText("M");
    
    // Calculate total pixel height based on font bounding box
    // Note: fontBoundingBox is supported in all modern browsers
    const actualLineHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    
    return actualLineHeight;
}

function getActualInkHeight(element: HTMLElement, textToMeasure = "M", win: Window = window) {
    const computedStyle = win.getComputedStyle(element);
    
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return 0;
    
    // Set the canvas font to match the element exactly
    context.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    
    // Measure the exact text
    const metrics = context.measureText(textToMeasure);
    
    // actualBoundingBoxAscent: pixels from the baseline to the top of the highest letter
    // actualBoundingBoxDescent: pixels from the baseline to the bottom of the lowest letter (e.g., 'g', 'j')
    const actualInkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    
    return actualInkHeight;
}

/**
 * Samples the dominant font size of a single document/chapter and adds it to the global accumulator.
 * Uses an early exit to avoid end-of-chapter footnotes.
 */
export function accumulateChapterStyles(doc: Document, win: Window, accumulator: StyleAccumulator): void {
  const paragraphs = Array.from(doc.querySelectorAll('p, div.paragraph, div.bodytext, div.calibre1'));
  if (paragraphs.length === 0) return;

  let totalSampledChars = 0;
  const MAX_SAMPLE_CHARS = 5000;

  for (const p of paragraphs) {
    if (totalSampledChars >= MAX_SAMPLE_CHARS) break;

    const text = p.textContent?.trim() || '';

    // Filter 1: Ignore short strings (ToC, headings)
    if (text.length < 50) continue;

    // Filter 2: Ignore explicit metadata containers
    const parentTag = p.parentElement?.tagName.toLowerCase();
    if (parentTag === 'aside' || parentTag === 'nav' || parentTag === 'footer') {
      continue;
    }
    const fontSize = getActualInkHeight(p as HTMLElement, text, win);
    let lineHeight = getCanvasLineHeight(p as HTMLElement, win);

    if (isNaN(lineHeight)) {
      lineHeight = fontSize * 1.2; // Standard browser default fallback
    }

    if (!isNaN(fontSize) && fontSize > 0) {
      // Round to 1 decimal place to prevent floating point fragmentation mapping (e.g., 16.001px vs 16.0px)
      const roundedSize = Math.round(fontSize * 10) / 10;

      const existing = accumulator.get(roundedSize) || { count: 0, charCount: 0, totalLineHeight: 0 };
      existing.count += 1;
      existing.charCount += text.length;
      existing.totalLineHeight += lineHeight;
      accumulator.set(roundedSize, existing);

      totalSampledChars += text.length;
    }
  }
}

/**
 * Evaluates the global accumulator to find the mathematically dominant style.
 */
export function calculateDominantStyle(accumulator: StyleAccumulator): { fontSize: number; lineHeight: number } | null {
  if (accumulator.size === 0) return null;

  let dominantSize = 0;
  let maxVolume = -1;

  for (const [size, data] of accumulator.entries()) {
    if (data.charCount > maxVolume) {
      maxVolume = data.charCount;
      dominantSize = size;
    }
  }

  const dominantData = accumulator.get(dominantSize)!;

  return {
    fontSize: dominantSize,
    lineHeight: dominantData.totalLineHeight / dominantData.count
  };
}

/**
 * Extracts content from an EPUB file using an offscreen renderer.
 * This ensures that the extracted text and CFIs match exactly what the user sees during playback.
 */
export async function extractContentOffscreen(
  file: File | Blob | ArrayBuffer,
  options: ExtractionOptions = {},
  onProgress?: (progress: number, message: string) => void
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

  // SECURITY: Register a serialization hook to sanitize HTML content before it's rendered.
  // This prevents XSS attacks from malicious scripts in EPUB files during the ingestion phase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((book.spine as any).hooks?.serialize) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (book.spine as any).hooks.serialize.register((html: string) => {
      return sanitizeContent(html);
    });
  }

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

    // PATCH: Ensure iframe has allow-scripts to prevent blocking in strict environments
    const iframe = container.querySelector('iframe');
    if (iframe) {
      const sandbox = iframe.getAttribute('sandbox') || '';
      if (!sandbox.includes('allow-scripts')) {
        iframe.setAttribute('sandbox', (sandbox + ' allow-scripts allow-same-origin').trim());
      }
    }

    // Access spine items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spine = book.spine as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = [];
    if (spine.each) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spine.each((item: any) => items.push(item));
    } else if (spine.items) {
      items.push(...spine.items);
    }

    const totalItems = items.length;
    // OPTIMIZATION: Track time to yield only when necessary to avoid artificial delays
    let lastYieldTime = performance.now();

    for (let i = 0; i < totalItems; i++) {
      const item = items[i];
      const progress = Math.round((i / totalItems) * 100);
      onProgress?.(progress, `Processing chapter ${i + 1} of ${totalItems}`);

      // Render the chapter
      await rendition.display(item.href);

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
          accumulateChapterStyles(doc, win, globalStyleAccumulator);
        }

        // Determine title
        let title = '';
        const headings = doc.querySelectorAll('h1, h2, h3');
        if (headings.length > 0) {
          title = headings[0].textContent || '';
        }
        if (!title.trim()) {
          const p = doc.querySelector('p');
          if (p && p.textContent) title = p.textContent;
        }
        if (!title.trim()) {
          title = body.textContent || '';
        }
        title = title.replace(/\s+/g, ' ').trim();
        if (title.length > 60) title = title.substring(0, 60) + '...';
        if (!title) title = `Chapter ${i + 1}`;

        // Extract sentences with CFIs
        const sentences = extractSentencesFromNode(body, (range) => {
          // contents.cfiFromRange returns the CFI for the range.
          // It should include the base CFI (spine index) if correctly initialized.
          return contents.cfiFromRange(range);
        }, options);

        // Table Capture
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

        results.push({
          href: item.href,
          sentences,
          textContent: body.textContent || '',
          title,
          tables: capturedTables
        });
      }

      // Yield to main thread
      // OPTIMIZATION: Instead of waiting 50ms every chapter (which adds seconds of delay for large books),
      // we only yield if we've been blocking the main thread for more than 16ms (1 frame).
      // When we do yield, we use setTimeout(0) to resume as soon as possible.
      if (performance.now() - lastYieldTime > 16) {
        await new Promise(r => setTimeout(r, 0));
        lastYieldTime = performance.now();
      }
    }

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
    if (book) {
      await book.opened.catch(() => { });
      book.destroy();
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
