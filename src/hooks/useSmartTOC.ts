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

    setIsEnhancing(true);
    const totalItems = countTocItems(originalToc);
    // Phase 1: Scanning (0-50%), Phase 2: Generating (50-100%)
    setProgress({ current: 0, total: totalItems });

    try {
      // 1. Collect all chapter texts
      const chaptersToProcess: { id: string; text: string }[] = [];

      await collectChapterData(originalToc, book, (count) => {
         // Update progress for scanning phase
         setProgress((prev) => prev ? { ...prev, current: prev.current + count } : null);
      }, chaptersToProcess);

      // 2. Batch Generate Titles
      // Reset progress or update message - for now just keep counting but maybe jump?
      // Since we batched, we can't easily show incremental progress for the API call itself.
      // We could split into chunks of 10 if we have huge books, but for now single batch.

      const generatedTitles = await genAIService.generateTOCForBatch(chaptersToProcess);

      // Create a map for easy lookup
      const titleMap = new Map<string, string>();
      generatedTitles.forEach(item => titleMap.set(item.id, item.title));

      // 3. Reconstruct TOC with new titles
      const newToc = reconstructToc(originalToc, titleMap);

      // Update DB
      const metadata = await dbService.getBookMetadata(bookId);
      if (metadata) {
        await dbService.updateBookMetadata(bookId, {
          ...metadata,
          syntheticToc: newToc,
          aiAnalysisStatus: 'complete'
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

async function collectChapterData(
    items: NavigationItem[],
    book: Book,
    onProgress: (count: number) => void,
    results: { id: string; text: string }[]
): Promise<void> {
    for (const item of items) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const section = book.spine.get(item.href) as any;
            if (section) {
                const doc = await section.load(book.load.bind(book)) as Document;
                if (doc && doc.body && doc.body.textContent) {
                    const text = doc.body.textContent.trim().substring(0, 500); // 500 chars limit per request
                    if (text.length > 50) {
                        results.push({ id: item.id, text });
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to process TOC item: ${item.label}`, e);
        }

        onProgress(1);

        if (item.subitems && item.subitems.length > 0) {
            await collectChapterData(item.subitems, book, onProgress, results);
        }
    }
}

function reconstructToc(items: NavigationItem[], titleMap: Map<string, string>): NavigationItem[] {
    return items.map(item => {
        const newTitle = titleMap.get(item.id);
        const newItem: NavigationItem = {
            ...item,
            label: newTitle || item.label
        };

        if (item.subitems && item.subitems.length > 0) {
            newItem.subitems = reconstructToc(item.subitems, titleMap);
        }

        return newItem;
    });
}
