import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableOfContents } from '../TableOfContents';
import { useReaderStore } from '../../../store/useReaderStore';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../store/useReaderStore');

describe('TableOfContents', () => {
    const mockOnNavigate = vi.fn();
    const mockOnClose = vi.fn();

    const mockToc = [
        { id: '1', label: 'Chapter 1', href: 'chap1.html' },
        { id: '2', label: 'Chapter 2', href: 'chap2.html' }
    ];

    beforeEach(() => {
        (useReaderStore as any).mockReturnValue({
            toc: mockToc,
            currentChapterTitle: 'Chapter 2'
        });
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('renders list of chapters', () => {
        render(<TableOfContents onNavigate={mockOnNavigate} onClose={mockOnClose} />);
        expect(screen.getByText('Chapter 1')).toBeInTheDocument();
        expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    });

    it('highlights active chapter', () => {
        render(<TableOfContents onNavigate={mockOnNavigate} onClose={mockOnClose} />);
        const activeItem = screen.getByText('Chapter 2');
        expect(activeItem).toHaveClass('bg-blue-100');
    });

    it('scrolls active chapter into view', () => {
        render(<TableOfContents onNavigate={mockOnNavigate} onClose={mockOnClose} />);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('navigates when item clicked', () => {
        render(<TableOfContents onNavigate={mockOnNavigate} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Chapter 1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('chap1.html');
        expect(mockOnClose).toHaveBeenCalled();
    });
});
