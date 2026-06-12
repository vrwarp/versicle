/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AnnotationPill suite — absorbs (rule 8) the annotation assertions of the
 * deleted ui/CompassPill.test.tsx and the whole
 * ui/CompassPill_NoteRecall.test.tsx (Phase 8 §C dissolution).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnnotationPill } from './AnnotationPill';
import { useReaderUIStore } from '@store/useReaderUIStore';

vi.mock('@store/useReaderUIStore', () => ({
    useReaderUIStore: vi.fn()
}));

const uiState = (overrides: Record<string, unknown> = {}) => ({
    compassState: {},
    currentBookId: 'book-1',
    currentSectionTitle: 'Chapter 1',
    // Popover state moved here from useAnnotationStore (popover-desync hotfix)
    popover: { visible: true, x: 0, y: 0, cfiRange: '', text: '' },
    ...overrides,
});

const mockStore = (overrides: Record<string, unknown> = {}) => {
    vi.mocked(useReaderUIStore).mockImplementation(((selector: any) =>
        selector(uiState(overrides))) as any);
};

describe('AnnotationPill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStore();
    });

    it('renders accessible color buttons', () => {
        render(<AnnotationPill />);

        const colors = ['yellow', 'green', 'blue', 'red'];
        colors.forEach(color => {
            const button = screen.getByTestId(`popover-color-${color}`);
            expect(button).toBeInTheDocument();
            expect(button).toHaveAttribute('aria-label', `Highlight ${color}`);
            // Verify focus classes are present
            expect(button).toHaveClass('focus-visible:ring-2');
            expect(button).toHaveClass('focus-visible:ring-ring');
            expect(button).toHaveClass('focus-visible:ring-offset-2');
        });
    });

    it('forwards color actions', () => {
        const onAction = vi.fn();
        render(<AnnotationPill onAction={onAction} />);

        fireEvent.click(screen.getByTestId('popover-color-green'));
        expect(onAction).toHaveBeenCalledWith('color', 'green');
    });

    it('renders the vocab entry only for Han selections', () => {
        mockStore({ popover: { visible: true, x: 0, y: 0, cfiRange: '', text: 'plain latin' } });
        const { rerender } = render(<AnnotationPill />);
        expect(screen.queryByTestId('popover-vocab-button')).not.toBeInTheDocument();

        mockStore({ popover: { visible: true, x: 0, y: 0, cfiRange: '', text: '漢字' } });
        rerender(<AnnotationPill />);
        expect(screen.getByTestId('popover-vocab-button')).toBeInTheDocument();
    });

    describe('regression: note recall', () => {
        const annotationWithNote = {
            id: 'note-1',
            cfiRange: 'epubcfi(/6/4[chap1]!/4/2/10/1:0)',
            text: 'RNA encoding them',
            note: 'This is an existing note',
            color: 'yellow',
            type: 'note'
        };

        it('enters editing mode immediately when mounted with a target annotation that has a note', () => {
            mockStore({ compassState: { variant: 'annotation', targetAnnotation: annotationWithNote } });

            render(<AnnotationPill />);

            const textarea = screen.queryByPlaceholderText('Add a note...');
            expect(textarea).toBeInTheDocument();
            expect(textarea).toHaveValue('This is an existing note');
        });

        it('does NOT enter editing mode when the target annotation has no note', () => {
            mockStore({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: { ...annotationWithNote, id: 'highlight-1', note: undefined, type: 'highlight' }
                }
            });

            render(<AnnotationPill />);

            expect(screen.queryByPlaceholderText('Add a note...')).not.toBeInTheDocument();
            expect(screen.getByTestId('popover-color-yellow')).toBeInTheDocument();
        });

        it('repopulates the existing note text when the note button is clicked after cancel', () => {
            mockStore({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: { ...annotationWithNote, note: 'Original Note Content' }
                }
            });

            render(<AnnotationPill />);

            // In edit mode initially (auto-edit on mount with a note)
            expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Original Note Content');

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByPlaceholderText('Add a note...')).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('popover-add-note-button'));
            expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Original Note Content');
        });

        it('updates note text when the target annotation changes while mounted', () => {
            mockStore({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: { ...annotationWithNote, id: 'note-A', note: 'Note A' }
                }
            });

            const { rerender } = render(<AnnotationPill />);
            expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Note A');

            mockStore({
                compassState: {
                    variant: 'annotation',
                    targetAnnotation: { ...annotationWithNote, id: 'note-B', note: 'Note B', color: 'green' }
                }
            });
            rerender(<AnnotationPill />);

            expect(screen.getByPlaceholderText('Add a note...')).toHaveValue('Note B');
        });
    });
});
