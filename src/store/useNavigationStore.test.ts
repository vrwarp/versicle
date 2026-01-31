import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNavigationStore, NavigationPriority } from './useNavigationStore';

describe('useNavigationStore', () => {
    beforeEach(() => {
        useNavigationStore.setState({ handlers: [] });
    });

    it('should register handlers and sort by priority', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const handler3 = vi.fn();

        useNavigationStore.getState().registerHandler('1', handler1, NavigationPriority.DEFAULT);
        useNavigationStore.getState().registerHandler('2', handler2, NavigationPriority.OVERLAY);
        useNavigationStore.getState().registerHandler('3', handler3, NavigationPriority.MODAL);

        const handlers = useNavigationStore.getState().handlers;
        expect(handlers).toHaveLength(3);
        expect(handlers[0].priority).toBe(NavigationPriority.OVERLAY);
        expect(handlers[1].priority).toBe(NavigationPriority.MODAL);
        expect(handlers[2].priority).toBe(NavigationPriority.DEFAULT);
        expect(handlers[0].handler).toBe(handler2);
    });

    it('should unregister handlers', () => {
        const handler = vi.fn();
        useNavigationStore.getState().registerHandler('1', handler, NavigationPriority.DEFAULT);
        expect(useNavigationStore.getState().handlers).toHaveLength(1);

        useNavigationStore.getState().unregisterHandler('1');
        expect(useNavigationStore.getState().handlers).toHaveLength(0);
    });
});
