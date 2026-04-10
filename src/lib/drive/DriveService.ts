import { googleIntegrationManager } from '../google/GoogleIntegrationManager';

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    size?: string;
    md5Checksum?: string;
    modifiedTime?: string;
    viewedByMeTime?: string;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export const DriveService = {
    /**
     * Authenticated fetch wrapper with 401 retry logic.
     */
    async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
        let token = await googleIntegrationManager.getValidToken('drive');

        const makeRequest = async (authToken: string) => {
            return fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${authToken}`
                }
            });
        };

        let response = await makeRequest(token);

        // Handle 401 Unauthorized: Refresh token and retry once
        if (response.status === 401) {
            console.warn("Drive API 401: Refreshing token and retrying...");
            token = await googleIntegrationManager.getValidToken('drive', true);
            response = await makeRequest(token);
        }

        return response;
    },

    /**
     * List folders within a parent folder.
     */
    async listFolders(parentId = 'root'): Promise<DriveFile[]> {
        const query = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const params = new URLSearchParams({
            q: query,
            fields: 'files(id, name, mimeType, parents)',
            orderBy: 'folder,name_natural',
            pageSize: '1000' // Should be enough for most folders
        });

        const response = await this.fetchWithAuth(`${DRIVE_API_BASE}/files?${params.toString()}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(error.error?.message || `Failed to list folders: ${response.status}`);
        }

        const data = await response.json();
        return data.files || [];
    },

    /**
     * Get metadata for a specific folder/file.
     */
    async getFolderMetadata(folderId: string): Promise<DriveFile> {
        const params = new URLSearchParams({
            fields: 'id, name, mimeType, parents, viewedByMeTime'
        });

        const response = await this.fetchWithAuth(`${DRIVE_API_BASE}/files/${folderId}?${params.toString()}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(error.error?.message || `Failed to get folder metadata: ${response.status}`);
        }

        return await response.json();
    },

    /**
     * List files within a folder, optionally filtering by mimeType.
     * Non-recursive (flat listing of the folder).
     */
    async listFiles(parentId: string, mimeType?: string): Promise<DriveFile[]> {
        let query = `'${parentId}' in parents and trashed = false`;
        if (mimeType) {
            query += ` and mimeType = '${mimeType}'`;
        } else {
            // If no mimeType, we might want to exclude folders if strictly listing "files", 
            // but usually listFiles implies everything. 
            // For consistency with specific "scan" usage, we'll leave it broad unless scoped.
            query += ` and mimeType != 'application/vnd.google-apps.folder'`;
        }

        const params = new URLSearchParams({
            q: query,
            fields: 'files(id, name, mimeType, parents, size, md5Checksum, modifiedTime, viewedByMeTime)',
            orderBy: 'viewedByMeTime desc',
            pageSize: '1000'
        });

        const response = await this.fetchWithAuth(`${DRIVE_API_BASE}/files?${params.toString()}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(error.error?.message || `Failed to list files: ${response.status}`);
        }

        const data = await response.json();
        return data.files || [];
    },

    /**
     * Recursively list all files starting from a parent folder.
     */
    async listFilesRecursive(parentId: string, mimeType?: string, visited = new Set<string>()): Promise<DriveFile[]> {
        if (visited.has(parentId)) {
            console.warn(`Cycle detected in Drive folder structure: ${parentId}`);
            return [];
        }
        visited.add(parentId);

        const files = await this.listFiles(parentId, mimeType);
        const folders = await this.listFolders(parentId);

        const subFiles: DriveFile[] = [];
        for (const folder of folders) {
            const children = await this.listFilesRecursive(folder.id, mimeType, visited);
            subFiles.push(...children);
        }

        return [...files, ...subFiles];
    },

    /**
     * Download a file by ID.
     * Returns a Blob.
     */
    async downloadFile(fileId: string): Promise<Blob> {
        const response = await this.fetchWithAuth(`${DRIVE_API_BASE}/files/${fileId}?alt=media`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(error.error?.message || `Failed to download file: ${response.status}`);
        }

        return await response.blob();
    }
};
