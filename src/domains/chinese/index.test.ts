/**
 * domains/chinese entry suite (Phase 6 §7, PR-10): the CH-8 interim
 * base-language helper that gates registration from the app layer.
 *
 * ABSORPTION NOTE: replaces the "non-zh books bypass the pipeline" pin of
 * the deleted useEpubReader_Pinyin.characterization.test.tsx — activation
 * is now a registration decision in app/reader/useReaderController (books
 * whose base language is not 'zh' never register, and unregistration
 * clears the overlay positions).
 */
import { describe, it, expect } from 'vitest';
import { getBookBaseLanguage } from './index';

describe('getBookBaseLanguage (CH-8 interim helper)', () => {
  it('passes plain base subtags through', () => {
    expect(getBookBaseLanguage('zh')).toBe('zh');
    expect(getBookBaseLanguage('en')).toBe('en');
  });

  it('normalizes region/script subtags and case (the legacy exact-match bug)', () => {
    expect(getBookBaseLanguage('zh-CN')).toBe('zh');
    expect(getBookBaseLanguage('zh-Hant-TW')).toBe('zh');
    expect(getBookBaseLanguage('zh_TW')).toBe('zh');
    expect(getBookBaseLanguage('ZH')).toBe('zh');
    expect(getBookBaseLanguage(' zh-CN ')).toBe('zh');
  });

  it('defaults to en for absent values', () => {
    expect(getBookBaseLanguage(undefined)).toBe('en');
    expect(getBookBaseLanguage(null)).toBe('en');
    expect(getBookBaseLanguage('')).toBe('en');
  });
});
