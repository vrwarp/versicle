import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LexiconManager } from '../LexiconManager';
import { LexiconService } from '@lib/tts/LexiconService';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and other dependencies
vi.mock('@lib/tts/LexiconService', () => {
  const mockService = {
    getRules: vi.fn().mockResolvedValue([]),
    saveRule: vi.fn().mockResolvedValue(undefined),
    deleteRule: vi.fn().mockResolvedValue(undefined),
     
    applyLexicon: vi.fn((text, _rules) => text),
    getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
    setBibleLexiconPreference: vi.fn().mockResolvedValue(undefined),
  };
  return {
    LexiconService: {
      getInstance: () => mockService,
    },
  };
});

vi.mock('@lib/tts/AudioPlayerService', () => ({
  AudioPlayerService: {
    getInstance: () => ({
      preview: vi.fn(),
      subscribe: vi.fn(),
      setRate: vi.fn(),
      setVoice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

// Mock UI components
vi.mock('../../ui/Dialog', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="lexicon-dialog">{children}</div> : null),
}));

vi.mock('../../store/useReadingStateStore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useReadingStateStore: (selector: any) => selector({ }),
}));

vi.mock('../../store/useReaderUIStore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useReaderUIStore: (selector: any) => selector({ currentBookId: 'book1' }),
}));

// Mock export
vi.mock('@lib/export', () => ({
  exportFile: vi.fn(),
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

  it('should call exportFile when export button is clicked', async () => {
    const { exportFile } = await import('@lib/export');
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    const exportBtn = screen.getByTestId('lexicon-export');
    expect(exportBtn).toBeInTheDocument();

    // Simulate click
    exportBtn.click();

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalled();
    });
  });

  it('persists the per-rule language selection on save (regression: language was dropped)', async () => {
    const saveRule = vi.mocked(LexiconService.getInstance().saveRule);

    render(<LexiconManager open={true} onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('lexicon-add-rule-btn'));
    fireEvent.change(screen.getByTestId('lexicon-input-original'), { target: { value: 'ChineseWord' } });
    fireEvent.change(screen.getByTestId('lexicon-input-replacement'), { target: { value: 'Replaced' } });
    fireEvent.change(screen.getByTestId('lexicon-rule-language-select'), { target: { value: 'zh' } });
    fireEvent.click(screen.getByTestId('lexicon-save-rule-btn'));

    await waitFor(() => {
      expect(saveRule).toHaveBeenCalledWith(expect.objectContaining({
        original: 'ChineseWord',
        replacement: 'Replaced',
        language: 'zh',
      }));
    });
  });

  it('shows the "This Book" scope tab only when a book context is active', async () => {
    // With no active book the per-book scope is hidden...
    const { unmount } = render(<LexiconManager open={true} onOpenChange={vi.fn()} />);
    await screen.findByTestId('lexicon-add-rule-btn');
    expect(screen.queryByRole('tab', { name: 'This Book' })).toBeNull();
    unmount();

    // ...and reachable once a book is the active reader context (which the
    // nested /read/:id/settings route now preserves while settings is open).
    useReaderUIStore.setState({ currentBookId: 'book1' });
    try {
      render(<LexiconManager open={true} onOpenChange={vi.fn()} />);
      expect(await screen.findByRole('tab', { name: 'This Book' })).toBeInTheDocument();
    } finally {
      useReaderUIStore.setState({ currentBookId: null });
    }
  });

  it('should call exportFile when download sample button is clicked', async () => {
    const { exportFile } = await import('@lib/export');
    render(
      <LexiconManager
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    const sampleBtn = screen.getByTestId('lexicon-download-sample');
    expect(sampleBtn).toBeInTheDocument();

    // Simulate click
    sampleBtn.click();

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalled();
    });
  });
});
