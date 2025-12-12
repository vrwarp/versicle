import { render, screen } from '@testing-library/react';
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

  beforeEach(() => {
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  // Removed afterEach since clearAllMocks is handled automatically if configured, or not needed if we overwrite mocks in beforeEach

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  it('should render book info', () => {
    renderWithRouter(<BookCard book={mockBook} />);

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
  });

  it('should render cover image if blob is present', () => {
    renderWithRouter(<BookCard book={mockBook} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:mock-url');
    expect(img).toHaveAttribute('alt', 'Cover of Test Title');
  });

  it('should render placeholder if no cover blob', () => {
    const bookWithoutCover = { ...mockBook, coverBlob: undefined };
    renderWithRouter(<BookCard book={bookWithoutCover} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Aa')).toBeInTheDocument();
  });

  it('should clean up object URL on unmount', () => {
    const { unmount } = renderWithRouter(<BookCard book={mockBook} />);

    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBook.coverBlob);

    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should render progress bar when progress > 0', () => {
    const bookWithProgress = { ...mockBook, progress: 0.45 };
    renderWithRouter(<BookCard book={bookWithProgress} />);

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
    renderWithRouter(<BookCard book={bookWithZeroProgress} />);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();

    const bookWithUndefinedProgress = { ...mockBook, progress: undefined };
    renderWithRouter(<BookCard book={bookWithUndefinedProgress} />);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });

  it('should have accessibility attributes', () => {
    renderWithRouter(<BookCard book={mockBook} />);

    const card = screen.getByTestId(`book-card-${mockBook.id}`);
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabIndex', '0');

    const menuButton = screen.getByLabelText('Book actions');
    expect(menuButton).toBeInTheDocument();
  });
});
