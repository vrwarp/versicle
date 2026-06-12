/**
 * DriveClient (Phase 7 §G) — the Drive v3 REST client at its final address.
 *
 * Replaces src/lib/drive/DriveService (which remains as a thin deprecated
 * façade until its consumers migrate). Changes vs the legacy client:
 *
 *  - All HTTP through `NetworkGateway.egress('drive', …)` (C9 boundary).
 *  - Typed errors: DriveApiError{status, reason} instead of message-prose
 *    (GG-7); auth failures surface as GoogleAuthRequiredError.
 *  - Token acquisition via GoogleAuthClient with an explicit
 *    interactive/silent split per call: background callers (scanner boot
 *    policy) stay silent; user-gesture callers may escalate to connect().
 *  - 401 → invalidate cached token, re-acquire, retry ONCE (legacy policy);
 *    NEW: 403-with-insufficient-scope retries the same way (GG-1's failure
 *    mode was an opaque non-retried 403).
 *  - NO force-disconnect on errors — the legacy manager cleared persisted
 *    connection state on ANY token failure (GG-2); this client never touches
 *    persisted state.
 *  - Drive query values are escaped (GG-11).
 */
import { egress, type EgressFn } from '@kernel/net';
import type { GoogleAuthClient } from '../auth/GoogleAuthClient';
import { DriveApiError, handleDriveError } from './errors';
import type { DriveFile } from './types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveRequestOptions {
  /**
   * True when an explicit user gesture drove this call: token acquisition
   * may open login UI (getTokenInteractive). Defaults to false — silent.
   */
  interactive?: boolean;
  signal?: AbortSignal;
}

/** Escape a value for embedding in a Drive `q` query string (GG-11). */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface DriveErrorBody {
  error?: { message?: string; errors?: { reason?: string }[] };
}

export class DriveClient {
  constructor(
    private readonly deps: {
      auth: GoogleAuthClient;
      /** Injected for tests; production passes the kernel gateway. */
      egress?: EgressFn;
    },
  ) {}

  private get egress(): EgressFn {
    return this.deps.egress ?? egress;
  }

  private acquireToken(opts: DriveRequestOptions): Promise<string> {
    return opts.interactive
      ? this.deps.auth.getTokenInteractive('drive')
      : this.deps.auth.getToken('drive');
  }

