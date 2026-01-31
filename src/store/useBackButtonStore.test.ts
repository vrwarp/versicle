import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBackButtonStore } from './useBackButtonStore';

describe('useBackButtonStore', () => {
    beforeEach(() => {
        useBackButtonStore.setState({ handlers: [] });
    });

    it('should register handlers and sort by priority', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        const handler3 = vi.fn();

        useBackButtonStore.getState().registerHandler('1', handler1, 10);
        useBackButtonStore.getState().registerHandler('2', handler2, 100);
        useBackButtonStore.getState().registerHandler('3', handler3, 50);

        const handlers = useBackButtonStore.getState().handlers;
        expect(handlers).toHaveLength(3);
        expect(handlers[0].priority).toBe(100);
        expect(handlers[1].priority).toBe(50);
        expect(handlers[2].priority).toBe(10);
        expect(handlers[0].handler).toBe(handler2);
    });

    it('should unregister handlers', () => {
        const handler = vi.fn();
        useBackButtonStore.getState().registerHandler('1', handler, 10);
        expect(useBackButtonStore.getState().handlers).toHaveLength(1);

        useBackButtonStore.getState().unregisterHandler('1');
        expect(useBackButtonStore.getState().handlers).toHaveLength(0);
    });
});
