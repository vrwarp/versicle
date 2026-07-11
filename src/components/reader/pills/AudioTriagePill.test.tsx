/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AudioTriagePill } from './AudioTriagePill';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useAnnotationStore } from '@store/useAnnotationStore';

vi.mock('@store/useReaderUIStore', () => ({
    useReaderUIStore: vi.fn()
}));

vi.mock('@store/useAnnotationStore', () => ({
    useAnnotationStore: vi.fn()
}));

describe('AudioTriagePill', () => {
    const mockAdd = vi.fn();
    const mockRemove = vi.fn();
    const mockDispatchCompass = vi.fn();

    const annotation = {
        id: 'ab-1',
        bookId: 'book-1',
        cfiRange: 'cfi-1',
        text: 'Test Bookmark Text',
        type: 'audio-bookmark' as const,
        color: 'orange',
        created: 987654321
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock useReaderUIStore behavior (compass machine — see store/compassMachine.ts)
        vi.mocked(useReaderUIStore).mockImplementation((selector: any) => {
            const state = {
                compass: {
                    mode: 'audio-triage' as const,
                    annotation
                },
                dispatchCompass: mockDispatchCompass
            };
            return selector(state);
        });

        // Mock useAnnotationStore behavior
        vi.mocked(useAnnotationStore).mockImplementation((selector: any) => {
            const state = {
                add: mockAdd,
                remove: mockRemove
            };
            return selector(state);
        });
    });

    it('renders the triage UI with the bookmark text', () => {
        render(<AudioTriagePill />);
        expect(screen.getByText('Review Bookmark')).toBeInTheDocument();
        expect(screen.getByText('Confirm')).toBeInTheDocument();
        expect(screen.getByText('Discard')).toBeInTheDocument();
    });

    it('removes audio bookmark and adds highlight preserving original created timestamp on confirm', () => {
        render(<AudioTriagePill />);
        
        fireEvent.click(screen.getByText('Confirm'));

        expect(mockRemove).toHaveBeenCalledWith('ab-1');
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            id: 'ab-1',
            bookId: 'book-1',
            cfiRange: 'cfi-1',
            text: 'Test Bookmark Text',
            type: 'highlight',
            color: 'orange',
            created: 987654321
        }));
        expect(mockDispatchCompass).toHaveBeenCalledWith({ type: 'ACTION_COMMITTED' });
    });

    it('discards the audio bookmark and returns the compass to idle on discard', () => {
        render(<AudioTriagePill />);

        fireEvent.click(screen.getByText('Discard'));

        expect(mockRemove).toHaveBeenCalledWith('ab-1');
        expect(mockDispatchCompass).toHaveBeenCalledWith({ type: 'ACTION_COMMITTED' });
    });
});
