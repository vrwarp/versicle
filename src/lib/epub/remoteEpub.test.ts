/**
 * RemoteEpubReader fixture matrix: real EPUB ZIPs built in-memory with jszip,
 * read back through a buffer-backed RangeReader. Covers EPUB2/EPUB3 cover
 * conventions, stored vs deflated entries, ZIP comments, a central directory
 * that straddles the tail window, missing cover, malformed OPF, ZIP64 bail,
 * and that large files are read via targeted ranges (not fully buffered).
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  readRemoteEpubPreview,
  UnextractableEpubError,
  type RangeReader,
} from './remoteEpub';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

interface OpfOpts {
  title?: string;
  creator?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  /** 'epub3' → properties="cover-image"; 'epub2' → <meta name="cover">; 'none'. */
  coverStyle?: 'epub3' | 'epub2' | 'none';
}

function buildOpf(o: OpfOpts): string {
  const ids = (o.identifiers ?? ['urn:isbn:9781234567890'])
    .map((v, i) => `<dc:identifier id="id${i}">${v}</dc:identifier>`)
    .join('\n    ');
  const coverItem =
    o.coverStyle === 'epub3'
      ? `<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>`
      : o.coverStyle === 'epub2'
        ? `<item id="cover-img" href="images/cover.png" media-type="image/png"/>`
        : '';
  const coverMeta = o.coverStyle === 'epub2' ? `<meta name="cover" content="cover-img"/>` : '';
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${o.title ?? 'Untitled'}</dc:title>
    <dc:creator>${o.creator ?? 'Anon'}</dc:creator>
    ${o.description ? `<dc:description>${o.description}</dc:description>` : ''}
    <dc:language>${o.language ?? 'en'}</dc:language>
    ${ids}
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
    ${coverItem}
  </manifest>
  <spine><itemref idref="nav"/></spine>
</package>`;
}

/** A recognizable PNG-ish cover payload (bytes don't need to be a valid PNG). */
const COVER_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

async function buildEpub(
  opf: OpfOpts,
  opts: {
    compression?: 'STORE' | 'DEFLATE';
    comment?: string;
    padBytes?: number;
    withCover?: boolean;
  } = {},
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const compression = opts.compression ?? 'DEFLATE';
  // mimetype is conventionally stored uncompressed and first.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML, { compression });
  zip.file('OEBPS/content.opf', buildOpf(opf), { compression });
  const withCover = opts.withCover ?? opf.coverStyle !== 'none';
  if (withCover) {
    zip.file('OEBPS/images/cover.png', COVER_BYTES, { compression });
  }
  if (opts.padBytes) {
    // A big early entry pushes the central directory well past the file start,
    // so a large file is read via targeted ranges rather than fully buffered.
    zip.file('OEBPS/pad.bin', new Uint8Array(opts.padBytes), { compression: 'STORE' });
  }
  return zip.generateAsync({
    type: 'arraybuffer',
    comment: opts.comment,
  });
}

function bufferReader(buf: ArrayBuffer): RangeReader & { bytesRead: number } {
  return {
    size: buf.byteLength,
    bytesRead: 0,
    async readRange(start: number, end: number): Promise<ArrayBuffer> {
      this.bytesRead += end - start + 1;
      return buf.slice(start, end + 1);
    },
  };
}

describe('readRemoteEpubPreview', () => {
  it('extracts metadata + cover from an EPUB3 (cover-image property, deflated)', async () => {
    const buf = await buildEpub({
      title: 'Project Hail Mary',
      creator: 'Andy Weir',
      description: 'A lone astronaut.',
      language: 'en',
      identifiers: ['urn:isbn:9780593135204'],
      coverStyle: 'epub3',
    });
    const preview = await readRemoteEpubPreview(bufferReader(buf));
    expect(preview.title).toBe('Project Hail Mary');
    expect(preview.author).toBe('Andy Weir');
    expect(preview.description).toBe('A lone astronaut.');
    expect(preview.language).toBe('en');
    expect(preview.identifiers).toContain('urn:isbn:9780593135204');
    expect(preview.cover).toBeDefined();
    expect(new Uint8Array(preview.cover!.bytes)).toEqual(COVER_BYTES);
    expect(preview.cover!.mediaType).toBe('image/png');
  });

  it('resolves an EPUB2 cover via <meta name="cover">', async () => {
    const buf = await buildEpub({ title: 'Old Book', coverStyle: 'epub2' });
    const preview = await readRemoteEpubPreview(bufferReader(buf));
    expect(preview.title).toBe('Old Book');
    expect(preview.cover).toBeDefined();
    expect(new Uint8Array(preview.cover!.bytes)).toEqual(COVER_BYTES);
  });

  it('reads a fully STORED (uncompressed) archive', async () => {
    const buf = await buildEpub({ title: 'Stored', coverStyle: 'epub3' }, { compression: 'STORE' });
    const preview = await readRemoteEpubPreview(bufferReader(buf));
    expect(preview.title).toBe('Stored');
    expect(new Uint8Array(preview.cover!.bytes)).toEqual(COVER_BYTES);
  });

  it('tolerates a trailing ZIP comment (EOCD not at the very end)', async () => {
    const buf = await buildEpub(
      { title: 'Commented', coverStyle: 'epub3' },
      { comment: 'generated by a tool' },
    );
    const preview = await readRemoteEpubPreview(bufferReader(buf));
    expect(preview.title).toBe('Commented');
  });

  it('returns metadata with no cover when none is present', async () => {
    const buf = await buildEpub({ title: 'Text Only', coverStyle: 'none' }, { withCover: false });
    const preview = await readRemoteEpubPreview(bufferReader(buf));
    expect(preview.title).toBe('Text Only');
    expect(preview.cover).toBeUndefined();
  });

  it('reads a >64KB archive via targeted ranges, not a full buffer', async () => {
    const padBytes = 200 * 1024;
    const buf = await buildEpub(
      { title: 'Large', coverStyle: 'epub3' },
      { padBytes, compression: 'DEFLATE' },
    );
    const reader = bufferReader(buf);
    const preview = await readRemoteEpubPreview(reader);
    expect(preview.title).toBe('Large');
    expect(new Uint8Array(preview.cover!.bytes)).toEqual(COVER_BYTES);
    // We must NOT have pulled the whole (200KB+) file down.
    expect(reader.bytesRead).toBeLessThan(buf.byteLength);
    expect(reader.bytesRead).toBeLessThan(padBytes);
  });

  it('throws UnextractableEpubError on a malformed OPF (no rootfile path)', async () => {
    // Hand-build an archive whose container.xml has no full-path.
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const error = await readRemoteEpubPreview(bufferReader(buf)).catch((e) => e);
    expect(error).toBeInstanceOf(UnextractableEpubError);
    expect(error.reason).toBe('missing-opf');
  });

  it('bails on a ZIP64 sentinel EOCD', async () => {
    // Minimal 22-byte EOCD with entryCount = 0xffff (ZIP64 marker).
    const buf = new ArrayBuffer(22);
    const view = new DataView(buf);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(10, 0xffff, true); // total entries → ZIP64 sentinel
    const error = await readRemoteEpubPreview(bufferReader(buf)).catch((e) => e);
    expect(error).toBeInstanceOf(UnextractableEpubError);
    expect(error.reason).toBe('zip64-unsupported');
  });

  it('throws when no EOCD signature is present at all', async () => {
    const buf = new TextEncoder().encode('not a zip file at all').buffer;
    const error = await readRemoteEpubPreview(bufferReader(buf)).catch((e) => e);
    expect(error).toBeInstanceOf(UnextractableEpubError);
    expect(error.reason).toBe('eocd-not-found');
  });
});
