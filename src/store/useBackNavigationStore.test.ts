import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBackNavigationStore, BackButtonPriority } from './useBackNavigationStore';

describe('useBackNavigationStore', () => {
    beforeEach(() => {
        useBackNavigationStore.setState({ handlers: [] });
    });

    it('should register handlers and sort by priority', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const handler3 = vi.fn();

        useBackNavigationStore.getState().registerHandler('1', handler1, BackButtonPriority.DEFAULT);
        useBackNavigationStore.getState().registerHandler('2', handler2, BackButtonPriority.OVERLAY);
        useBackNavigationStore.getState().registerHandler('3', handler3, BackButtonPriority.MODAL);

        const handlers = useBackNavigationStore.getState().handlers;
        expect(handlers).toHaveLength(3);
        expect(handlers[0].priority).toBe(BackButtonPriority.OVERLAY);
        expect(handlers[1].priority).toBe(BackButtonPriority.MODAL);
        expect(handlers[2].priority).toBe(BackButtonPriority.DEFAULT);
        expect(handlers[0].handler).toBe(handler2);
    });

    it('should unregister handlers', () => {
        const handler = vi.fn();
        useBackNavigationStore.getState().registerHandler('1', handler, BackButtonPriority.DEFAULT);
        expect(useBackNavigationStore.getState().handlers).toHaveLength(1);

        useBackNavigationStore.getState().unregisterHandler('1');
        expect(useBackNavigationStore.getState().handlers).toHaveLength(0);
    });
});
