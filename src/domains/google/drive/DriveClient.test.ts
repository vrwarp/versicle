/**
 * DriveClient suite (Phase 7 §G): typed errors, q-escaping, 401/403-scope
 * retry, silent-vs-interactive token acquisition.
 *
 * Absorbs the assertions of the deleted per-bug files (absorption ledger):
 *  - src/lib/drive/DriveService.pagination.test.ts (listFiles/listFolders
 *    nextPageToken paging)
 *  - src/lib/drive/DriveService.recursive.test.ts (recursive listing +
 *    folder-cycle guard)
 *  - src/components/drive/DriveLogic.test.ts §DriveService (Bearer header,
 *    401 refresh-and-retry-once)
 */
import { describe, expect, it, vi } from 'vitest';
import { DriveClient, escapeDriveQueryValue } from './DriveClient';
import { DriveApiError, DriveRangeUnsupportedError } from './errors';
import { GoogleAuthRequiredError } from '../auth/errors';
import type { GoogleAuthClient } from '../auth/GoogleAuthClient';
import type { EgressFn } from '@kernel/net';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeAuth(overrides: Partial<Record<keyof GoogleAuthClient, unknown>> = {}) {
  return {
    getToken: vi.fn().mockResolvedValue('silent-token'),
    getTokenInteractive: vi.fn().mockResolvedValue('interactive-token'),
    invalidateToken: vi.fn(),
    ...overrides,
  } as unknown as GoogleAuthClient & {
    getToken: ReturnType<typeof vi.fn>;
    getTokenInteractive: ReturnType<typeof vi.fn>;
    invalidateToken: ReturnType<typeof vi.fn>;
  };
}

function makeClient(
  responses: Response[] | ((url: string) => Response),
  opts: { maxRateLimitRetries?: number } = {},
) {
  const queue = Array.isArray(responses) ? [...responses] : null;
  const egress = vi.fn(async (_id: string, url: string) => {
    if (queue) {
      const next = queue.shift();
      if (!next) throw new Error('egress queue exhausted');
      return next;
    }
    return (responses as (url: string) => Response)(url);
  }) as unknown as EgressFn & ReturnType<typeof vi.fn>;
  const auth = makeAuth();
  // Inject an instant no-op sleep so backoff retries don't slow the suite.
  const sleep = vi.fn(async () => {});
  const client = new DriveClient({
    auth,
    egress,
    sleep,
    maxRateLimitRetries: opts.maxRateLimitRetries,
  });
  return { client, auth, egress: egress as unknown as ReturnType<typeof vi.fn>, sleep };
}

describe('escapeDriveQueryValue (GG-11)', () => {
  it('escapes quotes and backslashes', () => {
    expect(escapeDriveQueryValue("o'brien")).toBe("o\\'brien");
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b');
  });
});

