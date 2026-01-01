import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { BookCard } from './BookCard';
import type { BookMetadata } from '../../types/db';

// Mock BookActionMenu
vi.mock('./BookActionMenu', () => ({
    BookActionMenu: ({ children, onDelete, onOffload, onRestore, book }: any) => (
        <div data-testid="mock-book-action-menu">
            {/* Simulate the trigger wrapper behavior without invalid nesting */}
            <div data-testid="menu-wrapper" onClick={(e) => e.stopPropagation()}>
                {children}
            </div>

            {/* Mocked menu items (usually hidden, but visible for test) */}
            <button data-testid="menu-delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
            <button data-testid="menu-offload" onClick={(e) => { e.stopPropagation(); onOffload(); }}>Offload</button>
            <button data-testid="menu-restore" onClick={(e) => { e.stopPropagation(); onRestore(); }}>Restore</button>
        </div>
    )
}));

describe('BookCard', () => {
  const mockBook: BookMetadata = {
    id: '1',
    title: 'Test Title',
    author: 'Test Author',
    description: 'Test Description',
    addedAt: 1234567890,
    coverBlob: new Blob(['mock-image'], { type: 'image/jpeg' }),
  };

  const mockOnDelete = vi.fn();
  const mockOnOffload = vi.fn();
  const mockOnRestore = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</BrowserRouter>);
  };

  const renderCard = (book = mockBook) => {
    return renderWithRouter(
      <BookCard
        book={book}
        onDelete={mockOnDelete}
        onOffload={mockOnOffload}
        onRestore={mockOnRestore}
      />
    );
  };

  it('should render book info', () => {
    renderCard();

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
  });

  it('should render cover image if blob is present', () => {
    renderCard();

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', `/__versicle__/covers/${mockBook.id}`);
    expect(img).toHaveAttribute('alt', 'Cover of Test Title');
  });

  it('should render placeholder if no cover blob', () => {
    const bookWithoutCover = { ...mockBook, coverBlob: undefined };
    renderCard(bookWithoutCover);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Aa')).toBeInTheDocument();
  });

  it('should render progress bar when progress > 0', () => {
    const bookWithProgress = { ...mockBook, progress: 0.45 };
    renderCard(bookWithProgress);

    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveStyle({ width: '45%' });

    const progressContainer = screen.getByRole('progressbar');
    expect(progressContainer).toBeInTheDocument();
    expect(progressContainer).toHaveAttribute('aria-valuenow', '45');
    expect(progressContainer).toHaveAttribute('aria-valuemin', '0');
    expect(progressContainer).toHaveAttribute('aria-valuemax', '100');
    expect(progressContainer).toHaveAttribute('aria-label', 'Reading progress: 45%');
  });

  it('should not render progress bar when progress is 0 or undefined', () => {
    const bookWithZeroProgress = { ...mockBook, progress: 0 };
    renderCard(bookWithZeroProgress);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();

    const bookWithUndefinedProgress = { ...mockBook, progress: undefined };
    renderCard(bookWithUndefinedProgress);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });

  it('should have accessibility attributes', () => {
    renderCard();

    const card = screen.getByTestId(`book-card-${mockBook.id}`);
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabIndex', '0');

    expect(screen.getByTestId('mock-book-action-menu')).toBeInTheDocument();
  });

  it('should trigger onDelete when delete menu item is clicked', async () => {
    renderCard();

    const deleteButton = screen.getByTestId('menu-delete');

    await act(async () => {
      fireEvent.click(deleteButton);
    });

    expect(mockOnDelete).toHaveBeenCalledWith(mockBook);
  });
});
