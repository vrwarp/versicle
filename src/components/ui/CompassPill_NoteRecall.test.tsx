/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompassPill } from './CompassPill';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    ChevronsLeft: () => <span data-testid="icon-chevrons-left" />,
    ChevronsRight: () => <span data-testid="icon-chevrons-right" />,
    Play: () => <span data-testid="icon-play" />,
    Pause: () => <span data-testid="icon-pause" />,
    StickyNote: () => <span data-testid="icon-sticky-note" />,
    Mic: () => <span data-testid="icon-mic" />,
    Copy: () => <span data-testid="icon-copy" />,
    X: () => <span data-testid="icon-x" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Check: () => <span data-testid="icon-check" />,
    Loader2: () => <span data-testid="icon-loader" />,
    BookOpen: () => <span data-testid="icon-book-open" />,
    ArrowUpCircle: () => <span data-testid="icon-arrow-up-circle" />,
    Smartphone: () => <span data-testid="icon-smartphone" />,
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    getDefaultMinSentenceLength: () => 36,
    useTTSStore: vi.fn()
}));

// Mock useReaderUIStore
vi.mock('../../store/useReaderUIStore', () => ({
    useReaderUIStore: vi.fn()
}));

// Mock useSectionDuration
vi.mock('../../hooks/useSectionDuration', () => ({
    useSectionDuration: () => ({
        timeRemaining: 5,
        progress: 50
    })
}));

describe('CompassPill Note Recall', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default TTS Store mock
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            status: 'stopped',
            queue: [],
            currentIndex: 0,
            play: vi.fn(),
            pause: vi.fn()
        } as any);
    });

    it('should enter editing mode immediately when mounted with a target annotation that has a note', () => {
        const mockAnnotation = {
            id: 'note-1',
            cfiRange: 'epubcfi(/6/4[chap1]!/4/2/10/1:0)',
            text: 'RNA encoding them',
            note: 'This is an existing note',
            color: 'yellow',
            type: 'note'
        };

        // Mock UI store to return the annotation
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            return selector({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: mockAnnotation
                },
                currentBookId: 'book-1',
                currentSectionTitle: 'Chapter 1'
            });
        });

        render(<CompassPill variant="annotation" />);

        // If bug exists, it will show the annotation toolbar (with color dots) 
        // instead of the textarea.
        // If fixed, it will show the textarea with the note text.
        
        const textarea = screen.queryByPlaceholderText('Add a note...');
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveValue('This is an existing note');
    });

    it('should NOT enter editing mode when mounted with a target annotation that has no note', () => {
        const mockAnnotation = {
            id: 'highlight-1',
            cfiRange: 'epubcfi(/6/4[chap1]!/4/2/10/1:0)',
            text: 'RNA encoding them',
            color: 'yellow',
            type: 'highlight' // No note property
        };

        // Mock UI store to return the annotation
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            return selector({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: mockAnnotation
                },
                currentBookId: 'book-1',
                currentSectionTitle: 'Chapter 1'
            });
        });

        render(<CompassPill variant="annotation" />);

        // Should NOT show the textarea
        const textarea = screen.queryByPlaceholderText('Add a note...');
        expect(textarea).not.toBeInTheDocument();

        // Should show color swatches (one way to verify it's the toolbar)
        expect(screen.getByTestId('popover-color-yellow')).toBeInTheDocument();
    });

    it('should populate existing note text when the note button is clicked manually', () => {
        const mockAnnotation = {
            id: 'note-1',
            cfiRange: 'epubcfi(/6/4[chap1]!/4/2/10/1:0)',
            text: 'RNA encoding them',
            note: 'Original Note Content',
            color: 'yellow',
            type: 'note'
        };

        // Mock UI store to return the annotation
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            return selector({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: mockAnnotation
                },
                currentBookId: 'book-1',
                currentSectionTitle: 'Chapter 1'
            });
        });

        // We need to render it in a way that it's NOT in edit mode first, or simulate cancelling.
        // Actually, if we just render it, it WILL enter edit mode because of the auto-edit logic I just added.
        // So we simulate clicking "Cancel" first.
        
        render(<CompassPill variant="annotation" />);
        
        // Should be in edit mode initially due to my previous fix
        expect(screen.getByPlaceholderText('Add a note...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Original Note Content');

        // Click Cancel
        fireEvent.click(screen.getByText('Cancel'));
        
        // Now it should show the toolbar
        expect(screen.queryByPlaceholderText('Add a note...')).not.toBeInTheDocument();
        expect(screen.getByTestId('popover-add-note-button')).toBeInTheDocument();

        // Click the note button again
        fireEvent.click(screen.getByTestId('popover-add-note-button'));

        // It should show the editor WITH the original text
        const textarea = screen.getByPlaceholderText('Add a note...');
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveValue('Original Note Content');
    });

    it('should update note text when the target annotation changes while mounted', () => {
        const annotationA = {
            id: 'note-A',
            cfiRange: 'epubcfi(/6/1)',
            text: 'Text A',
            note: 'Note A',
            color: 'yellow',
            type: 'note'
        };
        const annotationB = {
            id: 'note-B',
            cfiRange: 'epubcfi(/6/2)',
            text: 'Text B',
            note: 'Note B',
            color: 'green',
            type: 'note'
        };

        // 1. Initial State: Annotation A
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            return selector({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: annotationA
                },
                currentBookId: 'book-1',
                currentSectionTitle: 'Chapter 1'
            });
        });

        const { rerender } = render(<CompassPill variant="annotation" />);
        expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Note A');

        // 2. State Change: Annotation B
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            return selector({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: annotationB
                },
                currentBookId: 'book-1',
                currentSectionTitle: 'Chapter 1'
            });
        });

        // Trigger re-render with the same variant (so it doesn't remount, but checks the if block)
        rerender(<CompassPill variant="annotation" />);

        expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Note B');
    });
});
