import React, { useEffect } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useImportJumpPrompt } from './ImportJumpPrompt';
import type { BookMetadata } from '~types/book';

const Harness: React.FC<{ areLocationsReady: boolean }> = ({ areLocationsReady }) => {
  const bookMetadata: BookMetadata = {
    id: 'book-1',
    title: 'War and Peace',
    author: 'Leo Tolstoy',
    addedAt: 1,
    progress: 0.42,
  };
  const api = useImportJumpPrompt({
    bookId: 'book-1',
    engine: null,
    areLocationsReady,
    bookMetadata,
  });

  useEffect(() => {
    api.checkImportJump(0);
  }, [api]);

  return <>{api.dialog}</>;
};

describe('ImportJumpPrompt', () => {
  describe('regression: Cancel stays enabled while waiting for location generation', () => {
    it('allows aborting Locating... via Start from Beginning without waiting for the 2-minute timeout', () => {
      render(<Harness areLocationsReady={false} />);

      expect(screen.getByText('Resume from Reading List?')).toBeInTheDocument();
      const jumpBtn = screen.getByRole('button', { name: 'Yes, jump to location' });
      act(() => {
        fireEvent.click(jumpBtn);
      });

      expect(screen.getByText('Locating...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Calculating...' })).toBeDisabled();
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelBtn).not.toBeDisabled();

      act(() => {
        fireEvent.click(cancelBtn);
      });
      expect(screen.queryByText('Locating...')).not.toBeInTheDocument();
    });
  });
});
