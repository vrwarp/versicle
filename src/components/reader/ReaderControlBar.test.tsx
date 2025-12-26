import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderControlBar } from './ReaderControlBar';

// Mock stores and hooks
const mockUseAnnotationStore = vi.fn();
const mockUseTTSStore = vi.fn();
const mockUseReaderStore = vi.fn();
const mockUseLibraryStore = vi.fn();
const mockUseToastStore = vi.fn();
const mockUseNavigate = vi.fn();

vi.mock('../../store/useAnnotationStore', () => ({
  useAnnotationStore: (selector: any) => mockUseAnnotationStore(selector),
}));

vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: (selector: any) => mockUseTTSStore(selector),
}));

vi.mock('../../store/useReaderStore', () => ({
  useReaderStore: (selector: any) => mockUseReaderStore(selector),
}));

vi.mock('../../store/useLibraryStore', () => ({
  useLibraryStore: (selector: any) => mockUseLibraryStore(selector),
}));

vi.mock('../../store/useToastStore', () => ({
  useToastStore: (selector: any) => mockUseToastStore(selector),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockUseNavigate,
}));

// Mock CompassPill to avoid rendering full child logic
vi.mock('../audio/CompassPill', () => ({
  CompassPill: ({ variant, onClick, onAnnotationAction }: any) => (
    <div data-testid={`compass-pill-${variant}`} onClick={onClick}>
      {variant}
      <button onClick={() => onAnnotationAction && onAnnotationAction('color', 'yellow')}>Color</button>
      <button onClick={() => onAnnotationAction && onAnnotationAction('note', 'test note')}>Note</button>
    </div>
  ),
  ActionType: {}
}));

describe('ReaderControlBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default store states
        mockUseAnnotationStore.mockReturnValue({
            popover: { visible: false, text: 'selected text', cfiRange: 'cfi' },
            addAnnotation: vi.fn(),
            hidePopover: vi.fn(),
        });
        mockUseTTSStore.mockReturnValue({
            queue: [],
            isPlaying: false,
            play: vi.fn(),
        });
        mockUseReaderStore.mockReturnValue({
            immersiveMode: false,
            currentBookId: null,
            currentChapterTitle: null,
        });
        mockUseLibraryStore.mockReturnValue([]); // books
        mockUseToastStore.mockReturnValue(vi.fn()); // showToast
    });

    it('renders nothing when idle (no book, no audio, no annotations)', () => {
        const { container } = render(<ReaderControlBar />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders annotation variant when popover is visible', () => {
        mockUseAnnotationStore.mockReturnValue({
            popover: { visible: true },
            addAnnotation: vi.fn(),
            hidePopover: vi.fn(),
        });
        render(<ReaderControlBar />);
        expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
    });

    it('renders active variant when currentBookId is present (Reader Active)', () => {
        mockUseReaderStore.mockReturnValue({
            immersiveMode: false,
            currentBookId: '123',
            currentChapterTitle: 'Chapter 1',
        });
        mockUseLibraryStore.mockReturnValue([{ id: '123', title: 'Book 1' }]);
        render(<ReaderControlBar />);
        expect(screen.getByTestId('compass-pill-active')).toBeInTheDocument();
    });

    it('renders compact variant when immersive mode is on', () => {
        mockUseReaderStore.mockReturnValue({
            immersiveMode: true,
            currentBookId: '123',
            currentChapterTitle: 'Chapter 1',
        });
        mockUseLibraryStore.mockReturnValue([{ id: '123', title: 'Book 1' }]);
        render(<ReaderControlBar />);
        expect(screen.getByTestId('compass-pill-compact')).toBeInTheDocument();
    });

    it('renders summary variant when on home and has last read book', () => {
        mockUseLibraryStore.mockReturnValue([{ id: '1', title: 'Book 1', lastRead: 1000 }]);
        render(<ReaderControlBar />);
        expect(screen.getByTestId('compass-pill-summary')).toBeInTheDocument();
    });

    it('navigates to book when clicking summary pill', () => {
        mockUseLibraryStore.mockReturnValue([{ id: '1', title: 'Book 1', lastRead: 1000 }]);
        render(<ReaderControlBar />);
        fireEvent.click(screen.getByTestId('compass-pill-summary'));
        expect(mockUseNavigate).toHaveBeenCalledWith('/reader/1');
    });

    it('handles annotation actions', () => {
        const addAnnotation = vi.fn();
        const hidePopover = vi.fn();
        const showToast = vi.fn();

        mockUseAnnotationStore.mockReturnValue({
            popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
            addAnnotation,
            hidePopover,
        });
        mockUseReaderStore.mockReturnValue({
            immersiveMode: false,
            currentBookId: '123',
        });
        mockUseLibraryStore.mockReturnValue([{ id: '123', title: 'Book 1' }]);
        mockUseToastStore.mockReturnValue(showToast);

        render(<ReaderControlBar />);

        // Test Color Action (via mocked button)
        fireEvent.click(screen.getByText('Color'));
        expect(addAnnotation).toHaveBeenCalledWith({
            type: 'highlight',
            color: 'yellow',
            bookId: '123',
            text: 'selected text',
            cfiRange: 'cfi'
        });
        expect(hidePopover).toHaveBeenCalled();
    });
});
