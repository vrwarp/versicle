import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';

// Mock stores and hooks
const mockUseAnnotationStore = vi.fn();
const mockUseTTSStore = vi.fn();
const mockUseReaderUIStore = vi.fn();
const mockUseReadingStateStore = vi.fn();
const mockUseLibraryStore = vi.fn();
const mockUseToastStore = vi.fn();
const mockUseNavigate = vi.fn();

// Fix paths to be relative to THIS test file (src/components/reader/tests/)
// Target: src/store/... -> ../../../store/...
vi.mock('../../../store/useAnnotationStore', () => ({
  useAnnotationStore: (selector: unknown) => mockUseAnnotationStore(selector),
}));

vi.mock('../../../store/useTTSStore', () => ({
  useTTSStore: (selector: unknown) => mockUseTTSStore(selector),
}));

vi.mock('../../../store/useReaderUIStore', () => ({
  useReaderUIStore: (selector: unknown) => mockUseReaderUIStore(selector),
}));

vi.mock('../../../store/useReadingStateStore', () => ({
  useReadingStateStore: Object.assign(
    (selector: unknown) => mockUseReadingStateStore(selector),
    {
      getState: () => mockUseReadingStateStore.getState?.() || {},
      setState: (state: unknown) => mockUseReadingStateStore.setState?.(state),
      subscribe: (listener: unknown) => mockUseReadingStateStore.subscribe?.(listener),
    }
  )
}));

// Mock selectors
vi.mock('../../../store/selectors', () => ({
  useAllBooks: () => mockUseLibraryStore({ name: 'useAllBooks' }),
}));

vi.mock('../../../store/useLibraryStore', () => ({
  useLibraryStore: (selector: unknown) => mockUseLibraryStore(selector),
}));

vi.mock('../../../store/useToastStore', () => ({
  useToastStore: (selector: unknown) => mockUseToastStore(selector),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockUseNavigate,
}));

vi.mock('zustand/react/shallow', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useShallow: (selector: any) => selector
}));

// Mock LexiconManager (src/components/reader/LexiconManager)
// Path: ../LexiconManager
vi.mock('../LexiconManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LexiconManager: ({ open, onOpenChange, initialTerm }: any) => (
    open ? (
      <div data-testid="lexicon-manager-mock">
        Lexicon Manager Open: {initialTerm}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : <div data-testid="lexicon-manager-closed" />
  )
}));

// Mock CompassPill (src/components/ui/CompassPill)
// Path: ../../ui/CompassPill
vi.mock('../../ui/CompassPill', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CompassPill: ({ variant, onClick, onAnnotationAction, progress }: any) => (
    <div data-testid={`compass-pill-${variant}`} data-progress={progress} onClick={onClick}>
      {variant}
      <button onClick={() => onAnnotationAction && onAnnotationAction('color', 'yellow')}>Color</button>
      <button onClick={() => onAnnotationAction && onAnnotationAction('note', 'test note')}>Note</button>
      <button onClick={() => onAnnotationAction && onAnnotationAction('pronounce')}>Pronounce</button>
    </div>
  ),
  ActionType: {}
}));

