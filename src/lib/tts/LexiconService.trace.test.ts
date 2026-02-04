import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LexiconService } from './LexiconService';

// Mock dependencies
vi.mock('../../store/useLexiconStore', () => ({
    useLexiconStore: {
        getState: vi.fn().mockReturnValue({
            rules: {},
            addRule: vi.fn(),
            updateRule: vi.fn(),
            settings: {}
        })
    }
}));

vi.mock('../../store/yjs-provider', async () => {
    const Y = await import('yjs');
    return {
        waitForYjsSync: vi.fn().mockResolvedValue(undefined),
        yDoc: new Y.Doc()
    };
});

describe('LexiconService Trace', () => {
    let service: LexiconService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = LexiconService.getInstance();
    });

    it('should trace rule application', () => {
        const rules = [
            { id: '1', original: 'Hello', replacement: 'Hi', created: 0 },
            { id: '2', original: 'World', replacement: 'Earth', created: 0 }
        ];

        const result = service.applyLexiconWithTrace('Hello World', rules);

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

        const result = service.applyLexiconWithTrace('Hello World', rules);

        expect(result.final).toBe('Hello Earth');
        expect(result.trace).toHaveLength(1);
        expect(result.trace[0].rule.id).toBe('2');
    });
});
