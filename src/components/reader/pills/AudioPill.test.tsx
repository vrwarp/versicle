/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AudioPill suite — absorbs (rule 8) the active/compact assertions of the
 * deleted ui/CompassPill.test.tsx and ui/CompassPill_Accessibility.test.tsx
 * (the pill dissolved into feature components in Phase 8 §C).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AudioPill } from './AudioPill';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { registerReaderCommands } from '@domains/reader/ui/ReaderCommands';

// Mock the ephemeral playback store (the component's only TTS store read)
vi.mock('@store/useTTSPlaybackStore', () => ({
    useTTSPlaybackStore: vi.fn()
}));

// Mock the command facade (engine commands moved off the store at 5b-PR1)
const { mockJumpTo, mockPlay, mockPause } = vi.hoisted(() => ({
    mockJumpTo: vi.fn(),
    mockPlay: vi.fn(),
    mockPause: vi.fn(),
}));
vi.mock('@app/tts/useAudioCommands', () => ({
    useAudioCommands: () => ({
        jumpTo: mockJumpTo,
        play: mockPlay,
        pause: mockPause,
    }),
}));

// Mock useReaderUIStore with selector support
const { mockSetFollowingAudio, readerUIState } = vi.hoisted(() => ({
    mockSetFollowingAudio: vi.fn(),
    readerUIState: { followingAudio: true },
}));
vi.mock('@store/useReaderUIStore', () => ({
    useReaderUIStore: (selector: any) => {
        const state = {
            currentBookId: null,
            currentSectionTitle: 'Test Chapter',
            toc: [],
            popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' },
            followingAudio: readerUIState.followingAudio,
            setFollowingAudio: mockSetFollowingAudio,
        };
        return selector ? selector(state) : state;
    }
}));

vi.mock('@store/useBookStore', () => ({
    useBookStore: (selector: any) => selector({ books: {} }),
}));

// Mock useSectionDuration
vi.mock('@hooks/useSectionDuration', () => ({
    useSectionDuration: () => ({
        timeRemaining: 5.5, // 5m 30s
        progress: 50
    })
}));

/**
 * Installs a fake ReaderCommands object in the registry — the stand-in for
 * the reader shell's ReaderCommandsProvider (the pill is mounted OUTSIDE
 * the reader tree, so it consumes the registry, not the context).
 */
function registerFakeCommands() {
    const commands = {
        jumpTo: vi.fn(),
        nextPage: vi.fn(),
        prevPage: vi.fn(),
        nextChapter: vi.fn(),
        prevChapter: vi.fn(),
        playFromSelection: vi.fn(),
        refineSelection: vi.fn(() => null),
    };
    const unregister = registerReaderCommands(commands);
    return { commands, unregister };
}

const playbackState = (overrides: Record<string, unknown> = {}) => ({
    isPlaying: false,
    status: 'stopped',
    queue: [{ title: 'Item 1' }],
    currentIndex: 0,
    ...overrides,
});

