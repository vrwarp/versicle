import ePub from 'epubjs';
import { extractSentencesFromNode, type ExtractionOptions, type SentenceNode } from './tts';
import { sanitizeContent } from './sanitizer';

export interface ProcessedChapter {
  href: string;
  sentences: SentenceNode[];
  textContent: string;
  title?: string;
}

/**
 * Extracts content from an EPUB file using an offscreen renderer.
 * This ensures that the extracted text and CFIs match exactly what the user sees during playback.
 */
export async function extractContentOffscreen(
  file: File | ArrayBuffer,
  options: ExtractionOptions = {},
  onProgress?: (progress: number, message: string) => void
): Promise<ProcessedChapter[]> {
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

      if (contents && contents.document && contents.document.body) {
          const doc = contents.document;
          const body = doc.body;

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

          results.push({
              href: item.href,
              sentences,
              textContent: body.textContent || '',
              title
          });
      }

      // Yield to main thread
      await new Promise(r => setTimeout(r, 50));
    }

  } finally {
    // Cleanup
    if (book) book.destroy();
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  onProgress?.(100, 'Ingestion complete');
  return results;
}