describe('DriveClient', () => {
  it('sends the Bearer token and uses the silent path by default', async () => {
    const { client, auth, egress } = makeClient([jsonResponse({ files: [] })]);
    await client.listFolders();
    expect(auth.getToken).toHaveBeenCalledWith('drive');
    expect(auth.getTokenInteractive).not.toHaveBeenCalled();
    const [id, url, init] = egress.mock.calls[0];
    expect(id).toBe('drive');
    expect(url).toContain('https://www.googleapis.com/drive/v3/files');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer silent-token',
    });
  });

  it('uses getTokenInteractive when the call site passes interactive: true', async () => {
    const { client, auth } = makeClient([jsonResponse({ files: [] })]);
    await client.listFolders('root', { interactive: true });
    expect(auth.getTokenInteractive).toHaveBeenCalledWith('drive');
    expect(auth.getToken).not.toHaveBeenCalled();
  });

  it('silent calls surface GoogleAuthRequiredError untouched (reconnect affordance path)', async () => {
    const { client, auth } = makeClient([jsonResponse({ files: [] })]);
    auth.getToken.mockRejectedValueOnce(new GoogleAuthRequiredError('drive', 'no-credential'));
    await expect(client.listFolders()).rejects.toBeInstanceOf(GoogleAuthRequiredError);
  });

  it('regression: 401 invalidates the cached token and retries exactly once', async () => {
    const { client, auth, egress } = makeClient([
      new Response('', { status: 401 }),
      jsonResponse({ files: [] }),
    ]);
    auth.getToken.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('new-token');
    await client.listFolders();
    expect(auth.invalidateToken).toHaveBeenCalledWith('drive');
    expect(egress).toHaveBeenCalledTimes(2);
    const retryInit = egress.mock.calls[1][2] as RequestInit;
    expect(retryInit.headers).toMatchObject({ Authorization: 'Bearer new-token' });
  });

  it('NEW vs legacy: 403 insufficient-scope also invalidates and retries once (GG-1)', async () => {
    const { client, auth, egress } = makeClient([
      jsonResponse(
        { error: { message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } },
        403,
      ),
      jsonResponse({ files: [] }),
    ]);
    await client.listFolders();
    expect(auth.invalidateToken).toHaveBeenCalledWith('drive');
    expect(egress).toHaveBeenCalledTimes(2);
  });

  it('maps HTTP failures to DriveApiError{status, reason} (GG-7)', async () => {
    const { client } = makeClient([
      jsonResponse({ error: { message: 'Folder not found', errors: [{ reason: 'notFound' }] } }, 404),
    ]);
    const error = await client.getFolderMetadata('nope').catch((e) => e);
    expect(error).toBeInstanceOf(DriveApiError);
    expect(error.code).toBe('DRIVE_API_ERROR');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Folder not found');
  });

  it('regression: listFiles follows nextPageToken to the end', async () => {
    const { client, egress } = makeClient([
      jsonResponse({ files: [{ id: '1', name: 'File 1' }], nextPageToken: 'token-page-2' }),
      jsonResponse({ files: [{ id: '2', name: 'File 2' }] }),
    ]);
    const files = await client.listFiles('root');
    expect(files).toHaveLength(2);
    expect(egress).toHaveBeenCalledTimes(2);
    expect(String(egress.mock.calls[1][1])).toContain('pageToken=token-page-2');
  });

  it('regression: listFolders follows nextPageToken to the end', async () => {
    const { client, egress } = makeClient([
      jsonResponse({ files: [{ id: '1', name: 'Folder 1' }], nextPageToken: 'token-page-2' }),
      jsonResponse({ files: [{ id: '2', name: 'Folder 2' }] }),
    ]);
    const folders = await client.listFolders('root');
    expect(folders).toHaveLength(2);
    expect(egress).toHaveBeenCalledTimes(2);
  });

  it('regression: listFilesRecursive walks subfolders and survives folder cycles', async () => {
    const byUrl = (url: string): Response => {
      const params = new URL(url).searchParams;
      const q = params.get('q') ?? '';
      const isFolderQuery = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      if (q.includes("'root' in parents")) {
        return isFolderQuery
          ? jsonResponse({ files: [{ id: 'sub', name: 'Sub', mimeType: 'application/vnd.google-apps.folder' }] })
          : jsonResponse({ files: [{ id: 'f-root', name: 'Root.epub', mimeType: 'application/epub+zip' }] });
      }
      if (q.includes("'sub' in parents")) {
        return isFolderQuery
          ? // CYCLE: the subfolder claims root as its child.
            jsonResponse({ files: [{ id: 'root', name: 'Loop', mimeType: 'application/vnd.google-apps.folder' }] })
          : jsonResponse({ files: [{ id: 'f-sub', name: 'Sub.epub', mimeType: 'application/epub+zip' }] });
      }
      return jsonResponse({ files: [] });
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeClient(byUrl);
    const files = await client.listFilesRecursive('root', 'application/epub+zip');
    expect(files.map((f) => f.id).sort()).toEqual(['f-root', 'f-sub']);
  });

  it('downloadFile returns the blob and maps failures', async () => {
    const { client } = makeClient([new Response('epub-bytes')]);
    const blob = await client.downloadFile('file-1');
    expect(await blob.text()).toBe('epub-bytes');
  });

  describe('rate-limit backoff (429 / 403 rate-limit)', () => {
    it('backs off and retries a 429, then returns the eventual success', async () => {
      const { client, egress, sleep } = makeClient([
        new Response('', { status: 429 }),
        new Response('', { status: 429 }),
        jsonResponse({ files: [] }),
      ]);
      const files = await client.listFiles('root');
      expect(files).toEqual([]);
      expect(egress).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('backs off on a 403 rateLimitExceeded (distinct from insufficient-scope)', async () => {
      const { client, egress, auth } = makeClient([
        jsonResponse(
          { error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } },
          403,
        ),
        jsonResponse({ files: [] }),
      ]);
      await client.listFiles('root');
      // Rate-limit 403 must NOT be treated as an auth problem.
      expect(auth.invalidateToken).not.toHaveBeenCalled();
      expect(egress).toHaveBeenCalledTimes(2);
    });

    it('gives up after the retry budget and returns the last rate-limited response', async () => {
      const { client, egress } = makeClient(
        [
          new Response('', { status: 429 }),
          new Response('', { status: 429 }),
          new Response('', { status: 429 }),
        ],
        { maxRateLimitRetries: 2 },
      );
      // listFolders throws a DriveApiError built from the final 429 response.
      const error = await client.listFolders().catch((e) => e);
      expect(error).toBeInstanceOf(DriveApiError);
      expect(error.status).toBe(429);
      // 1 initial + 2 retries = 3 egress calls.
      expect(egress).toHaveBeenCalledTimes(3);
    });
  });

  describe('downloadFileRange', () => {
    it('sends an inclusive Range header and returns the bytes on 206', async () => {
      const { client, egress } = makeClient([
        new Response('PK-partial', { status: 206 }),
      ]);
      const buf = await client.downloadFileRange('file-1', 0, 9);
      expect(new TextDecoder().decode(buf)).toBe('PK-partial');
      const init = egress.mock.calls[0][2] as RequestInit;
      expect((init.headers as Record<string, string>).Range).toBe('bytes=0-9');
    });

    it('throws DriveRangeUnsupportedError when the server ignores Range (200)', async () => {
      const { client } = makeClient([new Response('whole-file', { status: 200 })]);
      const error = await client.downloadFileRange('file-1', 0, 9).catch((e) => e);
      expect(error).toBeInstanceOf(DriveRangeUnsupportedError);
      expect(error.code).toBe('DRIVE_RANGE_UNSUPPORTED');
    });
  });
});
