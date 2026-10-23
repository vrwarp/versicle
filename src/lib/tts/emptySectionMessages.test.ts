import { describe, it, expect } from 'vitest';
import { emptySectionMessage } from './emptySectionMessages';

describe('emptySectionMessage', () => {
    it('defaults to English when the language is missing or empty', () => {
        expect(emptySectionMessage(undefined)).toBe('There is no text to read here.');
        expect(emptySectionMessage('')).toBe('There is no text to read here.');
    });

    it('resolves on the primary subtag, case-insensitively, for - and _ separators', () => {
        const zh = emptySectionMessage('zh');
        expect(zh).not.toBe(emptySectionMessage('en'));
        expect(emptySectionMessage('zh-TW')).toBe(zh);
        expect(emptySectionMessage('ZH_hant')).toBe(zh);
        expect(emptySectionMessage('en-GB')).toBe(emptySectionMessage('en'));
    });

    it('falls back to English for languages without a catalog entry', () => {
        expect(emptySectionMessage('fr')).toBe(emptySectionMessage('en'));
    });
});
