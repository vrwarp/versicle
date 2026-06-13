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
vi.mock('@store/useReaderUIStore', () => ({
    useReaderUIStore: (selector: any) => {
        const state = {
            currentBookId: null,
            currentSectionTitle: 'Test Chapter',
            toc: [],
            popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' }
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
        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector ? selector(playbackState()) : playbackState()) as any);
    });

    describe('regression: chapter nav routes through the ReaderCommands registry', () => {
        it('calls prevChapter when "prev" is clicked and not playing', () => {
            const { commands, unregister } = registerFakeCommands();
            try {
                render(<AudioPill />);

                fireEvent.click(screen.getByRole('button', { name: 'Previous chapter' }));

                expect(commands.prevChapter).toHaveBeenCalledTimes(1);
                expect(commands.nextChapter).not.toHaveBeenCalled();
            } finally {
                unregister();
            }
        });

        it('calls nextChapter when "next" is clicked and not playing', () => {
            const { commands, unregister } = registerFakeCommands();
            try {
                render(<AudioPill />);

                fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));

                expect(commands.nextChapter).toHaveBeenCalledTimes(1);
            } finally {
                unregister();
            }
        });

        it('calls nextChapter while playing (pill stays TTS-agnostic)', () => {
            // The TTS-aware routing lives INSIDE the reader's nextChapter
            // command, not in the pill (it replaced the reader:chapter-nav
            // CustomEvent the same way).
            vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
                selector(playbackState({ isPlaying: true, currentIndex: 5 }))) as any);

            const { commands, unregister } = registerFakeCommands();
            try {
                render(<AudioPill />);

                fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));

                expect(commands.nextChapter).toHaveBeenCalledTimes(1);
                expect(mockJumpTo).not.toHaveBeenCalled();
            } finally {
                unregister();
            }
        });

        it('nav arrows are no-ops when no reader is open (empty registry)', () => {
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

    it('has consistent nav aria-labels across playback states', () => {
        const { rerender } = render(<AudioPill />);

        expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next chapter' })).toBeInTheDocument();

        vi.mocked(useTTSPlaybackStore).mockImplementation(((selector: any) =>
            selector(playbackState({ isPlaying: true }))) as any);
        rerender(<AudioPill />);

        expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next chapter' })).toBeInTheDocument();
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
});
