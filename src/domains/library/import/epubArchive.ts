/**
 * Adapter: an opened, ARCHIVED epub.js Book → the `ArchivePort` the pure
 * structure resolvers (`@lib/epub/structure`) read through, so import reuses
 * the zip epub.js already inflated instead of opening the file twice.
 *
 * epub.js `Archive.getText/getBlob` take a root-absolute URL and
 * `decodeURIComponent` it, returning `undefined` for a missing entry and
 * throwing on a malformed escape (a literal `%` in a file name) — the
 * encoded retry covers that case.
 */
import type { ArchivePort } from '@lib/epub/structure/bookStructure';
import { encodePath } from '@lib/epub/structure/paths';

interface EpubJsArchiveLike {
  getText(url: string): Promise<string> | undefined;
  getBlob(url: string, mimeType?: string): Promise<Blob> | undefined;
}

interface EpubJsBookLike {
  archive?: EpubJsArchiveLike;
  container?: { packagePath?: string };
}

async function tryBoth<T>(zipPath: string, read: (url: string) => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return (await read(`/${zipPath}`)) ?? undefined;
  } catch {
    try {
      return (await read(`/${encodePath(zipPath)}`)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

/** The port plus the OPF's zip path, or `null` for a non-archived/mocked book. */
export function archiveOfEpubJsBook(book: unknown): { port: ArchivePort; opfPath: string } | null {
  const { archive, container } = (book ?? {}) as EpubJsBookLike;
  const opfPath = container?.packagePath;
  if (!archive || typeof archive.getText !== 'function' || typeof archive.getBlob !== 'function' || !opfPath) {
    return null;
  }
  return {
    opfPath,
    port: {
      readText: (zipPath) => tryBoth(zipPath, (url) => archive.getText(url)),
      readBlob: (zipPath, mediaType) => tryBoth(zipPath, (url) => archive.getBlob(url, mediaType || undefined)),
    },
  };
}
