import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteBookDialog } from './DeleteBookDialog';
import { useImportController } from '@app/library/useImportController';
import { useToastStore } from '@store/useToastStore';
import { act } from '@testing-library/react';

vi.mock('@app/library/useImportController', () => ({
  useImportController: vi.fn(),
}));

vi.mock('@store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

describe('DeleteBookDialog UI state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Deleting... text when isDeleting is true', async () => {
    let resolveRemove: (value: unknown) => void;
    const removeBookPromise = new Promise((resolve) => {
        resolveRemove = resolve;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useImportController as any).mockReturnValue({
        removeBook: vi.fn(() => removeBookPromise)
    });

    const showToastMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useToastStore as any).mockReturnValue(showToastMock);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = { id: '1', title: 'Test Book' } as any;

    render(<DeleteBookDialog isOpen={true} onClose={vi.fn()} book={book} />);

    const deleteBtn = screen.getByTestId('confirm-delete');
    expect(deleteBtn).toHaveTextContent('Delete');

    // Click delete to trigger state change
    fireEvent.click(deleteBtn);

    // It should now say "Deleting..."
    await waitFor(() => {
      expect(deleteBtn).toHaveTextContent('Deleting...');
    });

    await act(async () => {
       resolveRemove!(undefined);
    });

  });
});
