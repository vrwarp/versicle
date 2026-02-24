import React, { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, Mock } from 'vitest';
import { ContentMissingDialog } from './ContentMissingDialog';
import { useDriveStore } from '../../store/useDriveStore';
import { BookMetadata } from '../../types/db';

// Mock the store
vi.mock('../../store/useDriveStore', () => ({
  useDriveStore: vi.fn(),
}));

// Mock the Dialog component since it uses Radix which might need setup
// But we want to test the footer content which is passed as prop.
// So we can mock Dialog to just render children and footer.
interface DialogMockProps {
  children: ReactNode;
  footer: ReactNode;
  isOpen: boolean;
}

vi.mock('../ui/Dialog', () => ({
  Dialog: ({ children, footer, isOpen }: DialogMockProps) => isOpen ? (
    <div data-testid="dialog">
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  ) : null,
}));

describe('ContentMissingDialog', () => {
  const mockBook: BookMetadata = {
    id: '1',
    title: 'Test Book',
    author: 'Test Author',
    addedAt: Date.now(),
    filename: 'test.epub',
  };

  it('renders footer buttons with responsive classes', () => {
    // Setup store mock
    (useDriveStore as unknown as Mock).mockReturnValue({
      findFile: vi.fn().mockReturnValue({
          id: 'cloud-id',
          name: 'cloud-file.epub',
          size: 1024
      }),
    });

    render(
      <ContentMissingDialog
        open={true}
        onOpenChange={vi.fn()}
        book={mockBook}
        onRestore={vi.fn()}
      />
    );

    // Check if buttons are present
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Restore from Cloud')).toBeInTheDocument();
    expect(screen.getByText('Select File')).toBeInTheDocument();

    // Check classes for responsiveness
    // Note: Button component might merge classes, so we check if the passed class is present
    const cancelButton = screen.getByText('Cancel').closest('button');
    expect(cancelButton).toHaveClass('w-full');
    expect(cancelButton).toHaveClass('sm:w-auto');

    const restoreButton = screen.getByText('Restore from Cloud').closest('button');
    expect(restoreButton).toHaveClass('w-full');
    expect(restoreButton).toHaveClass('sm:w-auto');

    const selectButton = screen.getByText('Select File').closest('button');
    expect(selectButton).toHaveClass('w-full');
    expect(selectButton).toHaveClass('sm:w-auto');

    // Check container classes
    // We need to find the container div.
    // In our mock Dialog, we render footer in a div.
    // The footer prop itself is a div with classes.
    // So inside data-testid="footer", there should be a div with the classes.
    const footerContainer = screen.getByTestId('footer').firstChild;
    expect(footerContainer).toHaveClass('flex-col-reverse');
    expect(footerContainer).toHaveClass('sm:flex-row');
  });
});
