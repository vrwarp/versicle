import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { dbService } from '../../db/DBService';
import { useTTSStore } from '../../store/useTTSStore';
import { TextSegmenter } from './TextSegmenter';
import { LexiconService } from './LexiconService';
import { BIBLE_ABBREVIATIONS } from '../../data/bible-lexicon';

vi.mock('../../db/DBService');
vi.mock('./TextSegmenter');
vi.mock('./LexiconService');

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

// Partially mock useTTSStore to avoid running its initialization logic which might trigger AudioPlayerService
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
        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [{ text: 'Test.', cfi: 'cfi' }] });
        (dbService.getBookMetadata as any).mockResolvedValue({});
        (dbService.getContentAnalysis as any).mockResolvedValue({});

        // Ensure getState returns fresh default values
        (useTTSStore.getState as any).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: true
        });

        (LexiconService.getInstance as any).mockReturnValue({
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default')
        });
        (TextSegmenter.refineSegments as any).mockReturnValue([]);
    });

    it('should inject bible abbreviations when enabled globally', async () => {
        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as any, 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']),
            expect.anything(), // alwaysMerge
            expect.anything(), // sentenceStarters
            expect.anything()  // minSentenceLength
        );
    });

    it('should NOT inject bible abbreviations when disabled globally', async () => {
        (useTTSStore.getState as any).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: false
        });

        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as any, 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            ['Dr.'], // Only custom
            expect.anything(),
            expect.anything(),
            expect.anything()
        );
    });

    it('should inject bible abbreviations when disabled globally but enabled for book', async () => {
        (useTTSStore.getState as any).mockReturnValue({
            customAbbreviations: ['Dr.'],
            alwaysMerge: ['Mr.'],
            sentenceStarters: ['The'],
            minSentenceLength: 50,
            isBibleLexiconEnabled: false
        });
        (LexiconService.getInstance as any).mockReturnValue({
            getBibleLexiconPreference: vi.fn().mockResolvedValue('on')
        });

        await pipeline.loadSection('book1', { sectionId: 's1', characterCount: 100 } as any, 0, false, 1.0);

        expect(TextSegmenter.refineSegments).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([...BIBLE_ABBREVIATIONS, 'Dr.']),
            expect.anything(),
            expect.anything(),
            expect.anything()
        );
    });
});
