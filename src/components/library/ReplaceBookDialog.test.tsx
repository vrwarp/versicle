import React, { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReplaceBookDialog } from './ReplaceBookDialog';
import { act } from '@testing-library/react';

// Mock the Dialog component since it uses Radix which might need setup
// But we want to test the footer content which is passed as prop.
// So we can mock Dialog to just render children and footer.
interface DialogMockProps {
  title: string;
  description?: string;
  footer?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
}

vi.mock('../ui/Dialog', () => ({
  Dialog: ({ title, description, footer, isOpen, onClose }: DialogMockProps) => isOpen ? (
    <div data-testid="dialog">
      <h2>{title}</h2>
      <p>{description}</p>
      <div data-testid="footer">{footer}</div>
      <button data-testid="mock-close" onClick={onClose}>Close</button>
    </div>
  ) : null,
}));

describe('ReplaceBookDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    fileName: 'test-book.epub',
  };

  it('renders correct content with fileName', () => {
    render(<ReplaceBookDialog {...defaultProps} />);

    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    expect(screen.getByText('Replace Book?')).toBeInTheDocument();
    expect(screen.getByText(/"test-book.epub" already exists in your library. Do you want to replace it\?/)).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-replace')).toHaveTextContent('Replace');
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onCloseMock = vi.fn();
    render(<ReplaceBookDialog {...defaultProps} onClose={onCloseMock} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when mock close button is clicked (testing onClose from Dialog)', () => {
    const onCloseMock = vi.fn();
    render(<ReplaceBookDialog {...defaultProps} onClose={onCloseMock} />);

    fireEvent.click(screen.getByTestId('mock-close'));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Replace button is clicked and closes upon success', async () => {
    const onCloseMock = vi.fn();
    const onConfirmMock = vi.fn().mockResolvedValue(undefined);

    render(<ReplaceBookDialog {...defaultProps} onClose={onCloseMock} onConfirm={onConfirmMock} />);

    fireEvent.click(screen.getByTestId('confirm-replace'));

    expect(onConfirmMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });
  });

  it('sets isReplacing to true, disables buttons, and shows "Replacing..." while onConfirm is executing', async () => {
    let resolveConfirm: (value: unknown) => void;
    const confirmPromise = new Promise((resolve) => {
        resolveConfirm = resolve;
    });

    const onConfirmMock = vi.fn().mockReturnValue(confirmPromise);
    const onCloseMock = vi.fn();

    render(<ReplaceBookDialog {...defaultProps} onClose={onCloseMock} onConfirm={onConfirmMock} />);

    const replaceBtn = screen.getByTestId('confirm-replace');
    const cancelBtn = screen.getByText('Cancel');

    fireEvent.click(replaceBtn);

    expect(replaceBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(replaceBtn).toHaveTextContent('Replacing...');

    // Prevent close from dialog while replacing
    fireEvent.click(screen.getByTestId('mock-close'));
    expect(onCloseMock).not.toHaveBeenCalled();

    await act(async () => {
       resolveConfirm!(undefined);
    });

    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });
  });

  it('catches errors from onConfirm and leaves dialog open', async () => {
    let rejectConfirm: (reason?: unknown) => void;
    const confirmPromise = new Promise((resolve, reject) => {
        rejectConfirm = reject;
    });

    const onConfirmMock = vi.fn().mockReturnValue(confirmPromise);
    const onCloseMock = vi.fn();

    render(<ReplaceBookDialog {...defaultProps} onClose={onCloseMock} onConfirm={onConfirmMock} />);

    const replaceBtn = screen.getByTestId('confirm-replace');

    fireEvent.click(replaceBtn);

    expect(replaceBtn).toHaveTextContent('Replacing...');

    // Mock console.error to avoid test output noise
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
       rejectConfirm!(new Error("Failed"));
    });

    await waitFor(() => {
        // Text reverts back to "Replace"
        expect(replaceBtn).toHaveTextContent('Replace');
        // Dialog should remain open, onClose should not have been called
        expect(onCloseMock).not.toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
