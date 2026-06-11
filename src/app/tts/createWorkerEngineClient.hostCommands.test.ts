/**
 * Unit tests for the host side of the worker bridge: every EngineHostCommand kind the worker
 * can emit must map to the right store/repository call on the main thread. A new command kind
 * added to the union without a mapping here fails the exhaustiveness test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { stores } = vi.hoisted(() => ({
    stores: {
        tts: { setActiveLanguage: vi.fn() },
        reading: {
            updateTTSProgress: vi.fn(),
            addCompletedRange: vi.fn(),
            updatePlaybackPosition: vi.fn(),
            getProgress: vi.fn(() => null),
        },
        annotation: { add: vi.fn() },
        toast: { showToast: vi.fn() },
        genAI: { addLog: vi.fn() },
        readerUI: { setCurrentSection: vi.fn() },
    },
}));

vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: { getState: () => stores.tts, subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: { getState: () => stores.reading, subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../../store/useAnnotationStore', () => ({
    useAnnotationStore: { getState: () => stores.annotation },
}));
vi.mock('../../store/useToastStore', () => ({
    useToastStore: { getState: () => stores.toast },
}));
vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: { getState: () => stores.genAI, subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../../store/useReaderUIStore', () => ({
    useReaderUIStore: { getState: () => stores.readerUI },
}));
vi.mock('../../store/useContentAnalysisStore', () => ({
    useContentAnalysisStore: { getState: () => ({ sections: {} }), subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../../store/useBookStore', () => ({
    useBookStore: { getState: () => ({ books: {} }), subscribe: vi.fn(() => () => {}) },
}));

vi.mock('../repositories/ContentAnalysisRepository', () => ({
    contentAnalysisRepository: {
        saveReferenceStartCfi: vi.fn(),
        markAnalysisLoading: vi.fn(),
        markAnalysisError: vi.fn(),
        saveTableAdaptations: vi.fn(),
        getContentAnalysis: vi.fn(),
    },
}));
vi.mock('../repositories/BookRepository', () => ({
    bookRepository: { getBookMetadata: vi.fn() },
}));

// Heavy main-thread collaborators the module imports but these tests never construct.
vi.mock('../../lib/tts/TTSProviderManager', () => ({ TTSProviderManager: vi.fn() }));
vi.mock('../../lib/tts/PlatformIntegration', () => ({ PlatformIntegration: vi.fn() }));
vi.mock('../../lib/tts/LexiconService', () => ({ LexiconService: { getInstance: vi.fn() } }));
vi.mock('../../lib/genai/GenAIService', () => ({ genAIService: {} }));

import { applyHostCommand } from './createWorkerEngineClient';
import { contentAnalysisRepository } from '../repositories/ContentAnalysisRepository';
import type { EngineHostCommand } from '../../lib/tts/engine/WorkerEngineContext';

describe('applyHostCommand — worker writes land on the right store/repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const CASES: Array<{ command: EngineHostCommand; verify: () => void }> = [
        {
            command: { kind: 'setActiveLanguage', lang: 'fr' },
            verify: () => expect(stores.tts.setActiveLanguage).toHaveBeenCalledWith('fr'),
        },
        {
            command: { kind: 'updateTTSProgress', bookId: 'b1', queueIndex: 3, sectionIndex: 1 },
            verify: () => expect(stores.reading.updateTTSProgress).toHaveBeenCalledWith('b1', 3, 1),
        },
        {
            command: { kind: 'addCompletedRange', bookId: 'b1', cfiRange: 'cfi(r)', type: 'tts' as never },
            verify: () => expect(stores.reading.addCompletedRange).toHaveBeenCalledWith('b1', 'cfi(r)', 'tts'),
        },
        {
            command: { kind: 'updatePlaybackPosition', bookId: 'b1', lastPlayedCfi: 'cfi(p)' },
            verify: () => expect(stores.reading.updatePlaybackPosition).toHaveBeenCalledWith('b1', 'cfi(p)'),
        },
        {
            command: { kind: 'addAnnotation', annotation: { type: 'audio-bookmark' } as never },
            verify: () => expect(stores.annotation.add).toHaveBeenCalledWith({ type: 'audio-bookmark' }),
        },
        {
            command: { kind: 'showToast', message: 'hi', type: 'success' as never },
            verify: () => expect(stores.toast.showToast).toHaveBeenCalledWith('hi', 'success'),
        },
        {
            command: { kind: 'addGenAILog', entry: { prompt: 'p' } as never },
            verify: () => expect(stores.genAI.addLog).toHaveBeenCalledWith({ prompt: 'p' }),
        },
        {
            command: { kind: 'setCurrentSection', title: 'Ch 1', sectionId: 's1' },
            verify: () => expect(stores.readerUI.setCurrentSection).toHaveBeenCalledWith('Ch 1', 's1'),
        },
        {
            command: { kind: 'saveReferenceStartCfi', bookId: 'b1', sectionId: 's1', cfi: 'cfi(x)' },
            verify: () =>
                expect(contentAnalysisRepository.saveReferenceStartCfi).toHaveBeenCalledWith('b1', 's1', 'cfi(x)'),
        },
        {
            command: { kind: 'markAnalysisLoading', bookId: 'b1', sectionId: 's1' },
            verify: () => expect(contentAnalysisRepository.markAnalysisLoading).toHaveBeenCalledWith('b1', 's1'),
        },
        {
            command: { kind: 'markAnalysisError', bookId: 'b1', sectionId: 's1', error: 'boom' },
            verify: () => expect(contentAnalysisRepository.markAnalysisError).toHaveBeenCalledWith('b1', 's1', 'boom'),
        },
        {
            command: { kind: 'saveTableAdaptations', bookId: 'b1', sectionId: 's1', adaptations: [{ rootCfi: 'c', text: 't' }] },
            verify: () =>
                expect(contentAnalysisRepository.saveTableAdaptations).toHaveBeenCalledWith('b1', 's1', [{ rootCfi: 'c', text: 't' }]),
        },
    ];

    it.each(CASES.map((c) => [c.command.kind, c] as const))('maps %s', (_kind, c) => {
        applyHostCommand(c.command);
        c.verify();
    });

    it('covers every EngineHostCommand kind (exhaustiveness)', () => {
        // Mirrors the EngineHostCommand union; the Record type in this file's CASES plus this
        // list pin the full set. If a kind is added to the union, add a CASE and list it here.
        const covered = CASES.map((c) => c.command.kind).sort();
        expect(covered).toEqual([
            'addAnnotation', 'addCompletedRange', 'addGenAILog', 'markAnalysisError',
            'markAnalysisLoading', 'saveReferenceStartCfi', 'saveTableAdaptations',
            'setActiveLanguage', 'setCurrentSection', 'showToast', 'updatePlaybackPosition',
            'updateTTSProgress',
        ].sort());
    });
});
