# Google Drive: Partial EPUB Downloads for Metadata & Covers

## Verdict: Feasible

It is possible to retrieve an EPUB's title/author/description/language and its
cover image from Google Drive by downloading a few small byte ranges instead of
the whole file — typically **~100–500 KB across 3–4 requests** vs. a multi-MB
full download. Every building block is already in place or standard:

1. **Drive API supports ranged downloads.** `GET files/{id}?alt=media` honors
   the HTTP `Range: bytes=start-end` header and returns `206 Partial Content`
   (documented under "Partial download" in the Drive v3 manage-downloads
   guide). The one exception — Google Workspace doc *exports* — doesn't apply:
   our files are real `.epub` blobs.
2. **We already know the file size before downloading.** `DriveClient.listFiles`
   requests the `size` field and `DriveFileIndex` persists it
   (`src/domains/google/drive/DriveLibrarySync.ts` `mapToDriveFileIndex`), so
   tail-of-file ranges can be computed without a `HEAD`/metadata round trip.
3. **The gateway passes headers through untouched.** `DriveClient.fetchWithAuth`
   spreads caller `RequestInit` (including `headers`) into
   `egress('drive', …)`, and `NetworkGateway.egress` forwards `init` verbatim
   to `fetch`. No kernel changes needed; the `drive` destination already has
   `timeoutMs: null` (abortable, unbounded) which suits small ranged GETs fine.
4. **Browsers can inflate ZIP entries natively.**
   `new DecompressionStream('deflate-raw')` handles ZIP method 8 (deflate)
   without adding a decompression library (Chrome 103+, Safari 16.4+,
   Firefox 113+ — all within our support matrix, including the Capacitor
   Android WebView). OCF only permits methods 0 (stored) and 8 (deflate).

## One correction to the premise

ZIP's authoritative file/directory listing (the **central directory**) lives at
the **end** of the archive, not the beginning — the End Of Central Directory
(EOCD) record is the last thing in the file. What the EPUB spec pins to the
*beginning* is the uncompressed `mimetype` entry (first local file header).
This doesn't change feasibility at all; it just means the first ranged read is
a **tail** fetch rather than a head fetch.

## Read algorithm

Given `{fileId, size}` from the existing Drive index:

1. **Tail fetch** — `Range: bytes=<size-65KB>-<size-1>` (clamp for tiny files).
   Scan backwards for the EOCD signature (`PK\x05\x06`, allowing for a ZIP
   comment). EOCD gives central-directory offset + size. For typical EPUBs the
   central directory is a few KB and already inside this 64 KB window; if not
   (offset < window start), issue one more range for exactly
   `[cdOffset, size-1]`.
2. **Parse the central directory** into
   `{ name → { method, compressedSize, uncompressedSize, localHeaderOffset } }`.
   ~100 lines of `DataView` code; signatures `PK\x01\x02` per entry.
3. **Fetch `META-INF/container.xml`** — range
   `[localHeaderOffset, localHeaderOffset + 30 + nameLen + extraLen + compressedSize]`.
   Read the *local* header (its extra-field length can differ from the central
   one — parse it, don't assume) to find the data start; add a small slack
   (~256 B) to the range end to be safe. Inflate if method 8. Parse out the
   OPF `full-path`.
4. **Fetch the OPF** the same way. Parse:
   - `dc:title`, `dc:creator`, `dc:description`, `dc:language`
   - cover manifest item: EPUB 3 `properties="cover-image"`, falling back to
     EPUB 2 `<meta name="cover" content="{id}"/>` → manifest item by id, and
     heuristics (`id="cover"`, image media-type with "cover" in href).
     Resolve href relative to the OPF's directory.
5. **Fetch the cover entry** by range, inflate if needed, wrap in a `Blob`
   with the manifest's media-type. Feed to the existing
   `browser-image-compression` thumbnail + `extractCoverPalette` steps if we
   want parity with imported books.

Byte budget per book: 64 KB tail + ~1 KB container.xml + 2–50 KB OPF +
20–400 KB cover. Requests are sequential (each depends on the previous), so
per-book latency is ~4 RTTs; across a library, run books concurrently with a
small cap (3–4) to stay under Drive's per-user QPS limits.

## Caveats & mitigations

- **Verify 206.** If a proxy or edge case returns `200` with the full body,
  either cancel the response stream after the needed bytes
  (`response.body.getReader()` + `reader.cancel()`) or treat it as "partial
  unsupported" and skip. Never buffer an unexpected full body.
- **ZIP64.** EPUBs >4 GB or >65 535 entries are vanishingly rare; detect the
  ZIP64 EOCD locator (`PK\x06\x07`) and bail out (fall back to no-preview or
  full download) rather than implementing ZIP64 initially.
- **Content identity.** `computeContentHash` (SHA-256 of full bytes) cannot be
  computed from a partial read — so a partial fetch can't power dedup against
  the local library by contentHash. Drive's `md5Checksum` (already requested in
  `listFiles` fields) can key a Drive-side cache instead: cache extracted
  metadata/cover per `{fileId, md5Checksum}` and refetch only when the checksum
  changes.
