import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lexiconApplier } from './LexiconApplier';



describe('LexiconEngine trace companion', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should trace rule application', () => {
        const rules = [
            { id: '1', original: 'Hello', replacement: 'Hi', created: 0 },
            { id: '2', original: 'World', replacement: 'Earth', created: 0 }
        ];

        const result = lexiconApplier.applyLexiconWithTrace('Hello World', rules);

        expect(result.final).toBe('Hi Earth');
        expect(result.trace).toHaveLength(2);

        expect(result.trace[0].before).toBe('Hello World');
        expect(result.trace[0].after).toBe('Hi World');
        expect(result.trace[0].rule.id).toBe('1');

        expect(result.trace[1].before).toBe('Hi World');
        expect(result.trace[1].after).toBe('Hi Earth');
        expect(result.trace[1].rule.id).toBe('2');
    });

    it('should ignore rules that do not change text in trace', () => {
        const rules = [
            { id: '1', original: 'Foo', replacement: 'Bar', created: 0 },
            { id: '2', original: 'World', replacement: 'Earth', created: 0 }
        ];

        const result = lexiconApplier.applyLexiconWithTrace('Hello World', rules);

        expect(result.final).toBe('Hello Earth');
        expect(result.trace).toHaveLength(1);
        expect(result.trace[0].rule.id).toBe('2');
    });
});
