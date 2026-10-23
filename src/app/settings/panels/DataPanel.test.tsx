import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import DataPanel from './DataPanel';

vi.mock('@components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

// The presentational tab is exercised in its own suite; here it only exposes
// the import handler.
vi.mock('@components/settings', () => ({
  DataManagementTab: ({ onImportReadingList }: { onImportReadingList: (file: File) => void }) => (
    <button onClick={() => onImportReadingList(new File([''], 'reading-list.csv', { type: 'text/csv' }))}>
      import-empty-csv
    </button>
  ),
}));

vi.mock('@components/ReadingListDialog', () => ({
  ReadingListDialog: () => null,
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('DataPanel', () => {
  describe('regression: reading-list CSV import overlay', () => {
    it('dismisses itself when the picked file is empty instead of hanging forever', async () => {
      render(
        <MemoryRouter>
          <DataPanel />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByText('import-empty-csv'));

      // Failure message is shown first...
      await waitFor(() => expect(screen.getByText('Failed to import CSV.')).toBeTruthy());
      expect(screen.getByText('Importing Reading List')).toBeTruthy();

      // ...then the overlay closes on its own.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 2100));
      });
      expect(screen.queryByText('Importing Reading List')).toBeNull();
    });
  });
});
