/**
 * Main-thread EngineContext wiring.
 *
 * Forwards every port call to the real Zustand stores and the Capacitor native bridge,
 * which is why module-level `vi.mock('@store/...')` mocks in the test suite intercept
 * these reads/writes.
 *
 * Every store/Capacitor access happens lazily inside a method body — never at module
 * initialization — so the static imports below cannot trigger an engine ↔ store
 * circular-import hazard.
 */
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { useTTSSettingsStore, getDefaultMinSentenceLength } from '@store/useTTSSettingsStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { useToastStore } from '@store/useToastStore';
import { useBookStore } from '@store/useBookStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { LexiconService } from '@lib/tts/LexiconService';
import { bookRepository } from '../repositories/BookRepository';
import { contentAnalysisRepository } from '../repositories/ContentAnalysisRepository';
import {
    genAIIsConfigured,
    genAIConfigure,
    genAIDetectContentTypes,
    genAIGenerateTableAdaptations,
} from './genaiPort';
import { toTTSSettingsData } from './replicationSpec';
import { repoBookContentPort, createRepoSessionStore } from '@lib/tts/engine/repoPorts';
import type { EngineContext } from '@lib/tts/engine/EngineContext';

/**
 * Build the EngineContext backed by live Zustand stores + Capacitor.
 */
export function createZustandEngineContext(): EngineContext {
    return {
        config: {
            getActiveLanguage: () => useTTSSettingsStore.getState().activeLanguage,
            setActiveLanguage: (lang) => useTTSSettingsStore.getState().setActiveLanguage(lang),
            // The explicit data-only payload (TTSSettingsData) — same shape the
            // replication slice pushes to the worker context.
            getSettings: () => toTTSSettingsData(useTTSSettingsStore.getState()),
            getDefaultMinSentenceLength: (lang) => getDefaultMinSentenceLength(lang),
        },

        genAI: {
            getSettings: () => useGenAIStore.getState(),
            addLog: (entry) => useGenAIStore.getState().addLog(entry),
            subscribe: (listener) =>
                typeof useGenAIStore.subscribe === 'function'
                    ? useGenAIStore.subscribe(listener)
                    : () => {},
            isConfigured: () => genAIIsConfigured(),
            configure: (apiKey, model) => genAIConfigure(apiKey, model),
            detectContentTypes: (nodes, hints, context) =>
                genAIDetectContentTypes(nodes, hints, context),
            generateTableAdaptations: (nodes, thinkingBudget, context) =>
                genAIGenerateTableAdaptations(nodes, thinkingBudget, context),
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
            getCompiled: (bookId, language) => LexiconService.getInstance().getCompiled(bookId, language),
            getBibleLexiconPreference: (bookId) =>
                LexiconService.getInstance().getBibleLexiconPreference(bookId),
            // Invalidation stream: the assembler bumps on store CRUD + bible-flag changes.
            subscribe: (listener) => LexiconService.getInstance().assembler.subscribe(listener),
        },

        platform: {
            getPlatform: () => Capacitor.getPlatform(),
            isNativePlatform: () => Capacitor.isNativePlatform(),
            isBatteryOptimizationEnabled: async () =>
                (await BatteryOptimization.isBatteryOptimizationEnabled()).enabled,
            openBatteryOptimizationSettings: () =>
                BatteryOptimization.openBatteryOptimizationSettings(),
        },

        // Storage ports: the repo-backed implementations. Module-level
        // `vi.mock('@data/repos/...')` mocks in lib-level pipeline tests
        // intercept these reads (the port delegates to the mocked module).
        content: repoBookContentPort,
        session: createRepoSessionStore(),
    };
}
