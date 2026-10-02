import { describe, it, expect } from 'vitest';
import {
  basename,
  canonicalKey,
  dirname,
  normalizePath,
  resolveRelative,
  safeDecode,
  splitFragment,
  withFragment,
} from './paths';

describe('paths', () => {
  it('dirname / basename', () => {
    expect(dirname('OEBPS/Text/ch1.xhtml')).toBe('OEBPS/Text/');
    expect(dirname('ch1.xhtml')).toBe('');
    expect(basename('a/b/c.xhtml#frag')).toBe('c.xhtml');
  });

  it('splits and re-joins fragments', () => {
    expect(splitFragment('a.xhtml#x')).toEqual(['a.xhtml', 'x']);
    expect(splitFragment('a.xhtml')).toEqual(['a.xhtml', '']);
    expect(withFragment('a.xhtml', '')).toBe('a.xhtml');
    expect(withFragment('a.xhtml', 'x')).toBe('a.xhtml#x');
  });

  it('safeDecode never throws on a malformed escape', () => {
    expect(safeDecode('100%.jpg')).toBe('100%.jpg');
    expect(safeDecode('don%27t')).toBe("don't");
  });

  it('normalizes dot segments, separators and clamps above-root', () => {
    expect(normalizePath('./a/./b/../c.xhtml')).toBe('a/c.xhtml');
    expect(normalizePath('/OEBPS//Text/x.xhtml')).toBe('OEBPS/Text/x.xhtml');
    expect(normalizePath('a\\b\\c.xhtml')).toBe('a/b/c.xhtml');
    expect(normalizePath('../../x.xhtml')).toBe('x.xhtml');
  });

  describe('resolveRelative', () => {
    it('resolves against the referring document, not the OPF (the T1 bug)', () => {
      expect(resolveRelative('Text/toc.xhtml', '../Text/CH1.xhtml')).toBe('Text/CH1.xhtml');
      expect(resolveRelative('Text/toc.xhtml', 'CH1.xhtml#p3')).toBe('Text/CH1.xhtml#p3');
    });

    it('treats a leading slash as zip-root and drops query strings', () => {
      expect(resolveRelative('Text/toc.xhtml', '/OEBPS/x.xhtml')).toBe('OEBPS/x.xhtml');
      expect(resolveRelative('Text/toc.xhtml', 'x.xhtml?v=2#y')).toBe('Text/x.xhtml#y');
    });

    it('resolves a fragment-only href to the base document', () => {
      expect(resolveRelative('Text/ch2.xhtml', '#sec2')).toBe('Text/ch2.xhtml#sec2');
    });
  });

  it('canonicalKey folds case, encoding, NFC and separators', () => {
    expect(canonicalKey('Text/Chapter%20One.XHTML')).toBe('text/chapter one.xhtml');
    expect(canonicalKey('./Text\\ch1.xhtml#x')).toBe('text/ch1.xhtml');
    // NFD "é" and NFC "é" collapse to one key.
    expect(canonicalKey('café.xhtml')).toBe(canonicalKey('café.xhtml'));
  });
});
