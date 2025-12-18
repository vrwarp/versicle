import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LexiconManager } from '../LexiconManager';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and other dependencies
vi.mock('../../../lib/tts/LexiconService', () => {
  const mockService = {
    getRules: vi.fn().mockResolvedValue([]),
    saveRule: vi.fn().mockResolvedValue(undefined),
    deleteRule: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    applyLexicon: vi.fn((text, _rules) => text),
  };
  return {
    LexiconService: {
      getInstance: () => mockService,
    },
  };
});

vi.mock('../../../lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: () => ({
      preview: vi.fn(),
    }),
  },
}));

// Mock UI components
vi.mock('../ui/Dialog', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="lexicon-dialog">{children}</div> : null),
}));

vi.mock('../../store/useReaderStore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useReaderStore: (selector: any) => selector({ currentBookId: 'book1' }),
}));

describe('LexiconManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should populate test input when initialTerm is provided', async () => {
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
        initialTerm="Hello"
      />
    );

    // Check if original input is populated
    await waitFor(() => {
        expect(screen.getByTestId('lexicon-input-original')).toHaveValue('Hello');
    });

    // Check if test input is populated
    expect(screen.getByTestId('lexicon-test-input')).toHaveValue('Hello');
  });

  it('should not populate test input when initialTerm is not provided', async () => {
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    // Wait for rules to load (empty)
    await waitFor(() => {
         expect(screen.getByTestId('lexicon-add-rule-btn')).toBeInTheDocument();
    });

    // Inputs should not be visible unless adding, or if we force adding state
    // By default not adding if no initialTerm.
    expect(screen.queryByTestId('lexicon-input-original')).toBeNull();
    expect(screen.getByTestId('lexicon-test-input')).toHaveValue('');
  });

  it('should render test buttons', async () => {
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await waitFor(() => {
        expect(screen.getByTestId('lexicon-test-current-btn')).toBeInTheDocument();
        expect(screen.getByTestId('lexicon-test-all-btn')).toBeInTheDocument();
        expect(screen.getByTestId('lexicon-play-btn')).toBeInTheDocument();
    });
  });

  it('should disable current replacement button when not editing', async () => {
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await waitFor(() => {
        expect(screen.getByTestId('lexicon-test-current-btn')).toBeDisabled();
    });
  });
});
