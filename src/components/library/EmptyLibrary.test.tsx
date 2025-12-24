import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { EmptyLibrary } from './EmptyLibrary';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

// Mock dependencies
vi.mock('../../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('../../store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

// Mock FileUploader to simplify testing of EmptyLibrary
vi.mock('./FileUploader', () => ({
  FileUploader: () => <div data-testid="file-uploader-mock">File Uploader Mock</div>
}));

describe('EmptyLibrary', () => {
  const mockAddBook = vi.fn();
  const mockShowToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: false,
    });

    // Mock useToastStore hook
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useToastStore as any).mockImplementation((selector: any) => {
        if (selector) return selector({ showToast: mockShowToast });
        return { showToast: mockShowToast };
    });

    global.fetch = vi.fn();
    global.alert = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders correctly', () => {
    render(<EmptyLibrary onImport={vi.fn()} />);
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByTestId('file-uploader-mock')).toBeInTheDocument();
    expect(screen.getByText(/Load Demo Book/)).toBeInTheDocument();
  });

  it('handles demo book loading success', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.fetch as any).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['dummy'], { type: 'application/epub+zip' })),
      });

      render(<EmptyLibrary onImport={vi.fn()} />);
      fireEvent.click(screen.getByText(/Load Demo Book/));

      await waitFor(() => {
          expect(mockAddBook).toHaveBeenCalled();
          expect(mockShowToast).toHaveBeenCalledWith('Demo book loaded successfully', 'success');
      });
  });

  it('handles demo book loading failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValue({
      ok: false,
    });

    render(<EmptyLibrary onImport={vi.fn()} />);
    fireEvent.click(screen.getByText(/Load Demo Book/));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
    });
  });

  it('displays loading spinner when importing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: true,
    });

    render(<EmptyLibrary onImport={vi.fn()} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    // Verify spinner is present (Loader2 usually renders an svg with specific class)
    const button = screen.getByText('Loading...').closest('button');
    expect(button).toBeDisabled();
    expect(button?.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
