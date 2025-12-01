import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedAudioPanel } from '../UnifiedAudioPanel';
import { useTTSStore } from '../../../store/useTTSStore';
import { useReaderStore } from '../../../store/useReaderStore';

// Mock dependencies
vi.mock('../../../store/useTTSStore');
vi.mock('../../../store/useReaderStore');
vi.mock('../TTSQueue', () => ({
  TTSQueue: () => <div data-testid="tts-queue">TTS Queue Component</div>
}));
vi.mock('../LexiconManager', () => ({
  LexiconManager: () => <div data-testid="lexicon-manager">Lexicon Manager</div>
}));
vi.mock('../../ui/Sheet', () => ({
  SheetContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h1>{children}</h1>
}));

describe('UnifiedAudioPanel', () => {
  const mockTTSStore = {
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    rate: 1.0,
    setRate: vi.fn(),
    voice: { id: 'voice1', name: 'Test Voice' },
    setVoice: vi.fn(),
    voices: [
        { id: 'voice1', name: 'Test Voice' },
        { id: 'voice2', name: 'Another Voice' }
    ],
    loadVoices: vi.fn(),
    seek: vi.fn(),
    providerId: 'local',
    sanitizationEnabled: true,
    setSanitizationEnabled: vi.fn(),
    prerollEnabled: false,
    setPrerollEnabled: vi.fn()
  };

  const mockReaderStore = {
      gestureMode: false,
      setGestureMode: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useTTSStore as any).mockReturnValue(mockTTSStore);
    (useReaderStore as any).mockReturnValue(mockReaderStore);
  });

  it('renders correctly', () => {
    render(<UnifiedAudioPanel />);
    expect(screen.getByText('Audio Deck')).toBeInTheDocument();
    expect(screen.getByTestId('tts-queue')).toBeInTheDocument();
  });

  it('switches to settings view', () => {
    render(<UnifiedAudioPanel />);

    // Find settings button in footer
    const settingsButton = screen.getByText('Settings');
    fireEvent.click(settingsButton);

    expect(screen.getByText('Voice & Pace')).toBeInTheDocument();
    expect(screen.queryByTestId('tts-queue')).not.toBeInTheDocument();
  });

  it('renders Gesture Mode toggle in settings', () => {
    render(<UnifiedAudioPanel />);

    // Switch to settings
    fireEvent.click(screen.getByText('Settings'));

    expect(screen.getByText('Gesture Mode (Eyes Free)')).toBeInTheDocument();
  });

  it('toggles Gesture Mode', () => {
    render(<UnifiedAudioPanel />);

    // Switch to settings
    fireEvent.click(screen.getByText('Settings'));

    // Find switch (might need to target label or role)
    // The Switch component usually renders a button with role="switch"
    const gestureSwitch = screen.getAllByRole('switch')[2]; // Assuming 3rd switch (Sanitization, Preroll, Gesture)

    // We can also target by label if structure allows
    // Let's assume standard Radix/UI switch behavior
    fireEvent.click(gestureSwitch);

    expect(mockReaderStore.setGestureMode).toHaveBeenCalledWith(true);
  });
});
