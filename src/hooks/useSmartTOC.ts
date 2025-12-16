import { useState, useCallback } from 'react';
import type { Book, NavigationItem } from 'epubjs';
import { genAIService } from '../lib/genai/GenAIService';
import { dbService } from '../db/DBService';
import { useGenAIStore } from '../store/useGenAIStore';
import { useToastStore } from '../store/useToastStore';

interface UseSmartTOCResult {
  enhanceTOC: () => Promise<void>;
  isEnhancing: boolean;
  progress: { current: number; total: number } | null;
}

export function useSmartTOC(
  book: Book | null,
  bookId: string | undefined,
  originalToc: NavigationItem[],
  setSyntheticToc: (toc: NavigationItem[]) => void
): UseSmartTOCResult {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const { isEnabled: isAIEnabled } = useGenAIStore();
  const showToast = useToastStore((state) => state.showToast);

  const enhanceTOC = useCallback(async () => {
    if (!book || !bookId) {
      showToast('Book not loaded', 'error');
      return;
    }

    if (!isAIEnabled || !genAIService.isConfigured()) {
      showToast('AI features are disabled or not configured. Please check Settings.', 'error');
      return;
    }

    // Flatten TOC to process all items (including sub-chapters if desired, but let's start with top-level or whatever is in toc)
    // Note: epub.js 'toc' structure is nested. We need to traverse it.
    // For simplicity in Phase 3, let's flatten it to a list of items to process,
    // but we need to reconstruct the tree structure at the end.
    // Actually, mapping the existing structure is safer.

    setIsEnhancing(true);
    const totalItems = countTocItems(originalToc);
    setProgress({ current: 0, total: totalItems });

    try {
      const newToc = await processTocItems(originalToc, book, (count) => {
        setProgress((prev) => (prev ? { ...prev, current: prev.current + count } : null));
      });

      // Update DB
      const metadata = await dbService.getBookMetadata(bookId);
      if (metadata) {
        await dbService.updateBookMetadata(bookId, {
          ...metadata,
          syntheticToc: newToc,
          aiAnalysisStatus: 'complete' // Or 'partial' if we failed some
        });
      }

      // Update local state
      setSyntheticToc(newToc);
      showToast('Table of Contents enhanced successfully!', 'success');

    } catch (error) {
      console.error('Failed to enhance TOC:', error);
      showToast('Failed to enhance TOC. Check console for details.', 'error');
    } finally {
      setIsEnhancing(false);
      setProgress(null);
    }
  }, [book, bookId, originalToc, isAIEnabled, setSyntheticToc, showToast]);

  return { enhanceTOC, isEnhancing, progress };
}

// Helper to count items recursively
function countTocItems(items: NavigationItem[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    if (item.subitems) {
      count += countTocItems(item.subitems);
    }
  }
  return count;
}

// Helper to process items recursively
async function processTocItems(
  items: NavigationItem[],
  book: Book,
  onProgress: (count: number) => void
): Promise<NavigationItem[]> {
  const newItems: NavigationItem[] = [];

  for (const item of items) {
    let newLabel = item.label;

    try {
      // Load chapter content
      // We use book.load(href) which returns a Document
      // But we need to be careful not to render it.
      // book.load() fetches the resource.

      // Optimization: Try to get text without full DOM parsing if possible,
      // but epub.js abstracts the storage.
      // We will use a temporary fetch if possible, but book.load is the standard way.
      // Note: book.load might return a Document or an XMLDocument.

      // NOTE: This might be slow for many chapters.
      // We are limiting text to first 2000 chars.

      // Use book.spine.get(href) to ensure we get the right section object, then load.
      // Casting to 'any' because strict typing for spine items is incomplete in some versions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const section = book.spine.get(item.href) as any;

      // Use a bound load function to ensure correct context if needed
      const doc = await section.load(book.load.bind(book)) as Document;

      if (doc && doc.body && doc.body.textContent) {
          const text = doc.body.textContent.trim().substring(0, 2000);
          if (text.length > 50) { // Only process if there's enough text
              const result = await genAIService.generateChapterTitle(text);
              newLabel = result.title;
          }
      }

    } catch (e) {
      console.warn(`Failed to process TOC item: ${item.label}`, e);
      // Keep original label on failure
    }

    onProgress(1);

    const newItem: NavigationItem = {
      ...item,
      label: newLabel,
    };

    if (item.subitems && item.subitems.length > 0) {
      newItem.subitems = await processTocItems(item.subitems, book, onProgress);
    }

    newItems.push(newItem);
  }

  return newItems;
}
