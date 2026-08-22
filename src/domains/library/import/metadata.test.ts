/**
 * The sanitize-at-ingest boundary: everything written to the library passes
 * through here. A validation hole lets a malformed record into the store,
 * and a sanitization hole lets book-supplied HTML into the UI — EPUB
 * metadata is attacker-controlled content as far as this app is concerned.
 * Mutation testing scored this module at 6%, so essentially none of it was
 * being asserted on.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getSanitizedBookMetadata, sanitizeString } from './metadata';

const validRecord = () => ({
  id: 'book-1',
  title: 'A Title',
  author: 'An Author',
  addedAt: 1_700_000_000_000,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeString', () => {
  it('passes clean text through unchanged', () => {
    expect(sanitizeString('Moby Dick')).toBe('Moby Dick');
  });

  it('strips HTML tags but keeps their text', () => {
    expect(sanitizeString('<b>bold</b>')).toBe('bold');
  });

  it('removes a script payload entirely', () => {
    expect(sanitizeString('<script>alert(1)</script>')).not.toContain('alert');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeString('   spaced   ')).toBe('spaced');
  });

  it('truncates to the default maximum of 255', () => {
    expect(sanitizeString('x'.repeat(300))).toHaveLength(255);
  });

  it('honours an explicit maximum', () => {
    expect(sanitizeString('x'.repeat(300), 10)).toHaveLength(10);
    expect(sanitizeString('x'.repeat(300), 500)).toHaveLength(300);
  });

  it('keeps a string exactly at the limit intact', () => {
    expect(sanitizeString('x'.repeat(255))).toHaveLength(255);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeString(undefined as unknown as string)).toBe('');
    expect(sanitizeString(null as unknown as string)).toBe('');
    expect(sanitizeString(42 as unknown as string)).toBe('');
    expect(sanitizeString({} as unknown as string)).toBe('');
  });

  it('returns empty string for input that was entirely markup', () => {
    expect(sanitizeString('<br/>')).toBe('');
  });

  /* Trim happens before truncation, so padding does not eat the budget. */
  it('trims before truncating', () => {
    expect(sanitizeString(`   ${'y'.repeat(10)}   `, 10)).toBe('y'.repeat(10));
  });
});

describe('getSanitizedBookMetadata validation', () => {
  it('accepts a well-formed record', () => {
    expect(getSanitizedBookMetadata(validRecord())).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a record'],
    ['a number', 7],
  ])('rejects %s', (_label, input) => {
    expect(getSanitizedBookMetadata(input)).toBeNull();
  });

  it('rejects a missing or non-string id', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), id: undefined })).toBeNull();
    expect(getSanitizedBookMetadata({ ...validRecord(), id: 42 })).toBeNull();
  });

  /* An id of only whitespace is not a usable key. */
  it('rejects a blank or whitespace-only id', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), id: '' })).toBeNull();
    expect(getSanitizedBookMetadata({ ...validRecord(), id: '   ' })).toBeNull();
  });

  it('rejects a non-string title or author', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), title: 42 })).toBeNull();
    expect(getSanitizedBookMetadata({ ...validRecord(), author: null })).toBeNull();
  });

  /* Empty title/author are allowed — ingest supplies defaults. */
  it('accepts empty title and author strings', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), title: '', author: '' })).not.toBeNull();
  });

  it('rejects a non-numeric addedAt', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), addedAt: '1700000000000' })).toBeNull();
    expect(getSanitizedBookMetadata({ ...validRecord(), addedAt: undefined })).toBeNull();
  });

  it('accepts addedAt of 0', () => {
    expect(getSanitizedBookMetadata({ ...validRecord(), addedAt: 0 })).not.toBeNull();
  });

  it('reports every missing field, not just the first', () => {
    getSanitizedBookMetadata({ id: '', title: 1, author: 2, addedAt: 'x' });

    const message = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join(' ');

    expect(message).toContain('id');
    expect(message).toContain('title');
    expect(message).toContain('author');
    expect(message).toContain('addedAt');
  });
});

describe('getSanitizedBookMetadata sanitization reporting', () => {
  it('reports no modification for already-clean metadata', () => {
    const result = getSanitizedBookMetadata(validRecord());

    expect(result?.wasModified).toBe(false);
    expect(result?.modifications).toEqual([]);
  });

  it('sanitizes and reports a modified title', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), title: '<b>Bold</b>' });

    expect(result?.sanitized.title).toBe('Bold');
    expect(result?.wasModified).toBe(true);
    expect(result?.modifications.some((m) => m.startsWith('Title sanitized'))).toBe(true);
  });

  it('sanitizes and reports a modified author', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), author: '  Spaced  ' });

    expect(result?.sanitized.author).toBe('Spaced');
    expect(result?.modifications.some((m) => m.startsWith('Author sanitized'))).toBe(true);
  });

  it('reports title and author independently', () => {
    const result = getSanitizedBookMetadata({
      ...validRecord(),
      title: '<i>T</i>',
      author: 'Clean Author',
    });

    expect(result?.modifications).toHaveLength(1);
    expect(result?.modifications[0]).toContain('Title');
  });

  /*
   * Title gets a 500-character budget while author gets 255 — collapsing
   * them would silently truncate long titles.
   */
  it('allows a longer title than author', () => {
    const result = getSanitizedBookMetadata({
      ...validRecord(),
      title: 'x'.repeat(400),
      author: 'y'.repeat(400),
    });

    expect(result?.sanitized.title).toHaveLength(400);
    expect(result?.sanitized.author).toHaveLength(255);
  });

  it('truncates a title past 500', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), title: 'x'.repeat(600) });

    expect(result?.sanitized.title).toHaveLength(500);
    expect(result?.modifications[0]).toContain('100 characters');
  });

  it('sanitizes description with its own 2000 budget', () => {
    const result = getSanitizedBookMetadata({
      ...validRecord(),
      description: 'd'.repeat(2500),
    });

    expect(result?.sanitized.description).toHaveLength(2000);
    expect(result?.modifications.some((m) => m.startsWith('Description sanitized'))).toBe(true);
  });

  it('leaves a clean description untouched and unreported', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), description: 'A summary.' });

    expect(result?.sanitized.description).toBe('A summary.');
    expect(result?.wasModified).toBe(false);
  });

  /* A non-string description passes through rather than becoming ''. */
  it('passes a non-string description through untouched', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), description: undefined });

    expect(result?.sanitized.description).toBeUndefined();
    expect(result?.wasModified).toBe(false);
  });

  it('preserves fields it does not sanitize', () => {
    const result = getSanitizedBookMetadata({ ...validRecord(), coverUrl: 'blob:abc' });

    expect((result?.sanitized as Record<string, unknown>).coverUrl).toBe('blob:abc');
    expect(result?.sanitized.id).toBe('book-1');
    expect(result?.sanitized.addedAt).toBe(1_700_000_000_000);
  });

  it('strips a script payload out of the title', () => {
    const result = getSanitizedBookMetadata({
      ...validRecord(),
      title: 'Safe<script>alert(1)</script>',
    });

    expect(result?.sanitized.title).not.toContain('alert');
    expect(result?.wasModified).toBe(true);
  });
});
