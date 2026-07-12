import { type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RestoreMismatchDialog } from './RestoreMismatchDialog';

// Mock the Radix-backed Dialog to expose title/description/footer/body and a
// close hook — the same shape ReplaceBookDialog's test uses.
interface DialogMockProps {
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
}

vi.mock('../ui/Dialog', () => ({
  Dialog: ({ title, description, footer, children, isOpen, onClose }: DialogMockProps) =>
    isOpen ? (
      <div data-testid="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <div data-testid="body">{children}</div>
        <div data-testid="footer">{footer}</div>
        <button data-testid="mock-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

describe('RestoreMismatchDialog', () => {
  const defaultProps = {
    isOpen: true,
    bookTitle: 'The Odyssey',
    onCancel: vi.fn(),
    onProceed: vi.fn().mockResolvedValue(undefined),
  };

  it('names the book and offers Cancel (default) plus a warning-signed Proceed Anyway', () => {
    render(<RestoreMismatchDialog {...defaultProps} />);

    expect(screen.getByText("Content Doesn't Match")).toBeInTheDocument();
    expect(screen.getByText(/"The Odyssey"/)).toBeInTheDocument();
    expect(screen.getByTestId('restore-mismatch-cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('restore-mismatch-proceed')).toHaveTextContent('⚠️ Proceed Anyway');
  });

  it('calls onCancel from the Cancel button', () => {
    const onCancel = vi.fn();
    render(<RestoreMismatchDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('restore-mismatch-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onProceed when Proceed Anyway is clicked', () => {
    const onProceed = vi.fn().mockResolvedValue(undefined);
    render(<RestoreMismatchDialog {...defaultProps} onProceed={onProceed} />);

    fireEvent.click(screen.getByTestId('restore-mismatch-proceed'));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('disables both actions and shows "Restoring..." while onProceed runs', async () => {
    let resolveProceed: (value?: unknown) => void;
    const proceedPromise = new Promise((resolve) => { resolveProceed = resolve; });
    const onProceed = vi.fn().mockReturnValue(proceedPromise);

    render(<RestoreMismatchDialog {...defaultProps} onProceed={onProceed} />);

    const proceedBtn = screen.getByTestId('restore-mismatch-proceed');
    const cancelBtn = screen.getByTestId('restore-mismatch-cancel');
    fireEvent.click(proceedBtn);

    expect(proceedBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(proceedBtn).toHaveTextContent('Restoring...');

    await act(async () => { resolveProceed!(undefined); });

    await waitFor(() => expect(proceedBtn).toHaveTextContent('⚠️ Proceed Anyway'));
  });
});
