import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useTTSStore } from '../../store/useTTSStore';
import { TextSegmenter } from './TextSegmenter';
import { LexiconService } from './LexiconService';
import { BIBLE_ABBREVIATIONS } from '../../data/bible-lexicon';
import type { BookMetadata, TTSContentAnalysis } from '../../types/db';

// Explicit mocks to prevent auto-mocking issues
vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn(),
        getBookMetadata: vi.fn(),
        getContentAnalysis: vi.fn(),
        getBookStructure: vi.fn(),
    }
}));

vi.mock('./TextSegmenter', () => ({
    TextSegmenter: {
        refineSegments: vi.fn()
    }
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn()
    }
}));

// Break circular dependency
vi.mock('./AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn().mockReturnValue({
            subscribe: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
            setSpeed: vi.fn(),
            setVoice: vi.fn(),
            setProvider: vi.fn(),
            setPrerollEnabled: vi.fn(),
            setBackgroundAudioMode: vi.fn(),
            setBackgroundVolume: vi.fn(),
        }),
    }
}));

// Partially mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            customAbbreviations: [],
            alwaysMerge: [],
            sentenceStarters: [],
            minSentenceLength: 0,
            isBibleLexiconEnabled: true
        })),
        setState: vi.fn(),
        subscribe: vi.fn(),
    }
}));

describe('AudioContentPipeline - Bible Abbreviations', () => {
    let pipeline: AudioContentPipeline;

    beforeEach(() => {
        vi.clearAllMocks();
        pipeline = new AudioContentPipeline();

        // Default Mocks
        vi.mocked(dbService.getTTSContent).mockResolvedValue({ sentences: [{ text: 'Test.', cfi: 'cfi' }] } as unknown as { sentences: { text: string, cfi: string }[] });
        vi.mocked(dbService.getBookMetadata).mockResolvedValue({} as BookMetadata);
        vi.mocked(dbService.getContentAnalysis).mockResolvedValue({} as TTSContentAnalysis);

        // Ensure getState returns fresh default values
        vi.mocked(useTTSStore.getState).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: true,
        } as unknown as ReturnType<typeof useTTSStore.getState>);

        vi.mocked(LexiconService.getInstance).mockReturnValue({
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default')
        } as unknown as LexiconService);
        vi.mocked(TextSegmenter.refineSegments).mockReturnValue([]);
    });

    it('should inject bible abbreviations when enabled globally', async () => {
        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as unknown as BookMetadata['spineItems'][0], 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']),
            expect.anything(), // alwaysMerge
            expect.anything(), // sentenceStarters
            expect.anything()  // minSentenceLength
        );
    });

    it('should NOT inject bible abbreviations when disabled globally', async () => {
        vi.mocked(useTTSStore.getState).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: false
        } as unknown as ReturnType<typeof useTTSStore.getState>);

        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as unknown as BookMetadata['spineItems'][0], 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            ['Dr.'], // Only custom
            expect.anything(),
            expect.anything(),
            expect.anything()
        );
    });

    it('should inject bible abbreviations when disabled globally but enabled for book', async () => {
        vi.mocked(useTTSStore.getState).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: false
        } as unknown as ReturnType<typeof useTTSStore.getState>);

        vi.mocked(LexiconService.getInstance).mockReturnValue({
            getBibleLexiconPreference: vi.fn().mockResolvedValue('on')
        } as unknown as LexiconService);

        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as unknown as BookMetadata['spineItems'][0], 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']),
            expect.anything(),
            expect.anything(),
            expect.anything()
        );
    });
});
