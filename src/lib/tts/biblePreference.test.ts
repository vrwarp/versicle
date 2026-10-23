import { describe, it, expect } from 'vitest';
import { resolveBiblePreference } from './biblePreference';

describe('resolveBiblePreference', () => {
    it('per-book "on" and "off" win over the global flag', () => {
        expect(resolveBiblePreference('on', false)).toBe(true);
        expect(resolveBiblePreference('off', true)).toBe(false);
    });

    it('"default" and an unset preference defer to the global flag', () => {
        expect(resolveBiblePreference('default', true)).toBe(true);
        expect(resolveBiblePreference('default', false)).toBe(false);
        expect(resolveBiblePreference(undefined, true)).toBe(true);
        expect(resolveBiblePreference(undefined, false)).toBe(false);
    });
});
