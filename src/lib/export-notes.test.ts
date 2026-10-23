import { describe, it, expect, vi, afterEach } from 'vitest';
import type { UserAnnotation } from '~types/user-data';
import { copyAnnotationAsMarkdown } from './export-notes';

const annotation = (text: string, note?: string) => ({ text, note }) as UserAnnotation;

describe('copyAnnotationAsMarkdown', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  afterEach(() => {
    writeText.mockClear();
    vi.unstubAllGlobals();
  });

  it('quotes a single-line highlight and appends the note', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyAnnotationAsMarkdown(annotation('Hello', 'My note'));
    expect(writeText).toHaveBeenCalledWith('> Hello\n\n**Note:** My note');
  });

  it('regression: prefixes every line of a multi-line highlight with ">"', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyAnnotationAsMarkdown(annotation('line one\nline two\r\nline three'));
    expect(writeText).toHaveBeenCalledWith('> line one\n> line two\n> line three');
  });
});
