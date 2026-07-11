/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ReaderControlBar — the variant ROUTER over the Phase 8 §C pill feature
 * components. Renders the REAL pills against mocked stores: the routing
 * priorities, annotation action plumbing and navigation are the unit under
 * test. Absorbs (rule 8) the sync-alert/summary assertions of the deleted
 * ui/CompassPill.test.tsx + ui/CompassPill_Accessibility.test.tsx, and
 * pins the §C focus-survives-morph regression (a11y item 8 — the
 * key={variant} remount is gone).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';

// Hoisted mocks for selectors
const { mockUseBook, mockUseLastReadBook, mockUseCurrentDeviceProgress, mockUseRemoteProgress } = vi.hoisted(() => {
  return {
    mockUseBook: vi.fn(),
    mockUseLastReadBook: vi.fn(),
    mockUseCurrentDeviceProgress: vi.fn(),
    mockUseRemoteProgress: vi.fn(),
  };
});

// Mock stores and hooks
const mockUseAnnotationStore = vi.fn();
const mockUseTTSPlaybackStore = vi.fn();
const mockUseReaderUIStore = vi.fn();
const mockUseReadingStateStore = Object.assign(vi.fn(), {
  getState: undefined as (() => unknown) | undefined,
  setState: undefined as ((state: unknown) => unknown) | undefined,
  subscribe: undefined as ((listener: unknown) => unknown) | undefined,
});
const mockUseLibraryStore = vi.fn();
const mockUseToastStore = vi.fn();
const mockUseNavigate = vi.fn();

vi.mock('@store/useAnnotationStore', () => ({
  useAnnotationStore: (selector: unknown) => mockUseAnnotationStore(selector),
}));

vi.mock('@store/useTTSPlaybackStore', () => ({
  useTTSPlaybackStore: (selector: unknown) => mockUseTTSPlaybackStore(selector),
}));

vi.mock('@store/useReaderUIStore', () => ({
  useReaderUIStore: (selector: unknown) => mockUseReaderUIStore(selector),
}));

vi.mock('@store/useReadingStateStore', () => ({
  useReadingStateStore: Object.assign(
    (selector: unknown) => mockUseReadingStateStore(selector),
    {
      getState: () => mockUseReadingStateStore.getState?.() || {},
      setState: (state: unknown) => mockUseReadingStateStore.setState?.(state),
      subscribe: (listener: unknown) => mockUseReadingStateStore.subscribe?.(listener),
    }
  ),
  useCurrentDeviceProgress: (bookId: any) => mockUseCurrentDeviceProgress(bookId),
  useBookProgress: (bookId: any) => mockUseCurrentDeviceProgress(bookId)
}));

// Mock selectors
vi.mock('@store/libraryViewStore', () => ({
  useBook: (id: any) => mockUseBook(id),
  useLastReadBook: () => mockUseLastReadBook(),
  useAllBooks: vi.fn(),
}));

vi.mock('@store/useLibraryStore', () => ({
  useLibraryStore: (selector: unknown) => mockUseLibraryStore(selector),
}));

vi.mock('@store/useBookStore', () => ({
  useBookStore: (selector: any) => selector({ books: {} }),
}));

