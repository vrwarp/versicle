import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from './Toast';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    CheckCircle: () => <span data-testid="icon-check" />,
    AlertCircle: () => <span data-testid="icon-alert" />,
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

    it('renders with correct role and aria-live for info type', () => {
        render(
            <Toast
                message="Info message"
                isVisible={true}
                type="info"
                onClose={() => {}}
            />
        );

        const toast = screen.getByRole('status');
        expect(toast).toBeInTheDocument();
        expect(toast).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByText('Info message')).toBeInTheDocument();
    });

    it('renders with correct role and aria-live for success type', () => {
        render(
            <Toast
                message="Success message"
                isVisible={true}
                type="success"
                onClose={() => {}}
            />
        );

        const toast = screen.getByRole('status');
        expect(toast).toBeInTheDocument();
        expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('renders with correct role and aria-live for error type', () => {
        render(
            <Toast
                message="Error message"
                isVisible={true}
                type="error"
                onClose={() => {}}
            />
        );

        const toast = screen.getByRole('alert');
        expect(toast).toBeInTheDocument();
        expect(toast).toHaveAttribute('aria-live', 'assertive');
    });

    it('calls onClose after duration', () => {
        const onClose = vi.fn();
        render(
            <Toast
                message="Test"
                isVisible={true}
                duration={3000}
                onClose={onClose}
            />
        );

        expect(onClose).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('pauses timer on hover', () => {
        const onClose = vi.fn();
        render(
            <Toast
                message="Test"
                isVisible={true}
                duration={3000}
                onClose={onClose}
            />
        );

        const toast = screen.getByRole('status');

        // Advance 1s
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(onClose).not.toHaveBeenCalled();

        // Mouse enter (pause)
        fireEvent.mouseEnter(toast);

        // Advance 5s (should still be open)
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(onClose).not.toHaveBeenCalled();

        // Mouse leave (resume)
        fireEvent.mouseLeave(toast);

        // Advance 3s (should close now)
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('does not render when isVisible is false', () => {
        render(
            <Toast
                message="Test"
                isVisible={false}
                onClose={() => {}}
            />
        );

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
