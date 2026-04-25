import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { useBookStore } from '../../store/useBookStore';
import { useTTSStore } from '../../store/useTTSStore';

// Mock dependencies to prevent external calls during tests
vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn().mockResolvedValue([]),
        getTTSState: vi.fn().mockResolvedValue(null),
        getBookMetadata: vi.fn().mockImplementation((bookId) => {
            if (bookId === 'book-en') return Promise.resolve({ title: 'English Book', author: 'Author' });
            if (bookId === 'book-zh') return Promise.resolve({ title: 'Chinese Book', author: 'Author' });
            return Promise.resolve(null);
        })
    }
}));

vi.mock('./providers/WebSpeechProvider', () => ({
    WebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        play = vi.fn().mockResolvedValue(undefined);
        preload = vi.fn();
        stop = vi.fn();
        on = vi.fn();
        setConfig = vi.fn();
        pause = vi.fn();
        resume = vi.fn();
    }
}));

describe('AudioPlayerService - Language Sync', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset stores to default state
        useBookStore.setState({
            books: {
                'book-en': { bookId: 'book-en', language: 'en', title: 'English Book' },
                'book-zh': { bookId: 'book-zh', language: 'zh', title: 'Chinese Book' }
            }
        });

        useTTSStore.setState({ activeLanguage: 'en' });

        // Use a new instance for isolation
        service = new AudioPlayerService();
    });

    it('should proactively sync TTS language and clear lexicon when setBookId is called with a new book', async () => {
        // Spy on the TTS store method
        const setActiveLanguageSpy = vi.spyOn(useTTSStore.getState(), 'setActiveLanguage');

        // Initial setup check
        expect(useTTSStore.getState().activeLanguage).toBe('en');

        // Set an active lexicon rule to simulate previous playback state
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).activeLexiconRules = [{ target: 'test', replacement: 'replaced' }];

        // Trigger book change
        service.setBookId('book-zh');

        // Yield to allow async internal Promise.all in setBookId to resolve
        await new Promise(process.nextTick);

        // Verify the language was proactively updated
        expect(setActiveLanguageSpy).toHaveBeenCalledWith('zh');
        expect(useTTSStore.getState().activeLanguage).toBe('zh');

        // Verify the lexicon rules were cleared to force a reload for the new language
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((service as any).activeLexiconRules).toBeNull();
    });

    it('should correctly restore language from subscriber if language metadata updates asynchronously', async () => {
        // Initial setup
        service.setBookId('book-en');
        await new Promise(process.nextTick);
        expect(useTTSStore.getState().activeLanguage).toBe('en');

        // Spy
        const setActiveLanguageSpy = vi.spyOn(useTTSStore.getState(), 'setActiveLanguage');

        // Simulate a YJS sync or metadata edit that updates the current book's language
        useBookStore.setState({
            books: {
                'book-en': { bookId: 'book-en', language: 'fr', title: 'English Book translated to French' }
            }
        });

        // Yield to let the subscriber trigger
        await new Promise(process.nextTick);

        expect(setActiveLanguageSpy).toHaveBeenCalledWith('fr');
        expect(useTTSStore.getState().activeLanguage).toBe('fr');
    });
});