vi.mock('@store/useToastStore', () => ({
  useToastStore: (selector: unknown) => mockUseToastStore(selector),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockUseNavigate,
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));

vi.mock('@hooks/useRemoteProgress', () => ({
  useRemoteProgress: (bookId: any) => mockUseRemoteProgress(bookId),
}));

vi.mock('@hooks/useSectionDuration', () => ({
  useSectionDuration: () => ({ timeRemaining: 5, progress: 50 }),
}));

vi.mock('@app/tts/useAudioCommands', () => ({
  useAudioCommands: () => ({
    play: vi.fn(),
    pause: vi.fn(),
  }),
}));

// Mock LexiconManager
vi.mock('../LexiconManager', () => ({
  LexiconManager: ({ open, onOpenChange, initialTerm }: any) => (
    open ? (
      <div data-testid="lexicon-manager-mock">
        Lexicon Manager Open: {initialTerm}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : <div data-testid="lexicon-manager-closed" />
  )
}));

const annotationMode = (overrides: Record<string, unknown> = {}) => ({
  mode: 'annotation',
  selection: { x: 0, y: 0, cfiRange: 'cfi', text: 'selected text' },
  ...overrides,
});

const readerUIState = (overrides: Record<string, unknown> = {}) => ({
  immersiveMode: false,
  toc: [],
  currentSectionTitle: null,
  currentSectionId: null,
  currentBookId: null,
  compass: { mode: 'idle' },
  dispatchCompass: vi.fn(),
  ...overrides,
});

describe('ReaderControlBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockUseBook.mockReturnValue(null);
    mockUseLastReadBook.mockReturnValue(null);
    mockUseCurrentDeviceProgress.mockReturnValue(null);
    mockUseRemoteProgress.mockReturnValue(null);

    // Default store states
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }));
    mockUseTTSPlaybackStore.mockImplementation((selector: any) => selector({
      queue: [],
      isPlaying: false,
      status: 'stopped',
      currentIndex: 0,
    }));
    // Popover state moved to the ephemeral reader UI store (popover-desync hotfix).
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState()));
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({ progress: {} }));
    mockUseReadingStateStore.getState = vi.fn().mockReturnValue({
      progress: {},
      getProgress: () => null
    });
    mockUseLibraryStore.mockImplementation((selector: any) => selector({ books: {} }));
    mockUseToastStore.mockImplementation((selector: any) => selector({
      showToast: vi.fn()
    }));
  });

  it('renders nothing when idle (no book, no audio, no annotations)', () => {
    const { container } = render(<ReaderControlBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the annotation pill in annotation mode', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      compass: annotationMode(),
    })));
    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
  });

  it('renders the triage pill with its payload in audio-triage mode', () => {
    // Under the pre-machine model an 'audio-triage' variant could exist
    // without its target annotation and rendered NOTHING (the old
    // stale-variant regression). The machine makes that unrepresentable:
    // audio-triage always carries the bookmark it reviews.
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      compass: {
        mode: 'audio-triage',
        annotation: {
          id: 'bookmark-1',
          bookId: 'book-1',
          cfiRange: 'cfi',
          text: 'bookmarked',
          type: 'audio-bookmark',
          color: 'yellow',
          created: 0,
        },
      },
    })));
    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-triage')).toBeInTheDocument();
  });

  it('a live interaction outranks the sync alert (interaction > ambient)', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      currentBookId: '123',
      compass: annotationMode(),
    })));
    mockUseRemoteProgress.mockReturnValue({
      deviceId: 'phone-1',
      deviceName: 'Phone',
      percentage: 0.45,
      cfi: 'epubcfi(/6/4!/4/2)',
    });
    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
    expect(screen.queryByTestId('compass-pill-sync-alert')).not.toBeInTheDocument();
  });

  it('renders the active audio pill when currentBookId is present (Reader Active)', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      currentSectionTitle: 'Chapter 1',
      currentBookId: '123',
    })));
    mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.5 } : null);

    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-active')).toBeInTheDocument();
    // The book progress override reaches the pill's progress underlay (50%).
    expect(screen.getByTestId('compass-pill-progress-bar')).toHaveStyle({ width: '50%' });
  });

  it('renders the compact audio pill when immersive mode is on', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      immersiveMode: true,
      currentSectionTitle: 'Chapter 1',
      currentBookId: '123',
    })));
    mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.75 } : null);

    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-compact')).toBeInTheDocument();
  });

  it('renders the summary pill when on home with a last-read book (absorbed: descriptive aria-label)', () => {
    mockUseLastReadBook.mockReturnValue({ bookId: '123', id: '123', title: 'Book 123' });
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.25 } : null);

    render(<ReaderControlBar />);

    const pill = screen.getByTestId('compass-pill-summary');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('role', 'button');
    expect(pill).toHaveAttribute(
      'aria-label',
      'Continue reading Book 123, Continue Reading, 25% complete',
    );
    expect(screen.getByText('25% complete')).toBeInTheDocument();
  });

  it('navigates to the book when clicking the summary pill', () => {
    mockUseLastReadBook.mockReturnValue({ bookId: '123', id: '123', title: 'Book 1' });
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.25 } : null);

    render(<ReaderControlBar />);
    fireEvent.click(screen.getByTestId('compass-pill-summary'));
    expect(mockUseNavigate).toHaveBeenCalledWith('/read/123');
  });

  it('renders the sync-alert pill with remote-progress copy and dismisses it (absorbed)', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      currentBookId: '123',
    })));
    mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);
    mockUseRemoteProgress.mockReturnValue({
      deviceId: 'phone-1',
      deviceName: 'Phone',
      percentage: 0.45,
      cfi: 'epubcfi(/6/4!/4/2)',
    });

    render(<ReaderControlBar />);

    const pill = screen.getByTestId('compass-pill-sync-alert');
    expect(pill).toBeInTheDocument();
    expect(screen.getByText('Pick up from Phone?')).toBeInTheDocument();
    expect(screen.getByText('Jump to 45%')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Pick up from Phone?. Jump to 45%' }),
    ).toBeInTheDocument();

    // Dismiss → the alert is replaced by the active pill (priority falls through)
    fireEvent.click(screen.getByLabelText('Dismiss update'));
    expect(screen.queryByTestId('compass-pill-sync-alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('compass-pill-active')).toBeInTheDocument();
  });

  it('handles annotation actions through the real pill buttons', () => {
    const add = vi.fn();
    const dispatchCompass = vi.fn();
    const showToast = vi.fn();

    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      add,
    }));
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      currentBookId: '123',
      compass: annotationMode(),
      dispatchCompass,
    })));
    mockUseToastStore.mockImplementation((selector: any) => selector({
      showToast
    }));

    render(<ReaderControlBar />);

    fireEvent.click(screen.getByTestId('popover-color-yellow'));
    expect(add).toHaveBeenCalledWith({
      type: 'highlight',
      color: 'yellow',
      bookId: '123',
      text: 'selected text',
      cfiRange: 'cfi'
    });
    expect(dispatchCompass).toHaveBeenCalledWith({ type: 'ACTION_COMMITTED' });
  });

  it('opens LexiconManager when the pronounce action is triggered', () => {
    const dispatchCompass = vi.fn();
    mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
      compass: annotationMode({ selection: { x: 0, y: 0, cfiRange: 'cfi', text: 'Desolate' } }),
      dispatchCompass,
    })));

    render(<ReaderControlBar />);

    expect(screen.queryByTestId('lexicon-manager-mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('popover-fix-pronunciation-button'));
    expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    expect(dispatchCompass).toHaveBeenCalledWith({ type: 'ACTION_COMMITTED' });
  });

  describe('regression: focus survives the variant morph (a11y item 8)', () => {
    it('moves focus into the new pill when the focused control unmounts on morph', () => {
      // Start in annotation mode with focus on a toolbar button.
      mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
        currentBookId: '123',
        compass: annotationMode(),
      })));
      mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);

      const { rerender } = render(<ReaderControlBar />);
      const copyButton = screen.getByTestId('popover-copy-button');
      copyButton.focus();
      expect(document.activeElement).toBe(copyButton);

      // Morph: interaction returns to idle → active audio pill replaces the toolbar.
      mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
      })));
      rerender(<ReaderControlBar />);

      const pill = screen.getByTestId('compass-pill-active');
      expect(pill).toBeInTheDocument();
      // Focus did NOT fall to <body>: the router restored it into the pill.
      expect(document.activeElement).not.toBe(document.body);
      expect(pill.contains(document.activeElement)).toBe(true);
    });

    it('does NOT steal focus from a live reader-iframe selection on morph (Android drag)', () => {
      // A reader iframe holding a live, non-collapsed selection (Android
      // long-press). Focusing a pill button here would deactivate the native
      // selection and drop its drag handles.
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      Object.defineProperty(iframe, 'contentWindow', {
        configurable: true,
        value: {
          getSelection: () => ({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'Conclusion',
          }),
        },
      });

      // Start on the active audio pill with focus inside it (sets the
      // "pill had focus" flag the restore keys off).
      mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
      })));
      mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);

      const { rerender } = render(<ReaderControlBar />);
      // The active pill's focusable control is the center toggle (the prev/next
      // arrows are disabled while TTS is idle). Focusing it sets the router's
      // "pill had focus" flag.
      screen.getByTestId('compass-active-toggle').focus();

      // Morph: the user's selection opens the annotation toolbar.
      mockUseReaderUIStore.mockImplementation((selector: any) => selector(readerUIState({
        currentBookId: '123',
        compass: annotationMode({ selection: { x: 0, y: 0, cfiRange: 'cfi', text: 'Conclusion' } }),
      })));
      rerender(<ReaderControlBar />);

      const annotationPill = screen.getByTestId('compass-pill-annotation');
      expect(annotationPill).toBeInTheDocument();
      // Focus must NOT have been pulled into the new pill — the iframe keeps
      // it so the native selection stays active and draggable.
      expect(annotationPill.contains(document.activeElement)).toBe(false);

      document.body.removeChild(iframe);
    });
  });
});
