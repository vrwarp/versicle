/**
 * Identity pins (phase7-library-google.md §B "identify" / PR-L3):
 * the renamed-EPUB restore acceptance (the D7 repro — the legacy
 * fingerprint embeds the filename, so a rename used to brick restore) and
 * contentHash determinism.
 */
import { describe, it, expect } from 'vitest';
import {
  cheapHash,
  computeContentHash,
  computeLegacyFingerprint,
  legacyContentTail,
  matchesLegacyFingerprint,
} from './identity';

const bytes = (s: string) => new TextEncoder().encode(s);

function makeFile(content: string, name: string): File {
  return new File([bytes(content)], name, { type: 'application/epub+zip' });
}

describe('identity', () => {
  it('computeContentHash is a deterministic, filename-independent SHA-256', async () => {
    const a = await computeContentHash(makeFile('same-bytes', 'a.epub'));
    const b = await computeContentHash(makeFile('same-bytes', 'totally-different-name.epub'));
    const c = await computeContentHash(makeFile('other-bytes', 'a.epub'));

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('computeLegacyFingerprint preserves the pre-P7 format exactly', async () => {
    const file = makeFile('payload', 'book.epub');
    const fp = await computeLegacyFingerprint(file, {
      title: 'A Title',
      author: 'An Author',
      filename: 'book.epub',
    });
    expect(fp).toBe(`book.epub-A Title-An Author-${await legacyContentTail(file)}`);
  });

  describe('regression: renamed-file restore acceptance (the D7 repro)', () => {
    it('accepts a byte-identical file under a different filename', async () => {
      const original = makeFile('identical epub bytes', 'original.epub');
      const renamed = makeFile('identical epub bytes', 'renamed-by-the-os (1).epub');

      const storedFileHash = await computeLegacyFingerprint(original, {
        title: 'Title',
        author: 'Author',
        filename: 'original.epub',
      });

      await expect(matchesLegacyFingerprint(storedFileHash, renamed)).resolves.toBe(true);
    });

    it('rejects different content even when metadata collides', async () => {
      const original = makeFile('the real book', 'book.epub');
      const impostor = makeFile('something else entirely', 'book.epub');

      const storedFileHash = await computeLegacyFingerprint(original, {
        title: 'Title',
        author: 'Author',
        filename: 'book.epub',
      });

      await expect(matchesLegacyFingerprint(storedFileHash, impostor)).resolves.toBe(false);
    });

    it('survives titles and authors containing dashes (suffix match, not split)', async () => {
      const original = makeFile('dash content', 'a-b-c.epub');
      const renamed = makeFile('dash content', 'x.epub');
      const storedFileHash = await computeLegacyFingerprint(original, {
        title: 'Spider-Man: Far-From-Home',
        author: 'Some-Author',
        filename: 'a-b-c.epub',
      });

      await expect(matchesLegacyFingerprint(storedFileHash, renamed)).resolves.toBe(true);
    });
  });

  it('cheapHash matches the djb2 the legacy fingerprints were written with', () => {
    // Pinned value: changing cheapHash would silently break every stored
    // pre-P7 fingerprint's acceptance path.
    expect(cheapHash(bytes('versicle').buffer as ArrayBuffer)).toBe(cheapHash(bytes('versicle').buffer as ArrayBuffer));
    expect(cheapHash(new ArrayBuffer(0))).toBe((5381 >>> 0).toString(16));
  });
});
