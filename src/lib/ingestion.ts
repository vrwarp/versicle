import ePub, { type NavigationItem } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db';
import type { BookMetadata, SectionMetadata, TTSContent } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import { extractSentencesFromNode, type ExtractionOptions } from './tts';
import { generateEpubCfi } from './cfi-utils';

function cheapHash(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 5381;
  for (let i = 0; i < view.length; i++) {
    hash = ((hash << 5) + hash) + view[i]; /* hash * 33 + c */
  }
  return (hash >>> 0).toString(16);
}

/**
 * Generates a unique fingerprint for a file based on metadata and content sampling.
 * This is much faster than a full cryptographic hash (SHA-256).
 *
 * @param file - The file (or blob) to fingerprint.
 * @param metadata - The metadata to include in the fingerprint (title, author, filename).
 * @returns A string fingerprint.
 */
export async function generateFileFingerprint(
  file: Blob,
  metadata: { title: string; author: string; filename: string }
): Promise<string> {
  // 1. Metadata: This acts as the primary filter.
  // We use title/author/filename instead of volatile attributes like size/lastModified.
  const metaString = `${metadata.filename}-${metadata.title}-${metadata.author}`;

  // 2. Head/Tail Sampling: Read the first 4KB and last 4KB of the file.
  // The header usually contains file format signatures (magic bytes) and metadata.
  // The footer often contains EOF markers or central directory records (in ZIP/EPUB).
  const headSize = Math.min(4096, file.size);

  const head = await file.slice(0, headSize).arrayBuffer();
  // if file is smaller than 4096, tail overlaps head, which is fine for fingerprinting
  const tail = await file.slice(Math.max(0, file.size - 4096), file.size).arrayBuffer();

  // 3. Fast non-crypto hash
  return `${metaString}-${cheapHash(head)}-${cheapHash(tail)}`;
}


// Helper to convert Blob to text using FileReader (for compatibility)
const blobToText = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(blob);
  });
};

/**
 * Validates that the file has a ZIP header (PK\x03\x04), which is required for EPUBs.
 * This prevents uploading random files or potential malware masked as EPUBs.
 * It checks the first 4 bytes for the Magic Number: 50 4B 03 04.
 *
 * @param file - The file to validate.
 * @returns A Promise resolving to true if valid, false otherwise.
 */
export async function validateEpubFile(file: File): Promise<boolean> {
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const view = new DataView(buffer);
        // PK\x03\x04 => 0x50 0x4B 0x03 0x04
        return view.getUint8(0) === 0x50 &&
               view.getUint8(1) === 0x4B &&
               view.getUint8(2) === 0x03 &&
               view.getUint8(3) === 0x04;
    } catch (e) {
        console.error("File validation failed", e);
        return false;
    }
}

/**
 * Processes an EPUB file, extracting metadata and cover image, and storing it in the database.
 *
 * @param file - The EPUB file object to process.
 * @param ttsOptions - Configuration options for TTS sentence extraction.
 * @returns A Promise that resolves to the UUID of the newly created book.
 * @throws Will throw an error if the file cannot be parsed or database operations fail.
 */