- **CORS.** Drive's `alt=media` endpoint serves CORS for browser `fetch`;
  `Range` must survive the preflight. This is the one assumption to validate
  empirically first (a 10-line spike behind the existing auth flow) — if it
  fails on some platform, the Capacitor native HTTP path is an escape hatch.
- **Rate limits.** Sweeping a 500-book folder means ~2000 requests. Do it
  lazily (viewport-driven in the import dialog) rather than eagerly at scan
  time, and persist results so each book pays the cost once per md5.
- **Malformed EPUBs.** All parse failures should degrade to "no preview", never
  to a failed scan — metadata preview is progressive enhancement over the
  existing name/size listing.

## Library choice

- **Hand-rolled reader (recommended).** EOCD + central directory + local
  header parsing is small, dependency-free, and pairs with native
  `DecompressionStream`. Fits the repo's vendored/minimal-deps posture
  (third-party inventory) and is trivially unit-testable against fixture
  bytes.
- `@zip.js/zip.js` supports exactly this pattern (`HttpRangeReader` /
  custom `Reader`), including ZIP64 — an option if we'd rather not own the
  parser, at the cost of a new dependency.
- `jszip` (already a dep) and `epubjs` both require the whole archive in
  memory — neither can do ranged reads.

## Integration sketch

- `DriveClient.downloadFileRange(fileId, start, endInclusive, opts)` — thin
  sibling of `downloadFile` that sets `Range`, asserts 206, returns
  `ArrayBuffer`. (Reuses `fetchWithAuth`'s 401/403 retry policy as-is.)
- New pure module (e.g. `src/domains/library/import/remoteEpubPreview.ts` or
  `src/domains/google/drive/EpubPartialReader.ts`) that takes a
  `readRange(start, end) => Promise<ArrayBuffer>` port — keeps the ZIP/OPF
  logic Drive-agnostic and testable with in-memory fixtures / the existing
  `MockDriveService` seam.
- `DriveLibrarySync.fetchRemoteMetadata(fileId, size)` orchestrates and caches
  into the Drive index (`DriveFileIndex` gains optional
  `{ title, author, coverKey, previewMd5 }`; cover blobs go to IndexedDB keyed
  by fileId).
- UI: `DriveImportDialog` rows lazily hydrate cover + title via
  IntersectionObserver; the diff list from `checkForNewFiles` can show real
  book identities instead of raw filenames.

## Considered and rejected

- **Drive `thumbnailLink`**: Drive does not generate thumbnails for
  `application/epub+zip`, so there's no server-side shortcut.
- **Multipart ranges** (`Range: bytes=a-b,c-d`): would collapse round trips,
  but `multipart/byteranges` parsing in `fetch` is manual and Drive support is
  unreliable; sequential single ranges are simpler and fast enough.
- **Speculative head fetch** (grab first 128 KB hoping container.xml + OPF are
  near the front): often true but not guaranteed by spec; the central-directory
  path is deterministic for one extra small request.
