/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';

// Hoisted mocks for selectors
const { mockUseBook, mockUseLastReadBook, mockUseCurrentDeviceProgress } = vi.hoisted(() => {
  return {
    mockUseBook: vi.fn(),
    mockUseLastReadBook: vi.fn(),
    mockUseCurrentDeviceProgress: vi.fn(),
  };
});

// Mock stores and hooks
const mockUseAnnotationStore = vi.fn();
const mockUseTTSStore = vi.fn();
const mockUseReaderUIStore = vi.fn();
const mockUseReadingStateStore = vi.fn();
const mockUseLibraryStore = vi.fn();
const mockUseToastStore = vi.fn();
const mockUseNavigate = vi.fn();

// Fix paths
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
  ),
  useCurrentDeviceProgress: (bookId: any) => mockUseCurrentDeviceProgress(bookId)
}));

// Mock selectors
vi.mock('../../../store/selectors', () => ({
  useBook: (id: any) => mockUseBook(id),
  useLastReadBook: () => mockUseLastReadBook(),
  useAllBooks: vi.fn(),
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
  useShallow: (selector: any) => selector
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

// Mock CompassPill
vi.mock('../../ui/CompassPill', () => ({
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

    // Default mocks
    mockUseBook.mockReturnValue(null);
    mockUseLastReadBook.mockReturnValue(null);
    mockUseCurrentDeviceProgress.mockReturnValue(null);

    // Default store states
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: false, text: 'selected text', cfiRange: 'cfi' },
      add: vi.fn(),
      hidePopover: vi.fn(),
    }));
    mockUseTTSStore.mockImplementation((selector: any) => selector({
      queue: [],
      isPlaying: false,
      play: vi.fn(),
    }));
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: null,
      currentBookId: null,
    }));
    mockUseReadingStateStore.mockImplementation((selector: any) => selector({}));
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

  it('renders annotation variant when popover is visible', () => {
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true },
      add: vi.fn(),
      hidePopover: vi.fn(),
    }));
    render(<ReaderControlBar />);
    expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
  });

  it('renders active variant when currentBookId is present (Reader Active)', () => {
    // Setup current book
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: 'Chapter 1',
      currentBookId: '123',
    }));

    // Mock useBook for the current book
    mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);

    // Mock progress for calculating percentage
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.5 } : null);

    render(<ReaderControlBar />);
    const pill = screen.getByTestId('compass-pill-active');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('data-progress', '50');
  });

  it('renders compact variant when immersive mode is on', () => {
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: true,
      currentSectionTitle: 'Chapter 1',
      currentBookId: '123',
    }));

    mockUseBook.mockImplementation((id) => id === '123' ? { bookId: '123', title: 'Book 1' } : null);

    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.75 } : null);

    render(<ReaderControlBar />);
    const pill = screen.getByTestId('compass-pill-compact');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('data-progress', '75');
  });

  it('renders summary variant when on home and has last read book', () => {
    // Setup Last Read Book
    mockUseLastReadBook.mockReturnValue({ bookId: '123', id: '123', title: 'Book 123' });

    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: null,
      currentBookId: null,
    }));

    // Mock progress
    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.25 } : null);

    render(<ReaderControlBar />);

    const pill = screen.getByTestId('compass-pill-summary');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('data-progress', '25');
  });

  it('navigates to book when clicking summary pill', () => {
    mockUseLastReadBook.mockReturnValue({ bookId: '123', id: '123', title: 'Book 1' });

    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentSectionTitle: null,
      currentBookId: null,
    }));

    mockUseCurrentDeviceProgress.mockImplementation((id) => id === '123' ? { percentage: 0.25 } : null);

    render(<ReaderControlBar />);
    fireEvent.click(screen.getByTestId('compass-pill-summary'));
    expect(mockUseNavigate).toHaveBeenCalledWith('/read/123');
  });

  it('handles annotation actions', () => {
    const add = vi.fn();
    const hidePopover = vi.fn();
    const showToast = vi.fn();

    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
      add,
      hidePopover,
    }));
    mockUseReaderUIStore.mockImplementation((selector: any) => selector({
      immersiveMode: false,
      currentBookId: '123',
    }));

    mockUseToastStore.mockImplementation((selector: any) => selector({
      showToast
    }));

    render(<ReaderControlBar />);

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
    mockUseAnnotationStore.mockImplementation((selector: any) => selector({
      popover: { visible: true, text: 'Desolate', cfiRange: 'cfi' },
      add: vi.fn(),
      hidePopover,
    }));

    render(<ReaderControlBar />);

    expect(screen.queryByTestId('lexicon-manager-mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Pronounce'));
    expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    expect(hidePopover).toHaveBeenCalled();
  });
});
