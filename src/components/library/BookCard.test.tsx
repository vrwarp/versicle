import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { BookCard } from './BookCard';
import type { BookMetadata } from '../../types/db';

// Remove obsolete mock for BookActionMenu which is no longer used in BookCard

vi.mock('../../store/useReadingStateStore', () => ({
  useReadingStateStore: vi.fn((selector) => {
    // Default mock state for the store selector if needed.
    // BookCard uses it for `state.progress`
    const mockState = {
      progress: {
        '1': { // match mockBook.id
          'test-device-id': {
            percentage: 0.45,
            lastRead: Date.now()
          }
        }
      }
    };
    return selector(mockState);
  }),
  useBookProgress: vi.fn((bookId) => {
    if (bookId === '1') { // Match mockBook.id
      return { percentage: 0.45, lastRead: Date.now(), deviceId: 'test-device' };
    }
    return null;
  }),
}));

// Mock Device Store
vi.mock('../../store/useDeviceStore', () => ({
  useDeviceStore: vi.fn((selector) => {
    const mockState = {
      devices: {
        'test-device-id': { name: 'Current Device', platform: 'browser' },
        'other-device': { name: 'Other Device', platform: 'mobile' }
      }
    };
    return selector(mockState);
  })
}));

// Mock Device ID
vi.mock('../../lib/device-id', () => ({
  getDeviceId: () => 'test-device-id'
}));

// Mock UI DropdownMenu to avoid Radix issues in JSDOM
vi.mock('../ui/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, ...props }: any) => (
    <div
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  ),
  DropdownMenuSeparator: () => <div />,
  DropdownMenuSub: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: any) => <div>{children}</div>,
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
  const mockOnOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Polyfill PointerEvent for Radix UI if needed
    if (!window.PointerEvent) {
      // @ts-ignore
      window.PointerEvent = class PointerEvent extends MouseEvent { };
    }

    // Polyfill ResizeObserver for Radix UI
    global.ResizeObserver = class ResizeObserver {
      observe() { }
      unobserve() { }
      disconnect() { }
    };
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  const renderCard = (book = mockBook) => {
    return renderWithRouter(
      <BookCard
        book={book}
        onOpen={mockOnOpen}
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

  it('should render offloaded overlay with accessibility attributes', () => {
    const offloadedBook = { ...mockBook, isOffloaded: true };
    renderCard(offloadedBook);

    const overlay = screen.getByTestId('offloaded-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute('title', 'Offloaded - Click to restore');
    expect(screen.getByText('Offloaded')).toHaveClass('sr-only');
  });

  it('should render progress bar when progress > 0', async () => {
    // Override mock for this test
    const { useBookProgress } = await import('../../store/useReadingStateStore');
    vi.mocked(useBookProgress).mockReturnValue({ bookId: '1', percentage: 0.45, lastRead: Date.now(), currentCfi: '', completedRanges: [] });

    const bookWithProgress = { ...mockBook }; // Progress prop is now irrelevant, but we keep the object
    renderCard(bookWithProgress);

    const progressBar = screen.getByTestId('progress-bar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveStyle({ width: '45%' });

    const progressContainer = screen.getByRole('progressbar');
    expect(progressContainer).toBeInTheDocument();
    expect(progressContainer).toHaveAttribute('aria-valuenow', '45');
  });

  it('should not render progress bar when progress is 0 or undefined', async () => {
    // Override mock to return null or 0 progress
    const { useBookProgress } = await import('../../store/useReadingStateStore');
    vi.mocked(useBookProgress).mockReturnValue(null);

    const bookWithZeroProgress = { ...mockBook };
    renderCard(bookWithZeroProgress);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });

  it('should have accessibility attributes', () => {
    renderCard();

    const card = screen.getByTestId(`book-card-${mockBook.id}`);
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabIndex', '0');

    // Check for the menu trigger instead of the mocked menu
    expect(screen.getByTestId('book-context-menu-trigger')).toBeInTheDocument();
  });

  it('should trigger onDelete when delete menu item is clicked', async () => {
    renderCard();

    // 1. Trigger might be clicked (optional with mock)
    // const trigger = screen.getByTestId('book-context-menu-trigger');
    // await act(async () => {
    //   fireEvent.click(trigger);
    // });

    // 2. Click the delete option (always visible with mock)
    const deleteButton = screen.getByTestId('menu-delete');

    await act(async () => {
      fireEvent.click(deleteButton);
    });

    expect(mockOnDelete).toHaveBeenCalledWith(mockBook);
  });
});
