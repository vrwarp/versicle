/**
 * Production EngineContext wiring.
 *
 * Forwards every port call to the real Zustand stores and the Capacitor native bridge.
 * Behavior is identical to the pre-refactor code that called the stores directly, which
 * is why existing module-level `vi.mock('../../store/...')` mocks in the test suite keep
 * intercepting these reads/writes unchanged.
 *
 * Every store/Capacitor access happens lazily inside a method body — never at module
 * initialization — so the static imports below cannot trigger the
 * AudioPlayerService ↔ useTTSStore circular-import hazard (the same reason the original
 * code reached for dynamic `import()`).
 */
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { useTTSStore, getDefaultMinSentenceLength } from '../../../store/useTTSStore';
import { useGenAIStore } from '../../../store/useGenAIStore';
import { useReadingStateStore } from '../../../store/useReadingStateStore';
import { useContentAnalysisStore } from '../../../store/useContentAnalysisStore';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { useToastStore } from '../../../store/useToastStore';
import { useBookStore } from '../../../store/useBookStore';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { LexiconService } from '../LexiconService';
import { bookRepository } from '../../../db/BookRepository';
import { contentAnalysisRepository } from '../../../db/ContentAnalysisRepository';
import type { EngineContext } from './EngineContext';

/**
 * Build the production EngineContext backed by live Zustand stores + Capacitor.
 */
export function createZustandEngineContext(): EngineContext {
    return {
        config: {
            getActiveLanguage: () => useTTSStore.getState().activeLanguage,
            setActiveLanguage: (lang) => useTTSStore.getState().setActiveLanguage(lang),
            getSettings: () => useTTSStore.getState(),
            getDefaultMinSentenceLength: (lang) => getDefaultMinSentenceLength(lang),
        },

        genAI: {
            getSettings: () => useGenAIStore.getState(),
            addLog: (entry) => useGenAIStore.getState().addLog(entry),
            subscribe: (listener) =>
                typeof useGenAIStore.subscribe === 'function'
                    ? useGenAIStore.subscribe(listener)
                    : () => {},
        },

        readingState: {
            getProgress: (bookId) => useReadingStateStore.getState().getProgress(bookId),
            updateTTSProgress: (bookId, queueIndex, sectionIndex) =>
                useReadingStateStore.getState().updateTTSProgress(bookId, queueIndex, sectionIndex),
            addCompletedRange: (bookId, cfiRange, type) =>
                useReadingStateStore.getState().addCompletedRange(bookId, cfiRange, type),
            updatePlaybackPosition: (bookId, lastPlayedCfi) =>
                useReadingStateStore.getState().updatePlaybackPosition(bookId, lastPlayedCfi),
        },

        contentAnalysis: {
            getAnalysis: (bookId, sectionId) =>
                useContentAnalysisStore.getState().getAnalysis(bookId, sectionId),
            getSnapshot: () => useContentAnalysisStore.getState(),
            subscribe: (listener) => useContentAnalysisStore.subscribe(listener),
            getContentAnalysis: async (bookId, sectionId) =>
                contentAnalysisRepository.getContentAnalysis(bookId, sectionId),
            saveReferenceStartCfi: (bookId, sectionId, cfi) =>
                contentAnalysisRepository.saveReferenceStartCfi(bookId, sectionId, cfi),
            markAnalysisLoading: (bookId, sectionId) =>
                contentAnalysisRepository.markAnalysisLoading(bookId, sectionId),
            markAnalysisError: (bookId, sectionId, error) =>
                contentAnalysisRepository.markAnalysisError(bookId, sectionId, error),
            saveTableAdaptations: (bookId, sectionId, adaptations) =>
                contentAnalysisRepository.saveTableAdaptations(bookId, sectionId, adaptations),
        },

        book: {
            getBookLanguage: (bookId) => useBookStore.getState().books[bookId]?.language || 'en',
            getMetadata: (bookId) => bookRepository.getBookMetadata(bookId),
            subscribe: (listener) => useBookStore.subscribe(listener),
        },

        annotations: {
            add: (annotation) => {
                useAnnotationStore.getState().add(annotation);
            },
        },

        notifications: {
            showToast: (message, type) => useToastStore.getState().showToast(message, type),
        },

        readerUI: {
            setCurrentSection: (title, sectionId) =>
                useReaderUIStore.getState().setCurrentSection(title, sectionId),
        },

        lexicon: {
            getRules: (bookId, language) => LexiconService.getInstance().getRules(bookId, language),
            getBibleLexiconPreference: (bookId) =>
                LexiconService.getInstance().getBibleLexiconPreference(bookId),
        },

        platform: {
            getPlatform: () => Capacitor.getPlatform(),
            isNativePlatform: () => Capacitor.isNativePlatform(),
            isBatteryOptimizationEnabled: async () =>
                (await BatteryOptimization.isBatteryOptimizationEnabled()).enabled,
            openBatteryOptimizationSettings: () =>
                BatteryOptimization.openBatteryOptimizationSettings(),
        },
    };
}
