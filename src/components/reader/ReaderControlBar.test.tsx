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
// We want to capture props passed to it
vi.mock('../ui/CompassPill', () => ({
  CompassPill: ({ variant, onClick, onAnnotationAction, progress }: any) => (
    <div data-testid={`compass-pill-${variant}`} data-progress={progress} onClick={onClick}>
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
        mockUseAnnotationStore.mockImplementation((selector) => selector({
            popover: { visible: false, text: 'selected text', cfiRange: 'cfi' },
            addAnnotation: vi.fn(),
            hidePopover: vi.fn(),
        }));
        mockUseTTSStore.mockImplementation((selector) => selector({
            queue: [],
            isPlaying: false,
            play: vi.fn(),
        }));
        mockUseReaderStore.mockImplementation((selector) => selector({
            immersiveMode: false,
            currentBookId: null,
            currentSectionTitle: null,
        }));
        mockUseLibraryStore.mockImplementation((selector) => selector({
            books: []
        }));
        mockUseToastStore.mockImplementation((selector) => selector({
            showToast: vi.fn()
        }));
    });

    it('renders nothing when idle (no book, no audio, no annotations)', () => {
        const { container } = render(<ReaderControlBar />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders annotation variant when popover is visible', () => {
        mockUseAnnotationStore.mockImplementation((selector) => selector({
            popover: { visible: true },
            addAnnotation: vi.fn(),
            hidePopover: vi.fn(),
        }));
        render(<ReaderControlBar />);
        expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
    });

    it('renders active variant when currentBookId is present (Reader Active)', () => {
        mockUseReaderStore.mockImplementation((selector) => selector({
            immersiveMode: false,
            currentBookId: '123',
            currentSectionTitle: 'Chapter 1',
        }));
        mockUseLibraryStore.mockImplementation((selector) => selector({
            books: [{ id: '123', title: 'Book 1', progress: 0.5 }]
        }));
        render(<ReaderControlBar />);
        const pill = screen.getByTestId('compass-pill-active');
        expect(pill).toBeInTheDocument();
        // Check progress conversion: 0.5 * 100 = 50
        expect(pill).toHaveAttribute('data-progress', '50');
    });

    it('renders compact variant when immersive mode is on', () => {
        mockUseReaderStore.mockImplementation((selector) => selector({
            immersiveMode: true,
            currentBookId: '123',
            currentSectionTitle: 'Chapter 1',
        }));
        mockUseLibraryStore.mockImplementation((selector) => selector({
            books: [{ id: '123', title: 'Book 1', progress: 0.75 }]
        }));
        render(<ReaderControlBar />);
        const pill = screen.getByTestId('compass-pill-compact');
        expect(pill).toBeInTheDocument();
        // Check progress conversion: 0.75 * 100 = 75
        expect(pill).toHaveAttribute('data-progress', '75');
    });

    it('renders summary variant when on home and has last read book', () => {
        mockUseLibraryStore.mockImplementation((selector) => selector({
            books: [{ id: '1', title: 'Book 1', lastRead: 1000, progress: 0.25 }]
        }));
        render(<ReaderControlBar />);
        const pill = screen.getByTestId('compass-pill-summary');
        expect(pill).toBeInTheDocument();
        // Check progress conversion: 0.25 * 100 = 25
        expect(pill).toHaveAttribute('data-progress', '25');
    });

    it('navigates to book when clicking summary pill', () => {
        mockUseLibraryStore.mockImplementation((selector) => selector({
             books: [{ id: '1', title: 'Book 1', lastRead: 1000, progress: 0.25 }]
        }));
        render(<ReaderControlBar />);
        fireEvent.click(screen.getByTestId('compass-pill-summary'));
        expect(mockUseNavigate).toHaveBeenCalledWith('/read/1');
    });

    it('handles annotation actions', () => {
        const addAnnotation = vi.fn();
        const hidePopover = vi.fn();
        const showToast = vi.fn();

        mockUseAnnotationStore.mockImplementation((selector) => selector({
            popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
            addAnnotation,
            hidePopover,
        }));
        mockUseReaderStore.mockImplementation((selector) => selector({
            immersiveMode: false,
            currentBookId: '123',
        }));
        mockUseLibraryStore.mockImplementation((selector) => selector({
             books: [{ id: '123', title: 'Book 1' }]
        }));
        mockUseToastStore.mockImplementation((selector) => selector({
             showToast
        }));

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
