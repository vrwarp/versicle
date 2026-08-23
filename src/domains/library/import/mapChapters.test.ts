/**
 * mapChapters turns rendered chapters into the five parallel row-sets the
 * library stores: synthetic TOC, section metadata, TTS prep, table images
 * and the search corpus. Every id it mints is a primary key elsewhere, and
 * a mismatch between the sets (a section without its TTS row, a table
 * keyed to the wrong section) shows up much later as content that silently
 * fails to load.
 */
import { describe, expect, it } from 'vitest';
import { mapChapters } from './extract';

const chapter = (over: Record<string, unknown> = {}) => ({
  href: 'ch1.xhtml',
  title: 'Chapter One',
  textContent: 'Hello world.',
  sentences: ['Hello world.'],
  citationMarkers: [],
  tables: [],
  ...over,
}) as never;

describe('mapChapters', () => {
  it('returns empty row-sets for no chapters', () => {
    const result = mapChapters('b1', []);

    expect(result.syntheticToc).toEqual([]);
    expect(result.sections).toEqual([]);
    expect(result.ttsContentBatches).toEqual([]);
    expect(result.tableBatches).toEqual([]);
    expect(result.searchSections).toEqual([]);
    expect(result.totalChars).toBe(0);
  });

  describe('synthetic table of contents', () => {
    it('numbers entries by position', () => {
      const result = mapChapters('b1', [chapter({ href: 'a' }), chapter({ href: 'b' })]);

      expect(result.syntheticToc.map((t) => t.id)).toEqual(['syn-toc-0', 'syn-toc-1']);
      expect(result.syntheticToc.map((t) => t.href)).toEqual(['a', 'b']);
    });

    it('uses the chapter title as the label', () => {
      expect(mapChapters('b1', [chapter({ title: 'Prologue' })]).syntheticToc[0].label)
        .toBe('Prologue');
    });

    /* An untitled chapter still needs a label the user can navigate by. */
    it('falls back to a 1-based positional label', () => {
      const result = mapChapters('b1', [
        chapter({ title: '' }),
        chapter({ title: undefined }),
      ]);

      expect(result.syntheticToc[0].label).toBe('Chapter 1');
      expect(result.syntheticToc[1].label).toBe('Chapter 2');
    });
  });

  describe('section metadata', () => {
    it('keys sections by book and href', () => {
      expect(mapChapters('b1', [chapter({ href: 'ch7.xhtml' })]).sections[0].id)
        .toBe('b1-ch7.xhtml');
    });

    it('records play order by position', () => {
      const result = mapChapters('b1', [chapter({ href: 'a' }), chapter({ href: 'b' })]);

      expect(result.sections.map((s) => s.playOrder)).toEqual([0, 1]);
    });

    it('counts characters per section', () => {
      expect(mapChapters('b1', [chapter({ textContent: 'abcde' })]).sections[0].characterCount)
        .toBe(5);
    });

    it('sums characters across chapters', () => {
      const result = mapChapters('b1', [
        chapter({ textContent: 'abc' }),
        chapter({ textContent: 'de' }),
      ]);

      expect(result.totalChars).toBe(5);
    });

    it('carries the same fallback title as the toc', () => {
      expect(mapChapters('b1', [chapter({ title: '' })]).sections[0].title).toBe('Chapter 1');
    });
  });

  describe('TTS prep rows', () => {
    it('creates one row per chapter that has sentences', () => {
      const result = mapChapters('b1', [chapter({ href: 'a', sentences: ['One.'] })]);

      expect(result.ttsContentBatches).toHaveLength(1);
      expect(result.ttsContentBatches[0].id).toBe('b1-a');
      expect(result.ttsContentBatches[0].sectionId).toBe('a');
      expect(result.ttsContentBatches[0].sentences).toEqual(['One.']);
    });

    /*
     * A chapter with no sentences (an image plate, a blank page) must not
     * get an empty TTS row — the player would try to read nothing.
     */
    it('skips chapters with no sentences', () => {
      const result = mapChapters('b1', [
        chapter({ href: 'a', sentences: [] }),
        chapter({ href: 'b', sentences: ['One.'] }),
      ]);

      expect(result.ttsContentBatches).toHaveLength(1);
      expect(result.ttsContentBatches[0].sectionId).toBe('b');
    });

    it('still creates a section and toc entry for a sentence-less chapter', () => {
      const result = mapChapters('b1', [chapter({ sentences: [] })]);

      expect(result.sections).toHaveLength(1);
      expect(result.syntheticToc).toHaveLength(1);
    });

    it('carries citation markers when present', () => {
      const result = mapChapters('b1', [chapter({ citationMarkers: [{ index: 1 }] })]);

      expect(result.ttsContentBatches[0].citationMarkers).toEqual([{ index: 1 }]);
    });

    /* Empty markers become undefined rather than an empty array. */
    it('omits empty citation markers', () => {
      expect(mapChapters('b1', [chapter({ citationMarkers: [] })]).ttsContentBatches[0].citationMarkers)
        .toBeUndefined();
    });

    it('stamps the extraction version', () => {
      expect(mapChapters('b1', [chapter()]).ttsContentBatches[0].extractionVersion).toBeDefined();
    });
  });

  describe('table images', () => {
    it('emits nothing when a chapter has no tables', () => {
      expect(mapChapters('b1', [chapter({ tables: [] })]).tableBatches).toEqual([]);
      expect(mapChapters('b1', [chapter({ tables: undefined })]).tableBatches).toEqual([]);
    });

    it('keys a table by book and cfi, and attributes it to its section', () => {
      const blob = new Blob(['img']);
      const result = mapChapters('b1', [
        chapter({ href: 'ch2', tables: [{ cfi: 'epubcfi(/6/4)', imageBlob: blob }] }),
      ]);

      expect(result.tableBatches[0]).toMatchObject({
        id: 'b1-epubcfi(/6/4)',
        bookId: 'b1',
        sectionId: 'ch2',
        cfi: 'epubcfi(/6/4)',
      });
      expect(result.tableBatches[0].imageBlob).toBe(blob);
    });

    it('emits every table in a chapter', () => {
      const result = mapChapters('b1', [
        chapter({ tables: [{ cfi: 'c1', imageBlob: new Blob() }, { cfi: 'c2', imageBlob: new Blob() }] }),
      ]);

      expect(result.tableBatches.map((t) => t.cfi)).toEqual(['c1', 'c2']);
    });

    it('collects tables across chapters', () => {
      const result = mapChapters('b1', [
        chapter({ href: 'a', tables: [{ cfi: 'c1', imageBlob: new Blob() }] }),
        chapter({ href: 'b', tables: [{ cfi: 'c2', imageBlob: new Blob() }] }),
      ]);

      expect(result.tableBatches.map((t) => t.sectionId)).toEqual(['a', 'b']);
    });
  });

  describe('search corpus', () => {
    it('records the section text and title', () => {
      const result = mapChapters('b1', [chapter({ href: 'a', title: 'T', textContent: 'body' })]);

      expect(result.searchSections[0]).toMatchObject({ href: 'a', title: 'T', text: 'body' });
    });

    /*
     * The hash is the embedding indexer's skip key: identical text must
     * hash identically so re-import does not re-embed, and different text
     * must not collide or stale embeddings are kept.
     */
    it('hashes identical text identically', () => {
      const a = mapChapters('b1', [chapter({ textContent: 'same text' })]).searchSections[0];
      const b = mapChapters('b2', [chapter({ textContent: 'same text' })]).searchSections[0];

      expect(a.sectionTextHash).toBe(b.sectionTextHash);
    });

    it('hashes different text differently', () => {
      const a = mapChapters('b1', [chapter({ textContent: 'one' })]).searchSections[0];
      const b = mapChapters('b1', [chapter({ textContent: 'two' })]).searchSections[0];

      expect(a.sectionTextHash).not.toBe(b.sectionTextHash);
    });

    it('uses the fallback title in the corpus too', () => {
      expect(mapChapters('b1', [chapter({ title: '' })]).searchSections[0].title).toBe('Chapter 1');
    });
  });

  it('keeps the five row-sets aligned for a mixed book', () => {
    const result = mapChapters('b1', [
      chapter({ href: 'a', sentences: ['s'], tables: [] }),
      chapter({ href: 'b', sentences: [], tables: [{ cfi: 'c', imageBlob: new Blob() }] }),
    ]);

    expect(result.sections).toHaveLength(2);
    expect(result.syntheticToc).toHaveLength(2);
    expect(result.searchSections).toHaveLength(2);
    expect(result.ttsContentBatches).toHaveLength(1);
    expect(result.tableBatches).toHaveLength(1);
  });
});
