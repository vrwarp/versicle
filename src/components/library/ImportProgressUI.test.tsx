import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportProgressUI } from './ImportProgressUI';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock the store module (the component reads everything through this hook)
vi.mock('../../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

describe('ImportProgressUI', () => {
  const baseState = {
    isImporting: false,
    importProgress: 0,
    importStatus: '',
    uploadProgress: 0,
    uploadStatus: '',
    batchImportSummary: null,
    clearBatchImportSummary: vi.fn()
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockState = (overrides: Record<string, any> = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useLibraryStore as any).mockImplementation((selector: any) =>
      selector({ ...baseState, ...overrides })
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when idle with no summary', () => {
    mockState();
    const { container } = render(<ImportProgressUI />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows progress while importing', () => {
    mockState({ isImporting: true, uploadProgress: 40, uploadStatus: 'Processing books.zip...' });
    render(<ImportProgressUI />);
    expect(screen.getByText('Processing books.zip...')).toBeInTheDocument();
  });

  describe('regression: batch import per-file outcome summary (D1)', () => {
    const summary = {
      imported: 2,
      skipped: ['dup.epub'],
      failed: [{ filename: 'bad.epub', reason: 'Corrupt EPUB structure' }]
    };

    it('shows imported/skipped/failed counts with reasons after a batch import', () => {
      mockState({ batchImportSummary: summary });
      render(<ImportProgressUI />);

      expect(screen.getByTestId('batch-import-summary')).toBeInTheDocument();
      expect(
        screen.getByText('Import complete: 2 imported, 1 duplicates skipped, 1 failed')
      ).toBeInTheDocument();
      expect(screen.getByText('dup.epub')).toBeInTheDocument();
      expect(screen.getByText('bad.epub')).toBeInTheDocument();
      expect(screen.getByText(/Corrupt EPUB structure/)).toBeInTheDocument();
    });

    it('dismisses the summary via the store action', () => {
      const clearBatchImportSummary = vi.fn();
      mockState({ batchImportSummary: summary, clearBatchImportSummary });
      render(<ImportProgressUI />);

      fireEvent.click(screen.getByRole('button', { name: /dismiss import summary/i }));
      expect(clearBatchImportSummary).toHaveBeenCalledTimes(1);
    });

    it('does not show the summary while a new import is running', () => {
      mockState({ isImporting: true, batchImportSummary: summary });
      render(<ImportProgressUI />);
      expect(screen.queryByTestId('batch-import-summary')).not.toBeInTheDocument();
    });
  });
});