  /**
   * Authenticated fetch with the retry policy: 401 (and 403 insufficient
   * scope) invalidates the cached token, re-acquires, and retries once.
   */
  async fetchWithAuth(
    url: string,
    options: RequestInit = {},
    opts: DriveRequestOptions = {},
  ): Promise<Response> {
    let token = await this.acquireToken(opts);

    const makeRequest = (authToken: string) =>
      this.egress(
        'drive',
        url,
        {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${authToken}` },
        },
        { signal: opts.signal },
      );

    let response = await makeRequest(token);

    if (response.status === 401 || (response.status === 403 && (await this.isInsufficientScope(response)))) {
      // Token rejected server-side: drop the cache and re-acquire. Silent
      // callers get GoogleAuthRequiredError from getToken() here — the
      // typed reconnect signal (NEVER a popup, NEVER a forced disconnect).
      this.deps.auth.invalidateToken('drive');
      token = await this.acquireToken(opts);
      response = await makeRequest(token);
    }

    return response;
  }

  private async isInsufficientScope(response: Response): Promise<boolean> {
    try {
      const body = (await response.clone().json()) as DriveErrorBody;
      const reasons = body.error?.errors?.map((e) => e.reason) ?? [];
      return (
        reasons.includes('insufficientPermissions') ||
        (body.error?.message ?? '').toLowerCase().includes('insufficient')
      );
    } catch {
      return false;
    }
  }

  private async throwResponseError(response: Response, operation: string): Promise<never> {
    const body = (await response
      .json()
      .catch(() => ({ error: { message: response.statusText } }))) as DriveErrorBody;
    throw new DriveApiError(
      body.error?.message || `Failed to ${operation}: ${response.status}`,
      response.status,
      body.error?.errors?.[0]?.reason,
    );
  }

  /** List folders within a parent folder (paginated). */
  async listFolders(parentId = 'root', opts: DriveRequestOptions = {}): Promise<DriveFile[]> {
    try {
      const query = `'${escapeDriveQueryValue(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const params = new URLSearchParams({
        q: query,
        fields: 'nextPageToken, files(id, name, mimeType, parents)',
        orderBy: 'folder,name_natural',
        pageSize: '1000',
      });

      let allFolders: DriveFile[] = [];
      let pageToken: string | undefined = undefined;

      do {
        if (pageToken) params.set('pageToken', pageToken);
        else params.delete('pageToken');

        const response = await this.fetchWithAuth(
          `${DRIVE_API_BASE}/files?${params.toString()}`,
          {},
          opts,
        );
        if (!response.ok) await this.throwResponseError(response, 'list folders');

        const data = await response.json();
        allFolders = allFolders.concat(data.files || []);
        pageToken = data.nextPageToken;
      } while (pageToken);

      return allFolders;
    } catch (error) {
      handleDriveError(error, 'listFolders');
    }
  }

  /** Get metadata for a specific folder/file. */
  async getFolderMetadata(folderId: string, opts: DriveRequestOptions = {}): Promise<DriveFile> {
    try {
      const params = new URLSearchParams({
        fields: 'id, name, mimeType, parents, viewedByMeTime',
      });
      const response = await this.fetchWithAuth(
        `${DRIVE_API_BASE}/files/${folderId}?${params.toString()}`,
        {},
        opts,
      );
      if (!response.ok) await this.throwResponseError(response, 'get folder metadata');
      return await response.json();
    } catch (error) {
      handleDriveError(error, 'getFolderMetadata');
    }
  }

  /** List files within a folder (non-recursive; paginated). */
  async listFiles(
    parentId: string,
    mimeType?: string,
    opts: DriveRequestOptions = {},
  ): Promise<DriveFile[]> {
    try {
      let query = `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`;
      if (mimeType) {
        query += ` and mimeType = '${escapeDriveQueryValue(mimeType)}'`;
      } else {
        query += ` and mimeType != 'application/vnd.google-apps.folder'`;
      }

      const params = new URLSearchParams({
        q: query,
        fields:
          'nextPageToken, files(id, name, mimeType, parents, size, md5Checksum, modifiedTime, viewedByMeTime)',
        orderBy: 'viewedByMeTime desc',
        pageSize: '1000',
      });

      let allFiles: DriveFile[] = [];
      let pageToken: string | undefined = undefined;

      do {
        if (pageToken) params.set('pageToken', pageToken);
        else params.delete('pageToken');

        const response = await this.fetchWithAuth(
          `${DRIVE_API_BASE}/files?${params.toString()}`,
          {},
          opts,
        );
        if (!response.ok) await this.throwResponseError(response, 'list files');

        const data = await response.json();
        allFiles = allFiles.concat(data.files || []);
        pageToken = data.nextPageToken;
      } while (pageToken);

      return allFiles;
    } catch (error) {
      handleDriveError(error, 'listFiles');
    }
  }

  /** Recursively list all files starting from a parent folder (cycle-guarded). */
  async listFilesRecursive(
    parentId: string,
    mimeType?: string,
    opts: DriveRequestOptions = {},
    visited = new Set<string>(),
  ): Promise<DriveFile[]> {
    if (visited.has(parentId)) {
      console.warn(`Cycle detected in Drive folder structure: ${parentId}`);
      return [];
    }
    visited.add(parentId);

    const files = await this.listFiles(parentId, mimeType, opts);
    const folders = await this.listFolders(parentId, opts);

    const subFiles: DriveFile[] = [];
    for (const folder of folders) {
      const children = await this.listFilesRecursive(folder.id, mimeType, opts, visited);
      subFiles.push(...children);
    }

    return [...files, ...subFiles];
  }

  /** Download a file by id as a Blob. */
  async downloadFile(fileId: string, opts: DriveRequestOptions = {}): Promise<Blob> {
    try {
      const response = await this.fetchWithAuth(
        `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
        {},
        opts,
      );
      if (!response.ok) await this.throwResponseError(response, 'download file');
      return await response.blob();
    } catch (error) {
      handleDriveError(error, 'downloadFile');
    }
  }
}
