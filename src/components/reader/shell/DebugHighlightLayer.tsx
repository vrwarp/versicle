/**
 * DebugHighlightLayer — GenAI content-analysis debug highlights (Phase 6
 * §5 table, prep/phase6-reader-engine.md PR-9). Extracted verbatim from
 * the legacy ReaderView: when debug mode is enabled, the current section's
 * referenceStartCfi (from the content-analysis repository) renders on the
 * engine's 'debug' highlight layer; disabling clears the layer.
 */
import type React from 'react';
import { useEffect } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';
import { useGenAIStore } from '@store/useGenAIStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { contentAnalysisRepository } from '@app/repositories/ContentAnalysisRepository';
import { TYPE_COLORS } from '~types/content-analysis';
import { createLogger } from '@lib/logger';

const logger = createLogger('DebugHighlightLayer');

export interface DebugHighlightLayerProps {
  bookId: string | undefined;
  engine: ReaderEngine | null;
  highlights: HighlightLayerManager | null;
  isReady: boolean;
}

export const DebugHighlightLayer: React.FC<DebugHighlightLayerProps> = ({
  bookId,
  engine,
  highlights,
  isReady,
}) => {
  const isDebugModeEnabled = useGenAIStore(state => state.isDebugModeEnabled);
  const currentSectionId = useReaderUIStore(state => state.currentSectionId);
  const currentTheme = usePreferencesStore(state => state.currentTheme);

  // Apply content analysis debug highlights (the manager's 'debug' layer
  // carries the bookkeeping the old addedDebugHighlights ref duplicated).
  useEffect(() => {
    if (!engine || !highlights || !isReady) return;

    if (!isDebugModeEnabled) {
      // Clear if disabled
      highlights.clear('debug');
      return;
    }

    const applyHighlights = async () => {
      try {
        if (currentSectionId === undefined) return;

        // Resolve the current section's index to fetch specific analysis data.
        // This avoids loading analysis for the entire book.
        // currentSectionId is checked above, but TS might not infer it for the argument
        const section = engine.resolveSection(currentSectionId!);
        if (!section) return;

        const analysis = contentAnalysisRepository.getContentAnalysis(bookId!, section.href);
        if (!analysis) return;

        if (analysis.referenceStartCfi) {
          const highlightCfi = analysis.referenceStartCfi;

          if (!highlights.has('debug', highlightCfi)) {
            const color = TYPE_COLORS['reference'];
            if (color) {
              highlights.add('debug', highlightCfi, {
                onClick: null,
                styles: {
                  fill: color,
                  backgroundColor: color,
                  fillOpacity: '1',
                  mixBlendMode: currentTheme === 'dark' ? 'screen' : 'multiply'
                },
              });
            }
          }
        }
      } catch (e) {
        logger.error('Failed to apply debug highlights', e);
      }
    };

    applyHighlights();

    // Re-apply on section change or debug toggle
  }, [engine, highlights, isReady, isDebugModeEnabled, bookId, currentSectionId, currentTheme]);

  return null;
};
