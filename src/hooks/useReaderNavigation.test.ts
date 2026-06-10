import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReaderNavigation } from './useReaderNavigation';
import type { TTSStatus } from '../lib/tts/AudioPlayerService';

// Mock the TTS store: the hook only reads getState().status
const mockGetState = vi.fn();

vi.mock('../store/useTTSStore', () => ({
    useTTSStore: Object.assign(vi.fn(), {
        getState: () => mockGetState(),
    }),
}));

describe('useReaderNavigation', () => {
    const handlePrev = vi.fn();
    const handleNext = vi.fn();

    const setStatus = (status: TTSStatus) => {
        mockGetState.mockReturnValue({ status });
    };

    const renderNav = (rendition: unknown = null) =>
        renderHook(() =>
            useReaderNavigation({
                rendition,
                readerViewMode: 'paginated',
                handlePrev,
                handleNext,
                scrollWrapperRef: { current: null },
                viewerRef: { current: null },
            })
        );

    beforeEach(() => {
        vi.clearAllMocks();
        setStatus('stopped');
    });

    it('turns the page on ArrowRight/ArrowLeft when TTS is stopped', () => {
        renderNav();

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(handleNext).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(handlePrev).toHaveBeenCalledTimes(1);
    });

    it('ignores key auto-repeat', () => {
        renderNav();
        fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
        expect(handleNext).not.toHaveBeenCalled();
    });

    it('ignores arrows while typing in an input field', () => {
        renderNav();

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true });
        expect(handleNext).not.toHaveBeenCalled();

        document.body.removeChild(input);
    });

    describe('regression: overlapping global keyboard registries (keyboard-gating hotfix)', () => {
        it('does not turn the page on arrows while TTS is playing (ReaderTTSController owns them)', () => {
            setStatus('playing');
            renderNav();

            fireEvent.keyDown(window, { key: 'ArrowRight' });
            fireEvent.keyDown(window, { key: 'ArrowLeft' });

            expect(handleNext).not.toHaveBeenCalled();
            expect(handlePrev).not.toHaveBeenCalled();
        });

        it('does not turn the page on arrows while TTS is paused', () => {
            setStatus('paused');
            renderNav();

            fireEvent.keyDown(window, { key: 'ArrowRight' });
            expect(handleNext).not.toHaveBeenCalled();
        });

        it('keeps turning pages in TTS states that do not own the arrows (loading/completed/stopped)', () => {
            renderNav();

            for (const status of ['loading', 'completed', 'stopped'] as const) {
                setStatus(status);
                fireEvent.keyDown(window, { key: 'ArrowRight' });
            }

            expect(handleNext).toHaveBeenCalledTimes(3);
        });

        it('resumes page turns as soon as TTS stops, without re-mounting', () => {
            setStatus('playing');
            renderNav();

            fireEvent.keyDown(window, { key: 'ArrowRight' });
            expect(handleNext).not.toHaveBeenCalled();

            setStatus('stopped');
            fireEvent.keyDown(window, { key: 'ArrowRight' });
            expect(handleNext).toHaveBeenCalledTimes(1);
        });

        it('gates the rendition (iframe) keydown listener the same way', () => {
            const rendition = { on: vi.fn(), off: vi.fn() };
            renderNav(rendition);

            expect(rendition.on).toHaveBeenCalledWith('keydown', expect.any(Function));
            const renditionHandler = rendition.on.mock.calls[0][1] as (e: Event) => void;
            const makeEvent = () =>
                ({ key: 'ArrowRight', repeat: false, cancelable: false, target: null }) as unknown as Event;

            setStatus('playing');
            renditionHandler(makeEvent());
            expect(handleNext).not.toHaveBeenCalled();

            setStatus('stopped');
            renditionHandler(makeEvent());
            expect(handleNext).toHaveBeenCalledTimes(1);
        });
    });
});
