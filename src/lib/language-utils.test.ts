import { describe, it, expect } from 'vitest';
import { normalizeLanguageCode } from './language-utils';

describe('normalizeLanguageCode', () => {
    it('should normalize standard 2-letter codes', () => {
        expect(normalizeLanguageCode('en')).toBe('en');
        expect(normalizeLanguageCode('zh')).toBe('zh');
        expect(normalizeLanguageCode('FR')).toBe('fr');
    });

    it('should normalize standard locale tags', () => {
        expect(normalizeLanguageCode('en-US')).toBe('en');
        expect(normalizeLanguageCode('zh-CN')).toBe('zh');
        expect(normalizeLanguageCode('fr-FR')).toBe('fr');
        expect(normalizeLanguageCode('en_US')).toBe('en');
    });

    it('should normalize common 3-letter codes', () => {
        expect(normalizeLanguageCode('eng')).toBe('en');
        expect(normalizeLanguageCode('zho')).toBe('zh');
        expect(normalizeLanguageCode('chi')).toBe('zh');
        expect(normalizeLanguageCode('fra')).toBe('fr');
        expect(normalizeLanguageCode('fre')).toBe('fr');
        expect(normalizeLanguageCode('spa')).toBe('es');
        expect(normalizeLanguageCode('deu')).toBe('de');
        expect(normalizeLanguageCode('ger')).toBe('de');
        expect(normalizeLanguageCode('jpn')).toBe('ja');
        expect(normalizeLanguageCode('kor')).toBe('ko');
    });

    it('should fallback to en for malformed or unrecognized long codes', () => {
        expect(normalizeLanguageCode('invalid')).toBe('en');
        expect(normalizeLanguageCode('')).toBe('en');
        expect(normalizeLanguageCode(null)).toBe('en');
        expect(normalizeLanguageCode(undefined)).toBe('en');
    });

    it('should keep valid but unmapped 2 or 3 letter codes', () => {
        // e.g., standard codes not in mapping list but valid 2-3 letters
        expect(normalizeLanguageCode('fi')).toBe('fi');
        expect(normalizeLanguageCode('fin')).toBe('fin');
    });
});