describe('ReaderControlBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default store states
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: false, text: 'selected text', cfiRange: 'cfi' },
      add: vi.fn(),
      hidePopover: vi.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseTTSStore.mockImplementation((selector: any) => selector({
      queue: [],
      isPlaying: false,
      play: vi.fn(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: null,
    }));
    // Fix: getProgress returns per-device progress as a function
    mockUseReadingStateStore.getState = vi.fn().mockReturnValue({
      progress: {},
      getProgress: () => null
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      if (typeof selector === 'function') {
        return selector({ books: {} });
      }
      // Return books array by default for useAllBooks or direct access
      return [
        { bookId: '123', id: '123', title: 'Book 1' },
        { bookId: '1', id: '1', title: 'Last Read Book' }
      ];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseToastStore.mockImplementation((selector: any) => selector({
      showToast: vi.fn()
    }));
  });

  it('renders nothing when idle (no book, no audio, no annotations)', () => {
    const { container } = render(<ReaderControlBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders annotation variant when popover is visible', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true },
      add: vi.fn(),
      hidePopover: vi.fn(),
    }));
    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
  });

  it('renders active variant when currentBookId is present (Reader Active)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: 'Chapter 1',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: '123',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      // Mock useAllBooks hook
      if (selector && selector.name === 'useAllBooks') {
        return [{ bookId: '123', id: '123', title: 'Book 1' }];
      }
      // If it's the useLibraryStore selector
      return selector ? selector({ books: {} }) : { books: {} };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => {
      const state = {
        currentBookId: '123',
        progress: { '123': { percentage: 0.5, lastRead: 1000 } }
      };
      // If the component selects progress (e.g. s => s.progress), return it
      // This covers the case where the component uses the hook for reactivity
      return selector(state);
    });
    mockUseReadingStateStore.getState.mockReturnValue({
      progress: {},
      getProgress: (bookId: string) => bookId === '123' ? { percentage: 0.5, lastRead: 1000 } : null
    });

    // Explicitly debug the hook return in the test
    // console.log('Hook selector output:', mockUseReadingStateStore.mock.results); // Can't easily access

    render(<ReaderControlBar />);
    const pill = screen.getByTestId('compass-pill-active');
    expect(pill).toBeInTheDocument();
    // Check progress conversion: 0.5 * 100 = 50
    expect(pill).toHaveAttribute('data-progress', '50');
  });

  it('renders compact variant when immersive mode is on', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: true,
      currentSectionTitle: 'Chapter 1',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: '123',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      if (selector.name === 'useAllBooks') {
        return [{ bookId: '123', id: '123', title: 'Book 1' }];
      }
      return selector({ books: {} });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: '123',
    }));
    mockUseReadingStateStore.getState.mockReturnValue({
      progress: {},
      getProgress: (bookId: string) => bookId === '123' ? { percentage: 0.75 } : null
    });
    render(<ReaderControlBar />);
    const pill = screen.getByTestId('compass-pill-compact');
    expect(pill).toBeInTheDocument();
    // Check progress conversion: 0.75 * 100 = 75
    expect(pill).toHaveAttribute('data-progress', '75');
  });

  it('renders summary variant when on home and has last read book', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      if (selector && selector.name === 'useAllBooks') {
        return [{ bookId: '123', id: '123', title: 'Book 123' }];
      }
      return selector({ books: {} });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: null,
      progress: { '123': { percentage: 0.25, lastRead: 1000 } }
    }));
    mockUseReadingStateStore.getState.mockReturnValue({
      progress: {},
      getProgress: (bookId: string) => bookId === '123' ? { percentage: 0.25, lastRead: 1000 } : null
    });

    render(<ReaderControlBar />);

    // console.log(screen.debug());
    const pill = screen.getByTestId('compass-pill-summary');
    expect(pill).toBeInTheDocument();
    // Check progress conversion: 0.25 * 100 = 25
    expect(pill).toHaveAttribute('data-progress', '25');

    // Verify getState was called (component uses it in useMemo)
    expect(mockUseReadingStateStore.getState).toHaveBeenCalled();
  });

  it('navigates to book when clicking summary pill', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      if (selector && selector.name === 'useAllBooks') {
        return [{ bookId: '123', id: '123', title: 'Book 1' }];
      }
      return selector({ books: {} });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: null,
      progress: { '123': { percentage: 0.25, lastRead: 1000 } }
    }));
    mockUseReadingStateStore.getState.mockReturnValue({
      progress: {},
      getProgress: (bookId: string) => bookId === '123' ? { percentage: 0.25, lastRead: 1000 } : null
    });

    render(<ReaderControlBar />);
    fireEvent.click(screen.getByTestId('compass-pill-summary'));
    expect(mockUseNavigate).toHaveBeenCalledWith('/read/123');
  });

  it('handles annotation actions', () => {
    const add = vi.fn();
    const hidePopover = vi.fn();
    const showToast = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
      add,
      hidePopover,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: '123',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseLibraryStore.mockImplementation((selector: any) => {
      if (selector.name === 'useAllBooks') {
        return [{ bookId: '123', id: '123', title: 'Book 1' }];
      }
      return selector({ books: {} });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({
      currentBookId: '123',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseToastStore.mockImplementation((selector: any) => selector({
      showToast
    }));

    render(<ReaderControlBar />);

    // Test Color Action (via mocked button)
    fireEvent.click(screen.getByText('Color'));
    expect(add).toHaveBeenCalledWith({
      type: 'highlight',
      color: 'yellow',
      bookId: '123',
      text: 'selected text',
      cfiRange: 'cfi'
    });
    expect(hidePopover).toHaveBeenCalled();
  });

  it('opens LexiconManager when pronounce action is triggered', () => {
    const hidePopover = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true, text: 'Desolate', cfiRange: 'cfi' },
      add: vi.fn(),
      hidePopover,
    }));

    render(<ReaderControlBar />);

    // Verify LexiconManager is initially closed
    expect(screen.queryByTestId('lexicon-manager-mock')).not.toBeInTheDocument();

    // Click Pronounce
    fireEvent.click(screen.getByText('Pronounce'));

    // Verify LexiconManager opens with correct text
    expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    expect(screen.getByTestId('lexicon-manager-mock')).toHaveTextContent('Lexicon Manager Open: Desolate');

    // Verify popover is hidden
    expect(hidePopover).toHaveBeenCalled();
  });
});
