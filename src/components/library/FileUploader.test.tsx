import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { FileUploader } from './FileUploader';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock dependencies
vi.mock('../../store/useLibraryStore');

describe('FileUploader', () => {
  const mockAddBook = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockReturnValue({
      addBook: mockAddBook,
      isImporting: false,
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
    expect(dropZone).toHaveClass('border-blue-500');

    // Drag leave
    fireEvent.dragLeave(dropZone);
    expect(dropZone).not.toHaveClass('border-blue-500');

    // Drop
    const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });
    fireEvent.drop(dropZone, {
        dataTransfer: {
            files: [file],
        },
    });

    expect(mockAddBook).toHaveBeenCalledWith(file);
    expect(dropZone).not.toHaveClass('border-blue-500');
  });

  it('should reject non-epub files', () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { container } = render(<FileUploader />);
    const dropZone = container.firstChild as HTMLElement;

    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone, {
        dataTransfer: {
            files: [file],
        },
    });

    expect(mockAddBook).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith('Only .epub files are supported');
    alertMock.mockRestore();
  });
});
