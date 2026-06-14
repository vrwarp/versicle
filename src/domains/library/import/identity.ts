/**
 * Book content identity (Phase 7, phase7-library-google.md §B "identify").
 *
 * Two generations of identity live side by side:
 *
 *  - `contentHash` — SHA-256 (hex) over the EPUB's content bytes only.
 *    Filename-independent, collision-resistant; what every P7+ manifest
 *    carries and what restore acceptance prefers (pays ingestion-library D7:
 *    the legacy fingerprint embeds the filename, so a renamed file could
 *    never be restored).
 *  - The legacy fingerprint (`generateFileFingerprint`, pre-P7 `fileHash`):
 *    `${filename}-${title}-${author}-${djb2(head 4KiB)}-${djb2(tail 4KiB)}`.
 *    Still WRITTEN for backward compatibility and ACCEPTED on restore via
 *    its filename-independent content tail (the two trailing djb2 hashes) —
 *    a successful legacy match triggers the lazy `contentHash` manifest
 *    upgrade in the orchestrator.
 */

/** djb2 over a buffer — the legacy fingerprint's content hash (verbatim from lib/ingestion.ts). */
export function cheapHash(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 5381;
  for (let i = 0; i < view.length; i++) {
    hash = (hash << 5) + hash + view[i]; /* hash * 33 + c */
  }
  return (hash >>> 0).toString(16);
}

/**
 * The filename/metadata-independent tail of the legacy fingerprint:
 * `${djb2(first 4KiB)}-${djb2(last 4KiB)}`.
 */
export async function legacyContentTail(file: Blob): Promise<string> {
  const headSize = Math.min(4096, file.size);
  const head = await file.slice(0, headSize).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - 4096), file.size).arrayBuffer();
  return `${cheapHash(head)}-${cheapHash(tail)}`;
}

/**
 * The legacy identity fingerprint (pre-P7 `manifest.fileHash`). Moved
 * verbatim from `lib/ingestion.ts generateFileFingerprint`; still written to
 * new manifests so older builds keep verifying restores.
 */
export async function computeLegacyFingerprint(
  file: Blob,
  metadata: { title: string; author: string; filename: string },
): Promise<string> {
  const metaString = `${metadata.filename}-${metadata.title}-${metadata.author}`;
  return `${metaString}-${await legacyContentTail(file)}`;
}

/** SHA-256 (hex) over the file's content bytes — the P7 `contentHash`. */
export async function computeContentHash(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Restore acceptance against a PRE-P7 manifest: does `file`'s content match
 * the stored legacy fingerprint, ignoring the filename/title/author prefix?
 *
 * The prefix may contain `-` (filenames, authors), so the only robust
 * comparison is the suffix match on the two djb2 hex tokens — which are
 * derived from content alone.
 */
export async function matchesLegacyFingerprint(storedFileHash: string, file: Blob): Promise<boolean> {
  if (!storedFileHash) return false;
  const tail = await legacyContentTail(file);
  return storedFileHash.endsWith(`-${tail}`);
}
