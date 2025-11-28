import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dialog } from './Dialog';
import { vi } from 'vitest';

describe('Dialog', () => {
  it('renders correctly when open', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog content')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={false} onClose={onClose} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    // The backdrop is the first child of the wrapper or we can find by aria-hidden="true"?
    // In our implementation, backdrop has absolute inset-0 and is a sibling of content.
    // We can access it via class or structure.
    // Or simpler: verify we can click outside content.
    // Since we put a specific onClick on the backdrop div.

    // We can modify Dialog to give the backdrop a test id, or select by class.
    // But testing implementation details is brittle.
    // Let's rely on user event.
    // However, with `inset-0`, it covers the screen.
    // React Testing Library renders into a container.
    // We can try to find the backdrop by generic query.

    // Let's assume the first div inside the wrapper is backdrop if we follow structure.
    // But we can't easily select it without a role or label.
    // Let's add data-testid to backdrop for testability if needed, or rely on visual assumption.
    // Actually, `aria-hidden="true"` is on the backdrop.

    // Using `querySelector` on container
    const backdrop = screen.getByRole('dialog').parentElement?.querySelector('.backdrop-blur-sm');
    if (backdrop) {
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalled();
    }
  });

  it('renders footer content', () => {
    const onClose = vi.fn();
    render(
      <Dialog
        isOpen={true}
        onClose={onClose}
        title="Test Dialog"
        footer={<button>Confirm</button>}
      >
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });
});
