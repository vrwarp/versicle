import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLexiconStore } from './useLexiconStore';

import * as Y from 'yjs';

// Mock Yjs provider with a real Y.Doc instance
// This ensures zustand-middleware-yjs works correctly with actual Yjs types
vi.mock('./yjs-provider', async () => {
    const Y = await import('yjs');
    return {
        yDoc: new Y.Doc(),
        waitForYjsSync: vi.fn().mockResolvedValue(),
    };
});

// Mock zustand-middleware-yjs to behave like a simple pass-through or basic store for testing
// Since we want to test the *actions* logic (like ID generation and ordering), we can rely on 
// the fact that zustand-middleware-yjs wraps the store. 
// However, the middleware logic itself is what handles the `set` calls updating the internal state.
// If we use the real middleware with a mock yDoc, it might fail if the mock isn't perfect.
// 
// Alternative: Use the real store but clear it before each test. 
// But since we are importing a singleton `useLexiconStore`, state persists between tests unless cleared.

describe('useLexiconStore', () => {
    beforeEach(() => {
        useLexiconStore.setState({
            rules: {},
            settings: {}
        });
    });

    it('should add a rule with correct order', () => {
        useLexiconStore.getState().addRule({
            original: 'orig',
            replacement: 'rep',
            isRegex: false
        });

        const rules = useLexiconStore.getState().rules;
        const ids = Object.keys(rules);
        expect(ids.length).toBe(1);
        expect(rules[ids[0]].order).toBe(0);
        expect(rules[ids[0]].original).toBe('orig');

        // Add another
        useLexiconStore.getState().addRule({
            original: 'orig2',
            replacement: 'rep2'
        });

        const rules2 = useLexiconStore.getState().rules;
        const keys2 = Object.keys(rules2);
        expect(keys2.length).toBe(2);

        // Find the new one
        const rule2 = Object.values(rules2).find(r => r.original === 'orig2');
        expect(rule2?.order).toBe(1);
    });

    it('should update a rule', () => {
        useLexiconStore.getState().addRule({ original: 'a', replacement: 'b' });
        const id = Object.keys(useLexiconStore.getState().rules)[0];

        useLexiconStore.getState().updateRule(id, { replacement: 'c' });
        expect(useLexiconStore.getState().rules[id].replacement).toBe('c');
    });

    it('should delete a rule', () => {
        useLexiconStore.getState().addRule({ original: 'a', replacement: 'b' });
        const id = Object.keys(useLexiconStore.getState().rules)[0];

        useLexiconStore.getState().deleteRule(id);
        expect(Object.keys(useLexiconStore.getState().rules).length).toBe(0);
    });

    it('should reorder rules', () => {
        useLexiconStore.getState().addRule({ original: '1', replacement: '1' }); // Order 0
        useLexiconStore.getState().addRule({ original: '2', replacement: '2' }); // Order 1
        useLexiconStore.getState().addRule({ original: '3', replacement: '3' }); // Order 2

        const rules = Object.values(useLexiconStore.getState().rules);
        const r1 = rules.find(r => r.original === '1')!;
        const r2 = rules.find(r => r.original === '2')!;
        const r3 = rules.find(r => r.original === '3')!;

        expect(r1.order).toBe(0);
        expect(r2.order).toBe(1);
        expect(r3.order).toBe(2);

        // Swap 1 and 3
        useLexiconStore.getState().reorderRules([
            { id: r1.id, order: 2 },
            { id: r3.id, order: 0 }
        ]);

        const updated = useLexiconStore.getState().rules;
        expect(updated[r1.id].order).toBe(2);
        expect(updated[r3.id].order).toBe(0);
        expect(updated[r2.id].order).toBe(1); // Unchanged
    });

    it('should set bible preference', () => {
        useLexiconStore.getState().setBiblePreference('book1', 'on');
        expect(useLexiconStore.getState().settings['book1'].bibleLexiconEnabled).toBe('on');

        useLexiconStore.getState().setBiblePreference('book1', 'off');
        expect(useLexiconStore.getState().settings['book1'].bibleLexiconEnabled).toBe('off');
    });
});
