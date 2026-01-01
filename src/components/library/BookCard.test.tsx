import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { BookCard } from './BookCard';
import type { BookMetadata } from '../../types/db';

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
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    vi.clearAllMocks();
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</BrowserRouter>);
  };

  const defaultProps = {
      book: mockBook,
      onDelete: mockOnDelete,
      onOffload: mockOnOffload,
      onRestore: mockOnRestore
  };

  it('should render book info', () => {
    renderWithRouter(<BookCard {...defaultProps} />);

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
  });

  it('should render cover image if blob is present', () => {
    renderWithRouter(<BookCard {...defaultProps} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:mock-url');
    expect(img).toHaveAttribute('alt', 'Cover of Test Title');
  });

  it('should render placeholder if no cover blob', () => {
    const bookWithoutCover = { ...mockBook, coverBlob: undefined };
    renderWithRouter(<BookCard {...defaultProps} book={bookWithoutCover} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Aa')).toBeInTheDocument();
  });

  it('should clean up object URL on unmount', () => {
    const { unmount } = renderWithRouter(<BookCard {...defaultProps} />);

    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBook.coverBlob);

    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should render progress bar when progress > 0', () => {
    const bookWithProgress = { ...mockBook, progress: 0.45 };
    renderWithRouter(<BookCard {...defaultProps} book={bookWithProgress} />);

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
    renderWithRouter(<BookCard {...defaultProps} book={bookWithZeroProgress} />);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();

    const bookWithUndefinedProgress = { ...mockBook, progress: undefined };
    renderWithRouter(<BookCard {...defaultProps} book={bookWithUndefinedProgress} />);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });

  it('should have accessibility attributes', () => {
    renderWithRouter(<BookCard {...defaultProps} />);

    const card = screen.getByTestId(`book-card-${mockBook.id}`);
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabIndex', '0');

    const menuButton = screen.getAllByLabelText('Book actions')[0];
    expect(menuButton).toBeInTheDocument();
  });

  it('should call onDelete when delete action is clicked', async () => {
    renderWithRouter(<BookCard {...defaultProps} />);

    const menuTriggerButton = screen.getByTestId('book-menu-trigger');
    fireEvent.click(menuTriggerButton);

    const deleteOption = await screen.findByTestId('menu-delete', {}, { timeout: 2000 });
    fireEvent.click(deleteOption);

    expect(mockOnDelete).toHaveBeenCalledWith(mockBook);
  });

  it('should call onRestore when restore action is clicked for offloaded book', async () => {
      const offloadedBook = { ...mockBook, isOffloaded: true };
      renderWithRouter(<BookCard {...defaultProps} book={offloadedBook} />);

      const menuTriggerButton = screen.getByTestId('book-menu-trigger');
      fireEvent.click(menuTriggerButton);

      const restoreOption = await screen.findByTestId('menu-restore', {}, { timeout: 2000 });
      fireEvent.click(restoreOption);

      expect(mockOnRestore).toHaveBeenCalledWith(offloadedBook);
  });

  it('should call onRestore when offloaded card is clicked directly', () => {
      const offloadedBook = { ...mockBook, isOffloaded: true };
      renderWithRouter(<BookCard {...defaultProps} book={offloadedBook} />);

      const card = screen.getByTestId(`book-card-${mockBook.id}`);
      fireEvent.click(card);

      expect(mockOnRestore).toHaveBeenCalledWith(offloadedBook);
  });
});
