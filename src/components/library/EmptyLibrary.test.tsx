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

    // Mock useToastStore hook to return showToast
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useToastStore as any).mockImplementation((selector: any) => {
        // If selector is provided, apply it to the state
        if (selector) {
            return selector({ showToast: mockShowToast });
        }
        // If used as useToastStore(), return the state
        return { showToast: mockShowToast };
    });

    global.fetch = vi.fn();
    global.alert = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles demo book loading failure with toast', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValue({
      ok: false,
    });

    render(<EmptyLibrary onImport={vi.fn()} />);
    fireEvent.click(screen.getByText(/Load Demo Book/));

    await waitFor(() => {
      // This expectation will fail initially because the code uses alert
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
      expect(global.alert).not.toHaveBeenCalled();
    });
  });
});