export async function processEpub(file: File, ttsOptions?: ExtractionOptions): Promise<string> {
  // 1. Security Check: Validate File Header
  const isValid = await validateEpubFile(file);
  if (!isValid) {
      throw new Error("Invalid file format. File must be a valid EPUB (ZIP archive).");
  }

  // Pass File directly to ePub.js (it supports Blob/File/ArrayBuffer/Url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(file);

  await book.ready;

  const metadata = await book.loaded.metadata;
  const bookId = uuidv4();

  // Generate Synthetic TOC and Calculate Durations
  const syntheticToc: NavigationItem[] = [];
  const sections: SectionMetadata[] = [];
  const ttsContentBatches: TTSContent[] = [];
  let totalChars = 0;

  try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spine = (book.spine as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      if (spine.each) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          spine.each((item: any) => items.push(item));
      } else if (spine.items) {
         items.push(...spine.items);
      }

      for (let i = 0; i < items.length; i++) {
           const item = items[i];
           let characterCount = 0;
           try {
               let title = '';
               // In ingestion context (file input), book.archive is available.
               // We use blob extraction + DOMParser as book.load() might rely on DOM attachment or network.
               if (book.archive) {
                    let blob = await book.archive.getBlob(item.href);

                    // Fallback: Try to find file if path is relative
                    if (!blob) {
                         // eslint-disable-next-line @typescript-eslint/no-explicit-any
                         const zipFiles = Object.keys((book.archive as any).zip?.files || {});
                         // Try to match end of string
                         const match = zipFiles.find(f => f.endsWith(item.href));
                         if (match) {
                             // Use JSZip directly via internal property to bypass potential path resolution issues in getBlob
                             // eslint-disable-next-line @typescript-eslint/no-explicit-any
                             const zipObj = (book.archive as any).zip;
                             if (zipObj && zipObj.file) {
                                 const fileObj = zipObj.file(match);
                                 if (fileObj) {
                                     blob = await fileObj.async("blob");
                                 }
                             }
                             // Fallback to getBlob if direct zip access failed (though unlikely if match found)
                             if (!blob) {
                                 blob = await book.archive.getBlob(match);
                             }
                         }
                    }
                    if (blob) {
                        const text = await blobToText(blob);
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, "application/xhtml+xml");

                        // Extract TTS sentences
                        try {
                            // Format: epubcfi(/6/{spineIndex}[{itemId}]!)
                            const spineIndex = (i + 1) * 2;
                            const baseCfi = `epubcfi(/6/${spineIndex}${item.id ? `[${item.id}]` : ''}!)`;

                            const sentences = extractSentencesFromNode(doc.body, (range) => {
                                return generateEpubCfi(range, baseCfi);
                            }, ttsOptions);

                            if (sentences.length > 0) {
                                ttsContentBatches.push({
                                    id: `${bookId}-${item.href}`,
                                    bookId: bookId,
                                    sectionId: item.href,
                                    sentences: sentences
                                });
                            }
                        } catch (e) {
                            console.warn(`Failed to extract TTS content for ${item.href}`, e);
                        }

                        const headings = doc.querySelectorAll('h1, h2, h3');
                        if (headings.length > 0) {
                            title = headings[0].textContent || '';
                        }

                        if (!title.trim()) {
                            const p = doc.querySelector('p');
                            if (p && p.textContent) title = p.textContent;
                        }

                        if (!title.trim()) {
                            title = doc.body.textContent || '';
                        }

                        // Calculate character count from text content
                        const contentText = doc.body.textContent || '';
                        characterCount = contentText.length;
                        totalChars += characterCount;


                        // Clean up
                        title = title.replace(/\s+/g, ' ').trim();
                        if (title.length > 60) {
                           title = title.substring(0, 60) + '...';
                        }
                    }
               }

               if (!title) title = `Chapter ${i+1}`;

               syntheticToc.push({
                   id: item.id || `syn-toc-${i}`,
                   href: item.href,
                   label: title
               });

               // Store section metadata
               sections.push({
                 id: `${bookId}-${item.href}`, // Composite key
                 bookId: bookId,
                 sectionId: item.href, // This corresponds to currentSectionId
                 characterCount: characterCount,
                 playOrder: i
               });

           } catch (e) {
                console.error("Error generating TOC item or calculating duration", e);
                syntheticToc.push({ id: item.id || `syn-toc-${i}`, href: item.href, label: `Chapter ${i+1}` });
           }
      }
  } catch (e) {
      console.error("Error generating synthetic TOC", e);
  }

  let coverBlob: Blob | undefined;
  const coverUrl = await book.coverUrl();

  if (coverUrl) {
    try {
      const response = await fetch(coverUrl);
      coverBlob = await response.blob();
    } catch (error) {
      console.warn('Failed to retrieve cover blob:', error);
    }
  }

  // Calculate fingerprint
  const fileHash = await generateFileFingerprint(file, {
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    filename: file.name
  });

  const candidateBook: BookMetadata = {
    id: bookId,
    filename: file.name,
    title: metadata.title || 'Untitled',
    author: metadata.creator || 'Unknown Author',
    description: metadata.description || '',
    addedAt: Date.now(),
    coverBlob: coverBlob,
    fileHash,
    isOffloaded: false,
    fileSize: file.size,
    syntheticToc,
    totalChars, // Store the calculated total characters
  };

  const check = getSanitizedBookMetadata(candidateBook);
  let finalBook = candidateBook;

  if (check) {
    // Always sanitize metadata to ensure security (XSS prevention) and DB integrity
    finalBook = check.sanitized;
    if (check.wasModified) {
       console.warn(`Metadata sanitized for "${candidateBook.title}":`, check.modifications);
    }
  }

  const db = await getDB();

  const tx = db.transaction(['books', 'files', 'sections', 'tts_content'], 'readwrite');
  await tx.objectStore('books').add(finalBook);
  await tx.objectStore('files').add(file, bookId);

  // Store section metadata
  const sectionsStore = tx.objectStore('sections');
  for (const section of sections) {
    await sectionsStore.add(section);
  }

  // Store TTS content
  const ttsStore = tx.objectStore('tts_content');
  for (const batch of ttsContentBatches) {
      await ttsStore.add(batch);
  }

  await tx.done;

  return bookId;
}
