import type { RemoteStorageProvider } from './RemoteStorageProvider';
import type { SyncManifest } from './types';

// Declare gapi global types for better type checking if possible,
// but for now we assume they exist in the window scope or we use `any`.
declare const gapi: any;
declare const google: any;

export class GoogleDriveProvider implements RemoteStorageProvider {
  private authorized = false;
  private token: string | null = null;
  private FOLDER_NAME = 'appDataFolder';
  private FILENAME = 'versicle_sync_manifest.json';
  private CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  private API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
  private SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

  constructor() {
     // Check if gapi/google is loaded?
     // Initialization typically happens in the app initialization lifecycle.
  }

  async getManifest(): Promise<{ data: SyncManifest; etag: string } | null> {
    if (!this.authorized) throw new Error('Not authorized');

    try {
        const response = await gapi.client.drive.files.list({
            spaces: this.FOLDER_NAME,
            q: `name = '${this.FILENAME}' and trashed = false`,
            fields: 'files(id, name)'
        });

        const files = response.result.files;
        if (files && files.length > 0) {
            const fileId = files[0].id;
            const fileContent = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });

            // Get ETag separately? Or assumes it's in header?
            // The get request above might return the content directly.
            // To get metadata (etag), we might need another call or different fields.
            // Let's assume we fetch metadata first or along with list?
            // `list` with fields='files(id, name, version)'?
            // Google Drive API v3 uses 'version' for revisions, but optimistic locking uses 'etag'?
            // Ah, the file resource has 'version' (int).
            // Let's get the file metadata explicitly.

            const metadata = await gapi.client.drive.files.get({
                fileId: fileId,
                fields: 'version' // or headRevisionId?
            });

            return {
                data: fileContent.result as SyncManifest,
                etag: String(metadata.result.version) // Using version as etag for now
            };
        }
        return null;
    } catch (error) {
        console.error('Google Drive API Error (getManifest):', error);
        throw error;
    }
  }

  async updateManifest(data: SyncManifest, etag: string): Promise<void> {
     if (!this.authorized) throw new Error('Not authorized');
     console.log('Update manifest with etag:', etag);

     try {
         // Search for existing file to update
        const listResponse = await gapi.client.drive.files.list({
            spaces: this.FOLDER_NAME,
            q: `name = '${this.FILENAME}' and trashed = false`,
            fields: 'files(id)'
        });

        const files = listResponse.result.files;
        const fileId = files && files.length > 0 ? files[0].id : null;

        const fileContent = JSON.stringify(data);
        const metadata = {
            name: this.FILENAME,
            mimeType: 'application/json',
            parents: [this.FOLDER_NAME]
        };

        if (fileId) {
            // Optimistic concurrency check
            if (etag) {
                const currentMetadata = await gapi.client.drive.files.get({
                    fileId: fileId,
                    fields: 'version'
                });

                if (String(currentMetadata.result.version) !== etag) {
                    throw new Error('412 Precondition Failed');
                }
            }

            // Update existing
            await gapi.client.drive.files.update({
                 fileId: fileId,
                 media: {
                     mimeType: 'application/json',
                     body: fileContent
                 }
            });
        } else {
            // Create new
            await gapi.client.drive.files.create({
                resource: metadata,
                media: {
                    mimeType: 'application/json',
                    body: fileContent
                },
                fields: 'id'
            });
        }
     } catch (error) {
         console.error('Google Drive API Error (updateManifest):', error);
         throw error;
     }
  }

  async deleteManifest(): Promise<void> {
     if (!this.authorized) throw new Error('Not authorized');
     // ... implementation
  }

  isAuthorized(): boolean {
    return this.authorized;
  }

  async authorize(): Promise<void> {
    if (this.authorized) return;

    return new Promise((resolve, reject) => {
        try {
            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.CLIENT_ID,
                scope: this.SCOPES,
                callback: (response: any) => {
                    if (response.error !== undefined) {
                        reject(response);
                    }
                    this.authorized = true;
                    this.token = response.access_token;

                    // Load GAPI client
                    gapi.load('client', async () => {
                        await gapi.client.init({
                            apiKey: this.API_KEY,
                            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                        });
                        resolve();
                    });
                },
            });

            // Trigger flow
            // If we have a stored token, we might try to use it?
            // For now, request access.
            tokenClient.requestAccessToken();
        } catch (e) {
            reject(e);
        }
    });
  }

  async signOut(): Promise<void> {
    if (this.token) {
        google.accounts.oauth2.revoke(this.token, () => {
            console.log('Access token revoked');
        });
    }
    this.authorized = false;
    this.token = null;
  }
}
