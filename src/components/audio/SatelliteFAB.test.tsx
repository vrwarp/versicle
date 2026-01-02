
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SatelliteFAB } from './SatelliteFAB';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useTTSStore, TTSStore } from '../../store/useTTSStore';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Play: () => <span data-testid="icon-play" />,
    Pause: () => <span data-testid="icon-pause" />,
    Loader2: ({ className }: { className?: string }) => <span data-testid="icon-loader" className={className} />,
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
    useShallow: (selector: (state: unknown) => unknown) => selector
}));

describe('SatelliteFAB', () => {
    const mockPlay = vi.fn();
    const mockPause = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Play icon when stopped', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            status: 'stopped',
            play: mockPlay,
            pause: mockPause
        } as unknown as TTSStore);

        render(<SatelliteFAB />);
        expect(screen.getByTestId('icon-play')).toBeInTheDocument();
        expect(screen.queryByTestId('icon-pause')).not.toBeInTheDocument();
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });

    it('renders Pause icon when playing', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: true,
            status: 'playing',
            play: mockPlay,
            pause: mockPause
        } as unknown as TTSStore);

        render(<SatelliteFAB />);
        expect(screen.getByTestId('icon-pause')).toBeInTheDocument();
        expect(screen.queryByTestId('icon-play')).not.toBeInTheDocument();
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });

    it('renders Loader icon when loading', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: true, // store treats loading as playing
            status: 'loading',
            play: mockPlay,
            pause: mockPause
        } as unknown as TTSStore);

        render(<SatelliteFAB />);
        expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
        expect(screen.queryByTestId('icon-play')).not.toBeInTheDocument();
        expect(screen.queryByTestId('icon-pause')).not.toBeInTheDocument();
    });

    it('has loading state class when loading', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: true,
            status: 'loading',
            play: mockPlay,
            pause: mockPause
        } as unknown as TTSStore);

        render(<SatelliteFAB />);
        const button = screen.getByTestId('satellite-fab');
        expect(button.className).toContain('cursor-wait');
    });
});
