import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAndroidBackButtonStore, BackButtonPriority } from './useAndroidBackButtonStore';

describe('useAndroidBackButtonStore', () => {
    beforeEach(() => {
        useAndroidBackButtonStore.setState({ handlers: [] });
    });

    it('should register handlers and sort by priority', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const handler3 = vi.fn();

        useAndroidBackButtonStore.getState().registerHandler('1', handler1, BackButtonPriority.DEFAULT);
        useAndroidBackButtonStore.getState().registerHandler('2', handler2, BackButtonPriority.OVERLAY);
        useAndroidBackButtonStore.getState().registerHandler('3', handler3, BackButtonPriority.MODAL);

        const handlers = useAndroidBackButtonStore.getState().handlers;
        expect(handlers).toHaveLength(3);
        expect(handlers[0].priority).toBe(BackButtonPriority.OVERLAY);
        expect(handlers[1].priority).toBe(BackButtonPriority.MODAL);
        expect(handlers[2].priority).toBe(BackButtonPriority.DEFAULT);
        expect(handlers[0].handler).toBe(handler2);
    });

    it('should unregister handlers', () => {
        const handler = vi.fn();
        useAndroidBackButtonStore.getState().registerHandler('1', handler, BackButtonPriority.DEFAULT);
        expect(useAndroidBackButtonStore.getState().handlers).toHaveLength(1);

        useAndroidBackButtonStore.getState().unregisterHandler('1');
        expect(useAndroidBackButtonStore.getState().handlers).toHaveLength(0);
    });
});
