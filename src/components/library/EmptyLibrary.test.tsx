import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmptyLibrary } from './EmptyLibrary';
import { useLibraryStore } from '@store/useLibraryStore';
import { useToastStore } from '@store/useToastStore';

// Mock dependencies
vi.mock('@store/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('@store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

// Mock FileUploader to simplify testing of EmptyLibrary
vi.mock('./FileUploader', () => ({
  FileUploader: () => <div data-testid="file-uploader-mock">File Uploader Mock</div>
}));

// Import workflows live on the shared controller, not the store.
const { mockAddBook } = vi.hoisted(() => ({ mockAddBook: vi.fn() }));
vi.mock('@app/library/useImportController', () => {
  const controller = { importFile: mockAddBook };
  return { useImportController: () => controller, libraryController: controller };
});

describe('EmptyLibrary', () => {
  const mockShowToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddBook.mockResolvedValue({ status: 'imported', bookId: 'x' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockImplementation((selector: any) => {
      const state = { isImporting: false };
      return selector ? selector(state) : state;
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
    render(<EmptyLibrary onImport={vi.fn()} />, { wrapper: MemoryRouter });
    expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByTestId('file-uploader-mock')).toBeInTheDocument();
    expect(screen.getByText(/Load Demo Book/)).toBeInTheDocument();
    expect(screen.getByText('Browse Files')).toBeInTheDocument();
  });

  it('calls onImport when Browse Files button is clicked', () => {
    const mockOnImport = vi.fn();
    render(<EmptyLibrary onImport={mockOnImport} />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByText('Browse Files'));

    expect(mockOnImport).toHaveBeenCalledTimes(1);
  });

  it('handles demo book loading success', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.fetch as any).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['dummy'], { type: 'application/epub+zip' })),
      });

      render(<EmptyLibrary onImport={vi.fn()} />, { wrapper: MemoryRouter });
      fireEvent.click(screen.getByText(/Load Demo Book/));

      await waitFor(() => {
          expect(mockAddBook).toHaveBeenCalled();
          expect(mockShowToast).toHaveBeenCalledWith(
            'Demo book loaded successfully',
            'success',
            5000,
            { label: 'common.open', onAction: expect.any(Function) },
          );
      });
  });

  it('handles demo book loading failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValue({
      ok: false,
    });

    render(<EmptyLibrary onImport={vi.fn()} />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByText(/Load Demo Book/));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
    });
    consoleSpy.mockRestore();
  });

  describe('regression: single CTA spinner during import vs demo load', () => {
    it('spins only Browse Files when an external import is running', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (useLibraryStore as any).mockImplementation((selector: any) => {
        const state = { isImporting: true };
        return selector ? selector(state) : state;
      });

      const { container } = render(<EmptyLibrary onImport={vi.fn()} />, { wrapper: MemoryRouter });
      const browseBtn = screen.getByRole('button', { name: 'Importing book...' });
      const demoBtn = screen.getByRole('button', { name: 'Load Demo Book (Alice in Wonderland)' });

      expect(browseBtn).toBeDisabled();
      expect(demoBtn).toBeDisabled();
      expect(browseBtn.querySelector('.animate-spin')).toBeInTheDocument();
      expect(demoBtn.querySelector('.animate-spin')).not.toBeInTheDocument();
      expect(container.querySelectorAll('.animate-spin')).toHaveLength(1);
    });

    it('spins only Load Demo Book while demo import is in flight', async () => {
      let resolveImport!: (res: { status: string; bookId: string }) => void;
      mockAddBook.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveImport = resolve;
          }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.fetch as any).mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['dummy'], { type: 'application/epub+zip' })),
      });

      const { container, rerender } = render(<EmptyLibrary onImport={vi.fn()} />, { wrapper: MemoryRouter });
      fireEvent.click(screen.getByText(/Load Demo Book/));

      await waitFor(() => expect(mockAddBook).toHaveBeenCalled());

      // Simulate store flipping isImporting=true while demo import runs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (useLibraryStore as any).mockImplementation((selector: any) => {
        const state = { isImporting: true };
        return selector ? selector(state) : state;
      });
      rerender(<EmptyLibrary onImport={vi.fn()} />);

      const browseBtn = screen.getByRole('button', { name: 'Browse files to import' });
      const demoBtn = screen.getByRole('button', { name: 'Loading demo book...' });

      expect(browseBtn).toBeDisabled();
      expect(demoBtn).toBeDisabled();
      expect(browseBtn.querySelector('.animate-spin')).not.toBeInTheDocument();
      expect(demoBtn.querySelector('.animate-spin')).toBeInTheDocument();
      expect(container.querySelectorAll('.animate-spin')).toHaveLength(1);

      resolveImport({ status: 'imported', bookId: 'demo-id' });
      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    });
  });
});
