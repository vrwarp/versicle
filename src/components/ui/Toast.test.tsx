import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Toast } from './Toast';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    AlertCircle: () => <span data-testid="icon-alert-circle" />,
    Info: () => <span data-testid="icon-info" />,
    X: () => <span data-testid="icon-x" />,
}));

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correctly with message', () => {
    render(<Toast message="Hello World" isVisible={true} onClose={() => {}} />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('uses role="status" and aria-live="polite" for info type', () => {
    render(<Toast message="Info" isVisible={true} type="info" onClose={() => {}} />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Info');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
  });

  it('uses role="alert" and aria-live="assertive" for error type', () => {
    render(<Toast message="Error" isVisible={true} type="error" onClose={() => {}} />);
    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Error');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
  });

  it('calls onClose after duration', () => {
    const onClose = vi.fn();
    render(<Toast message="Test" isVisible={true} duration={3000} onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('pauses timer on hover and restarts on leave', () => {
    const onClose = vi.fn();
    render(<Toast message="Test" isVisible={true} duration={3000} onClose={onClose} />);

    // Use role status which is default for type=info (default)
    const toast = screen.getByRole('status');

    // Advance 2s
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Hover
    fireEvent.mouseEnter(toast);

    // Advance 2s (total 4s from start, but should be paused)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();

    // Leave - timer should restart (wait another 3000ms)
    fireEvent.mouseLeave(toast);

    // Advance 2.9s
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(onClose).not.toHaveBeenCalled();

    // Advance 0.2s
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalled();
  });
});
