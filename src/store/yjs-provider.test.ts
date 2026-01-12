import { describe, it, expect } from 'vitest';
import { yDoc, waitForYjsSync } from './yjs-provider';
import * as Y from 'yjs';

describe('Yjs Provider', () => {
    it('should export a valid Y.Doc singleton', () => {
        expect(yDoc).toBeInstanceOf(Y.Doc);
    });

    it('should allow basic Yjs operations', () => {
        const map = yDoc.getMap('test-map');
        map.set('foo', 'bar');
        expect(map.get('foo')).toBe('bar');
    });

    it('waitForYjsSync should resolve (mocked env means immediate or timeout)', async () => {
        // In test env (jsdom/node), IndexedDB might be mocked or absent.
        // We just ensure it doesn't hang forever.
        await expect(waitForYjsSync(100)).resolves.not.toThrow();
    });
});
