import { describe, it, expect } from 'vitest';
import { getYDoc, waitForYjsSync } from './yjs-provider';
import * as Y from 'yjs';

describe('Yjs Provider', () => {
    it('should lazily construct a single Y.Doc (no module-scope side effect)', () => {
        const yDoc = getYDoc();
        expect(yDoc).toBeInstanceOf(Y.Doc);
        // Repeated calls return the same singleton.
        expect(getYDoc()).toBe(yDoc);
    });

    it('should allow basic Yjs operations', () => {
        const map = getYDoc().getMap('test-map');
        map.set('foo', 'bar');
        expect(map.get('foo')).toBe('bar');
    });

    it('waitForYjsSync should resolve (mocked env means immediate or timeout)', async () => {
        // In test env (jsdom/node), IndexedDB might be mocked or absent.
        // We just ensure it doesn't hang forever.
        await expect(waitForYjsSync(100)).resolves.not.toThrow();
    });
});
