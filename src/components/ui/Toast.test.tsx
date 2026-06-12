import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from './Toast';
import { ToastHost } from '../ToastHost';
import { useToastStore } from '@store/useToastStore';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    CheckCircle: () => <span data-testid="icon-check" />,
    AlertCircle: () => <span data-testid="icon-alert" />,
    Info: () => <span data-testid="icon-info" />,
    X: () => <span data-testid="icon-x" />,
}));

describe('Toast (presentational item, Phase 8 §D)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the message with the type icon', () => {
        render(<Toast message="Info message" type="info" onClose={() => {}} />);
        expect(screen.getByText('Info message')).toBeInTheDocument();
        expect(screen.getByTestId('icon-info')).toBeInTheDocument();
        expect(screen.getByTestId('toast')).toHaveAttribute('data-toast-type', 'info');
    });

    it('carries NO live-region semantics of its own (the host owns the persistent regions)', () => {
        render(<Toast message="Success message" type="success" onClose={() => {}} />);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('auto-dismisses after its duration', () => {
        const onClose = vi.fn();
        render(<Toast message="bye" duration={3000} onClose={onClose} />);
        act(() => { vi.advanceTimersByTime(2999); });
        expect(onClose).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('never dismisses with duration 0 / Infinity (persistent toast)', () => {
        const onClose = vi.fn();
        render(<Toast message="stay" duration={0} onClose={onClose} />);
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('pauses the timer on hover and restarts in full on leave', () => {
        const onClose = vi.fn();
        render(<Toast message="hover me" duration={3000} onClose={onClose} />);
        const toast = screen.getByTestId('toast');

        act(() => { vi.advanceTimersByTime(2000); });
        fireEvent.mouseEnter(toast);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.mouseLeave(toast);
        act(() => { vi.advanceTimersByTime(3000); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pauses on focus-within (keyboard users get the same grace as hover)', () => {
        const onClose = vi.fn();
        render(<Toast message="focus me" duration={3000} onClose={onClose} />);

        const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
        fireEvent.focus(dismiss);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.blur(dismiss, { relatedTarget: document.body });
        act(() => { vi.advanceTimersByTime(3000); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismiss button calls onClose', () => {
        const onClose = vi.fn();
        render(<Toast message="close me" onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('ToastHost (queue stack above the router gate)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useToastStore.setState({ toasts: [] });
    });

    afterEach(() => {
        vi.useRealTimers();
        useToastStore.setState({ toasts: [] });
    });

    it('renders PERSISTENT live regions even with zero toasts (a11y item 10)', () => {
        render(<ToastHost />);
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('routes errors into the assertive alert region, the rest into the polite status region', () => {
        render(<ToastHost />);
        act(() => {
            useToastStore.getState().showToast('saved!', 'success');
            useToastStore.getState().showToast('broke!', 'error');
        });
        expect(screen.getByRole('status')).toHaveTextContent('saved!');
        expect(screen.getByRole('alert')).toHaveTextContent('broke!');
    });

    it('stacks multiple toasts instead of overwriting', () => {
        render(<ToastHost />);
        act(() => {
            useToastStore.getState().showToast('first');
            useToastStore.getState().showToast('second');
        });
        expect(screen.getAllByTestId('toast')).toHaveLength(2);
    });

    it('dismissing one toast leaves the others', () => {
        render(<ToastHost />);
        act(() => {
            useToastStore.getState().showToast('first');
            useToastStore.getState().showToast('second');
        });
        fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]);
        expect(screen.getAllByTestId('toast')).toHaveLength(1);
        expect(screen.getByText('second')).toBeInTheDocument();
    });

    describe('regression: boot-time toasts were dropped (container below the router gate)', () => {
        it('a toast fired BEFORE the host mounts renders after mount', () => {
            // Fire while nothing is mounted (pre-`ready` boot phase).
            useToastStore.getState().showToast('boot warning', 'error', 0);

            render(<ToastHost />);
            expect(screen.getByText('boot warning')).toBeInTheDocument();
        });
    });
});
