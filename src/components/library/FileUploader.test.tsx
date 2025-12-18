import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { FileUploader } from './FileUploader';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

// Mock dependencies
vi.mock('../../store/useLibraryStore');
vi.mock('../../store/useToastStore');

describe('FileUploader', () => {
  const mockAddBook = vi.fn();
  const mockShowToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: false,
    });

    // Mock useToastStore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useToastStore as any).mockReturnValue({
        showToast: mockShowToast,
    });
  });

  it('should render upload instructions', () => {
    render(<FileUploader />);
    expect(screen.getByText(/Drop your EPUB here/)).toBeInTheDocument();
  });

  it('should handle file selection', () => {
    const { container } = render(<FileUploader />);

    // Find input by selector directly as it has no label
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();

    const file = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });

    fireEvent.change(input!, { target: { files: [file] } });

    expect(mockAddBook).toHaveBeenCalledWith(file);
  });

  it('should call addBook when file is selected', () => {
      const { container } = render(<FileUploader />);
      const input = container.querySelector('input[type="file"]');

      const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });

      fireEvent.change(input!, { target: { files: [file] } });

      expect(mockAddBook).toHaveBeenCalledWith(file);
  });

  it('should show loading state', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: true,
    });

    render(<FileUploader />);
    expect(screen.getByText('Importing book...')).toBeInTheDocument();
  });

  it('should handle drag and drop', () => {
    const { container } = render(<FileUploader />);
    const dropZone = container.firstChild as HTMLElement;

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

    expect(mockAddBook).toHaveBeenCalledWith(file);
    expect(dropZone).not.toHaveClass('border-primary');
  });

  it('should reject non-epub files', () => {
    const { container } = render(<FileUploader />);
    const dropZone = container.firstChild as HTMLElement;

    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone, {
        dataTransfer: {
            files: [file],
        },
    });

    expect(mockAddBook).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Only .epub files are supported', 'error');
  });
});