describe('AudioPill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        readerUIState.followingAudio = true;
        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector ? selector(playbackState()) : playbackState()) as any);
    });

    describe('chapter nav: pure audio transport (rework Phase 1)', () => {
        it('disables the arrows when there is no audio session', () => {
            const { commands, unregister } = registerFakeCommands();
            try {
                render(<AudioPill />); // default playbackState: status 'stopped'

                const prev = screen.getByRole('button', { name: 'Previous chapter' });
                const next = screen.getByRole('button', { name: 'Next chapter' });
                expect(prev).toBeDisabled();
                expect(next).toBeDisabled();

                // Page turning is no longer one of the pill's jobs — it moved to
                // the reading surface (PageTurnRails + the Arrow-key shortcuts).
                fireEvent.click(prev);
                fireEvent.click(next);
                expect(commands.prevChapter).not.toHaveBeenCalled();
                expect(commands.nextChapter).not.toHaveBeenCalled();
            } finally {
                unregister();
            }
        });

        it('routes through the registry when audio is active', () => {
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ isPlaying: true, status: 'playing', currentIndex: 5 }))) as any);

            const { commands, unregister } = registerFakeCommands();
            try {
                render(<AudioPill />);

                fireEvent.click(screen.getByRole('button', { name: 'Previous chapter' }));
                fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));

                expect(commands.prevChapter).toHaveBeenCalledTimes(1);
                expect(commands.nextChapter).toHaveBeenCalledTimes(1);
                // The TTS-aware routing lives inside the reader command, not the
                // pill — the pill never reaches for the engine directly.
                expect(mockJumpTo).not.toHaveBeenCalled();
            } finally {
                unregister();
            }
        });

        it('nav arrows are no-ops when no reader is open (empty registry)', () => {
            // Audio active so the arrows are enabled, but no reader registered:
            // the click must be a safe no-op (the legacy listener absence).
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ isPlaying: true, status: 'playing' }))) as any);

            render(<AudioPill />);
            expect(() =>
                fireEvent.click(screen.getByRole('button', { name: 'Next chapter' })),
            ).not.toThrow();
        });
    });

    it('shows the playback indicator (play vs pause icon) in active mode', () => {
        const { rerender } = render(<AudioPill />);

        expect(screen.getByTestId('active-play-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('active-pause-icon')).not.toBeInTheDocument();

        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector(playbackState({ isPlaying: true }))) as any);
        rerender(<AudioPill />);

        expect(screen.getByTestId('active-pause-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('active-play-icon')).not.toBeInTheDocument();
    });

    it('nav arrows carry one stable meaning ("chapter"), enabled only with audio', () => {
        // Idle: present but disabled — the arrows are audio transport and there
        // is no audio session to skip through. The name never flips to "page"
        // under the user (page turns live on the reading surface now).
        const { rerender } = render(<AudioPill />);

        expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next chapter' })).toBeDisabled();

        // Audio active: same names, now enabled.
        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector(playbackState({ isPlaying: true, status: 'playing' }))) as any);
        rerender(<AudioPill />);

        expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Next chapter' })).toBeEnabled();
    });

    it('active mode: aria-label is descriptive (section + time remaining)', () => {
        render(<AudioPill title="My Book" subtitle="Chapter 1" />);

        const toggleButton = screen.getByTestId('compass-active-toggle');
        expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('Play Chapter 1'));
        expect(toggleButton).toHaveAttribute('aria-label', expect.stringContaining('5 minutes 30 seconds remaining'));
    });

    it('active mode: aria-label changes on loading', () => {
        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector(playbackState({ status: 'loading', queue: [] }))) as any);

        render(<AudioPill />);
        expect(screen.getByTestId('compass-active-toggle')).toHaveAttribute('aria-label', 'Loading...');
    });

    it('renders compact mode and toggles play', () => {
        render(<AudioPill compact title="Compact Book" />);

        expect(screen.getByTestId('compass-pill-compact')).toBeInTheDocument();
        const playButton = screen.getByLabelText('Play Compact Book');
        fireEvent.click(playButton);
        expect(mockPlay).toHaveBeenCalled();
    });

    it('pauses when playing in compact mode', () => {
        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector(playbackState({ isPlaying: true }))) as any);

        render(<AudioPill compact title="Compact Book" />);
        fireEvent.click(screen.getByLabelText('Pause Compact Book'));
        expect(mockPause).toHaveBeenCalled();
    });

    describe('audio-follow re-center button', () => {
        it('is hidden while following the audio', () => {
            readerUIState.followingAudio = true;
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ status: 'playing', isPlaying: true }))) as any);

            render(<AudioPill />);
            expect(screen.queryByTestId('audio-recenter-button')).not.toBeInTheDocument();
        });

        it('is hidden when audio is stopped, even if not following', () => {
            readerUIState.followingAudio = false;
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ status: 'stopped' }))) as any);

            render(<AudioPill />);
            expect(screen.queryByTestId('audio-recenter-button')).not.toBeInTheDocument();
        });

        it('appears once the user has scrolled away during playback', () => {
            readerUIState.followingAudio = false;
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ status: 'playing', isPlaying: true }))) as any);

            render(<AudioPill />);
            expect(screen.getByTestId('audio-recenter-button')).toBeInTheDocument();
        });

        it('re-engages following when clicked', () => {
            readerUIState.followingAudio = false;
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ status: 'playing', isPlaying: true }))) as any);

            render(<AudioPill />);
            fireEvent.click(screen.getByTestId('audio-recenter-button'));
            expect(mockSetFollowingAudio).toHaveBeenCalledWith(true);
        });

        it('also surfaces in compact (immersive) mode', () => {
            readerUIState.followingAudio = false;
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ status: 'playing', isPlaying: true }))) as any);

            render(<AudioPill compact />);
            expect(screen.getByTestId('audio-recenter-button')).toBeInTheDocument();
        });
    });
});
