/**
 * DriveMetadataService: read-through caching keyed on {fileId, md5}, in-flight
 * dedupe, the negative cache, and the typed failure policy (auth / offline /
 * 404-gone / unsupported). The client is faked over an in-memory EPUB buffer
 * built with jszip; the cache and index are plain maps.
 */
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  DriveMetadataService,
  type CachedDrivePreview,
  type DriveIndexEntry,
  type DrivePreviewCacheInput,
} from './DriveMetadataService';
import { DriveApiError, DriveRangeUnsupportedError } from './errors';
import { GoogleAuthRequiredError } from '../auth/errors';
import { AppError } from '~types/errors';

const COVER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

async function buildEpubBuffer(title: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Some Author</dc:creator><dc:language>en</dc:language><dc:identifier>urn:isbn:111</dc:identifier></metadata><manifest><item id="c" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine/></package>`,
  );
  zip.file('OEBPS/cover.png', COVER);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function makeCache() {
  const store = new Map<string, CachedDrivePreview>();
  return {
    store,
    get: vi.fn(async (fileId: string) => store.get(fileId)),
    put: vi.fn(async (input: DrivePreviewCacheInput) => {
      store.set(input.fileId, { ...input });
    }),
    delete: vi.fn(async (fileId: string) => {
      store.delete(fileId);
    }),
    listFileIds: vi.fn(async () => Array.from(store.keys())),
    runEviction: vi.fn(async () => {}),
  };
}

function makeIndex(entries: DriveIndexEntry[]) {
  const map = new Map(entries.map((e) => [e.id, e]));
  return {
    map,
    getEntry: vi.fn((fileId: string) => map.get(fileId)),
    getIndex: vi.fn(() => Array.from(map.values())),
    onFileGone: vi.fn((fileId: string) => map.delete(fileId)),
  };
}

describe('DriveMetadataService', () => {
  it('fetches, sanitizes, returns a preview, and caches it', async () => {
    const buf = await buildEpubBuffer('Hello World');
    const downloadFileRange = vi.fn(async (_id: string, start: number, end: number) =>
      buf.slice(start, end + 1),
    );
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: buf.byteLength, md5Checksum: 'abc' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const outcome = await svc.getPreview('f1', { priority: 'interactive' });
    expect(outcome.status).toBe('ok');
    expect(outcome.preview?.title).toBe('Hello World');
    expect(outcome.preview?.author).toBe('Some Author');
    expect(outcome.preview?.cover).toBeInstanceOf(Blob);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.store.get('f1')?.status).toBe('ok');
  });

  it('serves a fresh cache hit without any network call', async () => {
    const buf = await buildEpubBuffer('Cached Book');
    const downloadFileRange = vi.fn(async (_id: string, start: number, end: number) =>
      buf.slice(start, end + 1),
    );
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: buf.byteLength, md5Checksum: 'md5-1' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    await svc.getPreview('f1');
    downloadFileRange.mockClear();
    const second = await svc.getPreview('f1');
    expect(second.status).toBe('ok');
    expect(downloadFileRange).not.toHaveBeenCalled();
  });

  it('re-fetches when the index md5 no longer matches the cached row', async () => {
    const buf = await buildEpubBuffer('V1');
    const downloadFileRange = vi.fn(async (_id: string, start: number, end: number) =>
      buf.slice(start, end + 1),
    );
    const cache = makeCache();
    cache.store.set('f1', { fileId: 'f1', md5Checksum: 'old-md5', status: 'ok', title: 'Stale' });
    const index = makeIndex([{ id: 'f1', size: buf.byteLength, md5Checksum: 'new-md5' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const outcome = await svc.getPreview('f1');
    expect(outcome.preview?.title).toBe('V1');
    expect(downloadFileRange).toHaveBeenCalled();
    expect(cache.store.get('f1')?.md5Checksum).toBe('new-md5');
  });

  it('negative-caches an unextractable file and does not re-fetch it', async () => {
    const notAZip = new TextEncoder().encode('garbage not a zip file').buffer;
    const downloadFileRange = vi.fn(async (_id: string, start: number, end: number) =>
      notAZip.slice(start, end + 1),
    );
    const cache = makeCache();
    const index = makeIndex([{ id: 'bad', size: notAZip.byteLength, md5Checksum: 'x' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const first = await svc.getPreview('bad');
    expect(first.status).toBe('unextractable');
    expect(cache.store.get('bad')?.status).toBe('unextractable');

    downloadFileRange.mockClear();
    const second = await svc.getPreview('bad');
    expect(second.status).toBe('unextractable');
    expect(downloadFileRange).not.toHaveBeenCalled();
  });

  it('reports auth without caching when a token is unavailable', async () => {
    const downloadFileRange = vi.fn(async () => {
      throw new GoogleAuthRequiredError('drive', 'no-credential');
    });
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: 5000, md5Checksum: 'x' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const outcome = await svc.getPreview('f1');
    expect(outcome.status).toBe('auth');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('reports offline on NET_OFFLINE', async () => {
    const downloadFileRange = vi.fn(async () => {
      throw new AppError('offline', { code: 'NET_OFFLINE' });
    });
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: 5000 }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });
    expect((await svc.getPreview('f1')).status).toBe('offline');
  });

  it('reports unsupported when Drive ignores the Range header', async () => {
    const downloadFileRange = vi.fn(async () => {
      throw new DriveRangeUnsupportedError('f1');
    });
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: 5000 }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });
    const outcome = await svc.getPreview('f1');
    expect(outcome.status).toBe('unsupported');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('evicts and notifies the index on a 404', async () => {
    const downloadFileRange = vi.fn(async () => {
      throw new DriveApiError('gone', 404, 'notFound');
    });
    const cache = makeCache();
    cache.store.set('f1', { fileId: 'f1', md5Checksum: 'stale', status: 'ok' });
    const index = makeIndex([{ id: 'f1', size: 5000, md5Checksum: 'live' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const outcome = await svc.getPreview('f1');
    expect(outcome.status).toBe('gone');
    expect(cache.delete).toHaveBeenCalledWith('f1');
    expect(index.onFileGone).toHaveBeenCalledWith('f1');
  });

  it('returns gone for a file not present in the index', async () => {
    const downloadFileRange = vi.fn();
    const cache = makeCache();
    const index = makeIndex([]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });
    expect((await svc.getPreview('missing')).status).toBe('gone');
    expect(downloadFileRange).not.toHaveBeenCalled();
  });

  it('dedupes concurrent requests for the same file into one fetch', async () => {
    const buf = await buildEpubBuffer('Once');
    let calls = 0;
    const downloadFileRange = vi.fn(async (_id: string, start: number, end: number) => {
      calls += 1;
      return buf.slice(start, end + 1);
    });
    const cache = makeCache();
    const index = makeIndex([{ id: 'f1', size: buf.byteLength, md5Checksum: 'x' }]);
    const svc = new DriveMetadataService({ client: { downloadFileRange }, cache, index });

    const [a, b] = await Promise.all([svc.getPreview('f1'), svc.getPreview('f1')]);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    // Both resolved from a single underlying fetch (dedupe), so the tail read
    // happened once, not twice.
    expect(cache.put).toHaveBeenCalledTimes(1);
    void calls;
  });

  it('getCached hides a row whose md5 no longer matches the index', async () => {
    const cache = makeCache();
    cache.store.set('f1', { fileId: 'f1', md5Checksum: 'old', status: 'ok', title: 'Old' });
    const index = makeIndex([{ id: 'f1', size: 100, md5Checksum: 'new' }]);
    const svc = new DriveMetadataService({
      client: { downloadFileRange: vi.fn() },
      cache,
      index,
    });
    expect(await svc.getCached('f1')).toBeUndefined();
  });
});
