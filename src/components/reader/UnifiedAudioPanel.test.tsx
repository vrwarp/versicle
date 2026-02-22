/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { Sheet } from '../ui/Sheet';

// Mock stores
const mockUseTTSStore = vi.fn();

vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: (selector: unknown) => mockUseTTSStore(selector),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));

// Mock child components that are complex or not relevant
vi.mock('./TTSQueue', () => ({
  TTSQueue: () => <div data-testid="tts-queue-mock">Queue</div>
}));

vi.mock('./LexiconManager', () => ({
  LexiconManager: () => <div data-testid="lexicon-manager-mock">LexiconManager</div>
}));

describe('UnifiedAudioPanel Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock state for TTS Store
    mockUseTTSStore.mockImplementation((selector: any) => selector({
      isPlaying: false,
      play: vi.fn(),
      pause: vi.fn(),
      rate: 1.5,
      setRate: vi.fn(),
      voice: null,
      setVoice: vi.fn(),
      voices: [],
      loadVoices: vi.fn(),
      seek: vi.fn(),
      providerId: 'local',
      sanitizationEnabled: false,
      setSanitizationEnabled: vi.fn(),
      prerollEnabled: false,
      setPrerollEnabled: vi.fn()
    }));
  });

  it('displays playback speed with role="status" and aria-live="polite"', () => {
    // Wrap in Sheet because UnifiedAudioPanel renders SheetContent
    render(
      <Sheet open={true}>
        <UnifiedAudioPanel />
      </Sheet>
    );

    // Switch to settings view
    const settingsButton = screen.getByTestId('tts-settings-tab-btn');
    fireEvent.click(settingsButton);

    // Find all elements with the text "1.5x"
    const elements = screen.getAllByText('1.5x');

    // Find the one with role="status"
    const statusElement = elements.find(el => el.getAttribute('role') === 'status');

    expect(statusElement).toBeTruthy();
    expect(statusElement).toHaveAttribute('aria-live', 'polite');

    // Find the label
    const speedLabel = screen.getByText('Speed');
    expect(speedLabel).toHaveAttribute('for', 'speed-slider');

    // Find the slider and check accessibility
    const slider = document.getElementById('speed-slider');
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', '1.5x speed');
  });
});
