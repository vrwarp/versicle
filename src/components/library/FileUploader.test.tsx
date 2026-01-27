import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import React from 'react';
import { FileUploader } from './FileUploader';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { validateZipSignature } from '../../lib/ingestion';
import { DuplicateBookError } from '../../types/errors';

// Mock dependencies
vi.mock('../../store/useLibraryStore');
vi.mock('../../store/useToastStore');
vi.mock('../../lib/ingestion', () => ({
  validateZipSignature: vi.fn(),
}));

describe('FileUploader', () => {
  const mockAddBook = vi.fn();
  const mockShowToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default mock implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: false,
      addBooks: vi.fn(),
    });

    // Mock useToastStore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useToastStore as any).mockReturnValue({
        showToast: mockShowToast,
    });

    // Mock validation to pass by default
    (validateZipSignature as Mock).mockResolvedValue(true);
  });

  it('should render upload instructions', () => {
    render(<FileUploader />);
    expect(screen.getByText(/Drop EPUBs or ZIPs here/)).toBeInTheDocument();
  });

  it('should handle file selection', async () => {
    const { container } = render(<FileUploader />);

    // Find input by selector directly as it has no label
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();

    const file = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
        expect(validateZipSignature).toHaveBeenCalledWith(file);
        expect(mockAddBook).toHaveBeenCalledWith(file);
    });
  });

  it('should call addBook when file is selected', async () => {
      const { container } = render(<FileUploader />);
      const input = container.querySelector('input[type="file"]');

      const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });

      fireEvent.change(input!, { target: { files: [file] } });

      await waitFor(() => {
          expect(mockAddBook).toHaveBeenCalledWith(file);
      });
  });

  it('should show loading state', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: true,
      importStatus: 'Importing books...',
      importProgress: 10,
    });

    render(<FileUploader />);
    expect(screen.getByText('Importing books...')).toBeInTheDocument();
  });

  it('should handle drag and drop', async () => {
    const { container } = render(<FileUploader />);
    // Select the drop zone div (nested inside the wrapper)
    const dropZone = container.querySelector('.group.relative') as HTMLElement;
    expect(dropZone).toBeInTheDocument();

    // Drag enter
    fireEvent.dragEnter(dropZone);
    expect(dropZone).toHaveClass('border-primary');

    // Drag leave
    fireEvent.dragLeave(dropZone);
    expect(dropZone).not.toHaveClass('border-primary');

    // Drop
    const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });
    fireEvent.drop(dropZone, {
        dataTransfer: {
            files: [file],
        },
    });

    await waitFor(() => {
        expect(mockAddBook).toHaveBeenCalledWith(file);
        expect(dropZone).not.toHaveClass('border-primary');
    });
  });

  it('should reject non-epub extension files', async () => {
    const { container } = render(<FileUploader />);
    const dropZone = container.querySelector('.group.relative') as HTMLElement;

    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone, {
        dataTransfer: {
            files: [file],
        },
    });

    await waitFor(() => {
        expect(mockAddBook).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('Unsupported file type: test.pdf', 'error');
    });
  });

  it('should reject epub files with invalid content', async () => {
      // Mock validation to fail
      (validateZipSignature as Mock).mockResolvedValue(false);

      const { container } = render(<FileUploader />);
      const input = container.querySelector('input[type="file"]');

      const file = new File(['invalid content'], 'test.epub', { type: 'application/epub+zip' });

      fireEvent.change(input!, { target: { files: [file] } });

      await waitFor(() => {
          expect(validateZipSignature).toHaveBeenCalledWith(file);
          expect(mockAddBook).not.toHaveBeenCalled();
          expect(mockShowToast).toHaveBeenCalledWith('Invalid EPUB file (header mismatch): test.epub', 'error');
      });
  });

  it('should reject zip files with invalid content', async () => {
      // Mock validation to fail
      (validateZipSignature as Mock).mockResolvedValue(false);

      const { container } = render(<FileUploader />);
      const input = container.querySelector('input[type="file"]');

      const file = new File(['invalid content'], 'test.zip', { type: 'application/zip' });

      fireEvent.change(input!, { target: { files: [file] } });

      await waitFor(() => {
          expect(validateZipSignature).toHaveBeenCalledWith(file);
          expect(mockAddBook).not.toHaveBeenCalled();
          expect(mockShowToast).toHaveBeenCalledWith('Invalid ZIP file (header mismatch): test.zip', 'error');
      });
  });

  it('should show replacement dialog when DuplicateBookError occurs', async () => {
      // Mock addBook to throw DuplicateBookError on first call, succeed on second
      mockAddBook.mockRejectedValueOnce(new DuplicateBookError("test.epub"));
      mockAddBook.mockResolvedValueOnce(undefined); // Second call succeeds

      const { container } = render(<FileUploader />);
      const input = container.querySelector('input[type="file"]');
      const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });

      // 1. Upload file
      fireEvent.change(input!, { target: { files: [file] } });

      // 2. Expect addBook to be called and fail
      await waitFor(() => {
          expect(mockAddBook).toHaveBeenCalledWith(file);
      });

      // 3. Expect Dialog to appear
      expect(screen.getByText(/already exists in your library/)).toBeInTheDocument();
      expect(screen.getByText('Replace Book?')).toBeInTheDocument();

      // 4. Click Replace
      const replaceBtn = screen.getByTestId('confirm-replace');
      fireEvent.click(replaceBtn);

      // 5. Expect addBook to be called again with overwrite: true
      await waitFor(() => {
          expect(mockAddBook).toHaveBeenCalledWith(file, { overwrite: true });
      });

      // 6. Expect toast success
      expect(mockShowToast).toHaveBeenCalledWith("Book replaced successfully", "success");
  });
});
