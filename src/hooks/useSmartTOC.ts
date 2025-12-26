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
    setProgress({ current: 0, total: totalItems });

    try {
      const sectionsToProcess: { id: string; text: string }[] = [];

      await collectSectionData(originalToc, book, (count) => {
         setProgress((prev) => prev ? { ...prev, current: prev.current + count } : null);
      }, sectionsToProcess);

      if (sectionsToProcess.length === 0) {
        throw new Error('No readable content found in sections.');
      }

      const generatedTitles = await genAIService.generateTOCForBatch(sectionsToProcess);

      const titleMap = new Map<string, string>();
      generatedTitles.forEach(item => titleMap.set(item.id, item.title));

      const newToc = reconstructToc(originalToc, titleMap);

      const metadata = await dbService.getBookMetadata(bookId);
      if (metadata) {
        await dbService.updateBookMetadata(bookId, {
          ...metadata,
          syntheticToc: newToc,
          aiAnalysisStatus: 'complete'
        });
      }

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

async function collectSectionData(
    items: NavigationItem[],
    book: Book,
    onProgress: (count: number) => void,
    results: { id: string; text: string }[]
): Promise<void> {
    for (const item of items) {
        try {
            // Strip hash to ensure we load the file correctly
            const href = item.href.split('#')[0];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contentOrDoc = await (book as any).load(href);
            let doc: Document | null = null;

            if (typeof contentOrDoc === 'string') {
                doc = new DOMParser().parseFromString(contentOrDoc, 'text/html');
            } else if (contentOrDoc && typeof contentOrDoc === 'object') {
                doc = contentOrDoc as Document;
            }

            if (doc) {
                 // Try innerText first (browser), then textContent (standard)
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 const content = (doc.body as any)?.innerText || (doc.documentElement as any)?.innerText;

                 if (content) {
                    const text = content.trim().substring(0, 500);
                    if (text.length > 0) {
                        results.push({ id: item.id, text });
                    }
                 }
            }
        } catch (e) {
            console.warn(`Failed to process TOC item: ${item.label}`, e);
        }

        onProgress(1);

        if (item.subitems && item.subitems.length > 0) {
            await collectSectionData(item.subitems, book, onProgress, results);
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
