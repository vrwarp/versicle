import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LexiconManager } from '../LexiconManager';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from '../../../lib/tts/LexiconService';

// Mock DB and other dependencies
vi.mock('../../../lib/tts/LexiconService', () => {
  const mockService = {
    getRules: vi.fn().mockResolvedValue([]),
    saveRule: vi.fn().mockResolvedValue(undefined),
    deleteRule: vi.fn().mockResolvedValue(undefined),
    applyLexicon: vi.fn((text, rules) => text),
  };
  return {
    LexiconService: {
      getInstance: () => mockService,
    },
  };
});

// Mock UI components
vi.mock('../ui/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="lexicon-dialog">{children}</div> : null),
}));

vi.mock('../../store/useReaderStore', () => ({
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
});
