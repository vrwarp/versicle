import { type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, type Mock } from 'vitest';
import { ContentMissingDialog } from './ContentMissingDialog';
import { useDriveStore } from '@store/useDriveStore';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { getDriveLibrarySync } from '@domains/google';
import type { BookMetadata } from '~types/book';

// Mock the store
vi.mock('@store/useDriveStore', () => ({
  useDriveStore: vi.fn(),
}));

vi.mock('@store/useGoogleServicesStore', () => ({
  useGoogleServicesStore: vi.fn(),
}));

vi.mock('@domains/google', () => ({
  getDriveLibrarySync: vi.fn(),
  getGoogleAuthClient: vi.fn(),
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
    (useGoogleServicesStore as unknown as Mock).mockReturnValue(true); // isDriveConnected check

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
    const cancelButton = screen.getByText('Cancel').closest('button');
    expect(cancelButton).toHaveClass('w-full');
    expect(cancelButton).toHaveClass('sm:w-auto');

    const restoreButton = screen.getByText('Restore from Cloud').closest('button');
    expect(restoreButton).toHaveClass('w-full');
    expect(restoreButton).toHaveClass('sm:w-auto');

    const selectButton = screen.getByText('Select File').closest('button');
    expect(selectButton).toHaveClass('w-full');
    expect(selectButton).toHaveClass('sm:w-auto');

    const footerContainer = screen.getByTestId('footer').firstChild;
    expect(footerContainer).toHaveClass('flex-col-reverse');
    expect(footerContainer).toHaveClass('sm:flex-row');
  });

  it('renders "Reconnect Drive" when disconnected but cloud match found', () => {
    (useDriveStore as unknown as Mock).mockReturnValue({
      findFile: vi.fn().mockReturnValue({
          id: 'cloud-id',
          name: 'cloud-file.epub',
          size: 1024
      }),
    });
    (useGoogleServicesStore as unknown as Mock).mockReturnValue(false); // disconnected

    render(
      <ContentMissingDialog
        open={true}
        onOpenChange={vi.fn()}
        book={mockBook}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText('Reconnect Drive')).toBeInTheDocument();
    expect(screen.getByText('Drive Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Restore from Cloud')).not.toBeInTheDocument();
  });

  it('REGRESSION: "Restore from Cloud" attaches the binary to THIS ghost (book.id) via onRestore, not the filename/title re-matching importer', async () => {
    // The screenshot scenario: the ghost the user clicked has its own bookId,
    // and the Drive copy was found by FUZZY title containment -- its filename
    // ("Fred Sanders - ...") differs from the ghost's sourceFilename. Routing
    // the download through the generic importer makes it re-discover the target
    // by filename (miss) then by exact title+author (often a miss too), so it
    // imports a brand-new book and leaves the ghost the user clicked unresolved.
    // The fix downloads the blob and hands it to onRestore, which targets the
    // known book.id (controller.restoreBook(book.id, file)) -- the same path as
    // "Select File".
    const downloadedFile = new File(['epub'], 'Fred Sanders - The Holy Spirit.epub', {
      type: 'application/epub+zip',
    });
    const downloadAsFile = vi.fn().mockResolvedValue(downloadedFile);
    const importFile = vi.fn().mockResolvedValue(undefined);
    (getDriveLibrarySync as Mock).mockReturnValue({ downloadAsFile, importFile });

    (useDriveStore as unknown as Mock).mockReturnValue({
      findFile: vi.fn().mockReturnValue({
        id: 'cloud-id',
        name: 'Fred Sanders - The Holy Spirit.epub',
        size: 1024,
      }),
    });
    (useGoogleServicesStore as unknown as Mock).mockReturnValue(true);

    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(
      <ContentMissingDialog open onOpenChange={vi.fn()} book={mockBook} onRestore={onRestore} />,
    );

    fireEvent.click(screen.getByText('Restore from Cloud'));

    // The downloaded File is restored onto THIS book via onRestore...
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(downloadedFile));
    // ...and the generic, book-agnostic importer is NOT used.
    expect(importFile).not.toHaveBeenCalled();
  });
});
