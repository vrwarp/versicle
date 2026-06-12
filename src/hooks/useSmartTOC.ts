import { useState, useCallback } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { NavigationItem } from '~types/db';
import { getGenAIClient } from '@domains/google';
import { bookContent } from '@data/repos/bookContent';
import { bookRepository } from '@app/repositories/BookRepository';
import { useGenAIStore } from '@store/useGenAIStore';
import { useToastStore } from '@store/useToastStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('useSmartTOC');

interface UseSmartTOCResult {
  enhanceTOC: () => Promise<void>;
  isEnhancing: boolean;
  progress: { current: number; total: number } | null;
}

export function useSmartTOC(
  engine: ReaderEngine | null,
  bookId: string | undefined,
  originalToc: NavigationItem[],
  setSyntheticToc: (toc: NavigationItem[]) => void
): UseSmartTOCResult {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const { isEnabled: isAIEnabled } = useGenAIStore();
  const showToast = useToastStore((state) => state.showToast);

  const enhanceTOC = useCallback(async () => {
    if (!engine || !bookId) {
      showToast('Book not loaded', 'error');
      return;
    }

    if (!isAIEnabled || !getGenAIClient().isConfigured()) {
      showToast('AI features are disabled or not configured. Please check Settings.', 'error');
      return;
    }

    setIsEnhancing(true);
    const totalItems = countTocItems(originalToc);
    setProgress({ current: 0, total: totalItems });

    try {
      const sectionsToProcess: { id: string; text: string }[] = [];

      await collectSectionData(originalToc, engine, (count) => {
        setProgress((prev) => prev ? { ...prev, current: prev.current + count } : null);
      }, sectionsToProcess);

      if (sectionsToProcess.length === 0) {
        throw new Error('No readable content found in sections.');
      }

      const bookMetadata = await bookRepository.getBookMetadata(bookId);
      const bookTitle = bookMetadata?.title || 'Unknown Book';
      const language = bookMetadata?.language;

      // Deep feature import (first-use loading, Phase 8 §A — the feature
      // module's zod schemas must stay out of the static graph).
      const { generateTocTitles } = await import('@domains/google/genai/features/tocTitles');
      const generatedTitles = await generateTocTitles(getGenAIClient(), sectionsToProcess, { bookTitle, language });

      const titleMap = new Map<string, string>();
      generatedTitles.forEach(item => titleMap.set(item.id, item.title));

      const newToc = reconstructToc(originalToc, titleMap);

      // Persist enhanced TOC to static_structure in IDB
      await bookContent.updateToc(bookId, newToc);

      // Reactively update local static metadata cache in useLibraryStore
      useLibraryStore.setState((state) => {
        const nextStaticMetadata = { ...state.staticMetadata };
        if (nextStaticMetadata[bookId]) {
          nextStaticMetadata[bookId] = {
            ...nextStaticMetadata[bookId],
            syntheticToc: newToc
          };
        }
        return { staticMetadata: nextStaticMetadata };
      });

      setSyntheticToc(newToc);
      showToast('Table of Contents enhanced successfully!', 'success');

    } catch (error) {
      logger.error('Failed to enhance TOC:', error);
      showToast('Failed to enhance TOC.', 'error');
    } finally {
      setIsEnhancing(false);
      setProgress(null);
    }
  }, [engine, bookId, originalToc, isAIEnabled, setSyntheticToc, showToast]);

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
  engine: ReaderEngine,
  onProgress: (count: number) => void,
  results: { id: string; text: string }[]
): Promise<void> {
  for (const item of items) {
    try {
      // Section text via the engine port (no re-unzip; href hash stripped inside)
      const content = await engine.loadSectionText(item.href);

      if (content) {
        const text = content.trim().substring(0, 500);
        if (text.length > 0) {
          results.push({ id: item.id, text });
        }
      }
    } catch (e) {
      logger.warn(`Failed to process TOC item: ${item.label}`, e);
    }

    onProgress(1);

    if (item.subitems && item.subitems.length > 0) {
      await collectSectionData(item.subitems, engine, onProgress, results);
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
