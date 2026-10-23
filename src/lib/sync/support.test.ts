import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStorageSupported } from './support';

describe('isStorageSupported', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('is true when window.indexedDB exists', () => {
        vi.stubGlobal('indexedDB', {});
        expect(isStorageSupported()).toBe(true);
    });

    it('is false when window.indexedDB is null (restricted iframe)', () => {
        vi.stubGlobal('indexedDB', null);
        expect(isStorageSupported()).toBe(false);
    });

    it('is false (and does not throw) when reading indexedDB throws', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const original = Object.getOwnPropertyDescriptor(window, 'indexedDB');
        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            get() {
                throw new Error('SecurityError');
            },
        });
        try {
            expect(isStorageSupported()).toBe(false);
        } finally {
            if (original) Object.defineProperty(window, 'indexedDB', original);
            else delete (window as unknown as Record<string, unknown>).indexedDB;
        }
    });
});
