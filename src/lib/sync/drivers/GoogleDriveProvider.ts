import type { SyncManifest } from '../../../types/db';
import type { RemoteStorageProvider } from '../types';

/**
 * Google Drive implementation of RemoteStorageProvider.
 * Uses the GAPI client to access the App Data folder.
 */
export class GoogleDriveProvider implements RemoteStorageProvider {
  private clientId: string = '';
  private apiKey: string = '';
  private initialized: boolean = false;
  private tokenClient: unknown; // google.accounts.oauth2.TokenClient
  private accessToken: string | null = null;
  private manifestFileId: string | null = null;
  private MANIFEST_FILENAME = 'versicle_sync_manifest.json';

  async initialize(config: { clientId?: string; apiKey?: string }): Promise<void> {
    if (!config.clientId || !config.apiKey) {
      throw new Error("Missing Google Drive credentials");
    }
    this.clientId = config.clientId;
    this.apiKey = config.apiKey;

    await this.loadGapiScripts();
    await this.initGapiClient();
    this.initialized = true;
  }

  async isAuthenticated(): Promise<boolean> {
    return this.initialized && !!this.accessToken;
  }

  private loadGapiScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).gapi && (window as any).google?.accounts) {
            resolve();
            return;
        }

        // Load GAPI
        const script1 = document.createElement('script');
        script1.src = 'https://apis.google.com/js/api.js';
        script1.onload = () => {
             // Load GIS
            const script2 = document.createElement('script');
            script2.src = 'https://accounts.google.com/gsi/client';
            script2.onload = () => resolve();
            script2.onerror = reject;
            document.body.appendChild(script2);
        };
        script1.onerror = reject;
        document.body.appendChild(script1);
    });
  }

  private initGapiClient(): Promise<void> {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gapi = (window as any).gapi;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const google = (window as any).google;

        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: this.apiKey,
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                });

                this.tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: this.clientId,
                    scope: 'https://www.googleapis.com/auth/drive.appdata',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    callback: (resp: any) => {
                         if (resp.error) {
                             throw resp;
                         }
                         this.accessToken = resp.access_token;
                    },
                });

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
  }

  // Trigger login flow if needed
  async signIn(): Promise<void> {
      if (!this.tokenClient) throw new Error("GAPI not initialized");
      return new Promise((resolve) => {
           // We need to override the callback to capture the resolution
           // eslint-disable-next-line @typescript-eslint/no-explicit-any
           (this.tokenClient as any).callback = (resp: any) => {
                if (resp.error) {
                    console.error("Auth Error", resp);
                } else {
                    this.accessToken = resp.access_token;
                }
                resolve();
           };
           // eslint-disable-next-line @typescript-eslint/no-explicit-any
           (this.tokenClient as any).requestAccessToken({ prompt: 'consent' });
      });
  }

  async getManifest(): Promise<SyncManifest | null> {
    if (!this.isAuthenticated()) await this.signIn();

    // Find file
    const fileId = await this.findManifestFileId();
    if (!fileId) return null;

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gapi = (window as any).gapi;
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return response.result as SyncManifest;
    } catch (e) {
        console.error("Failed to download manifest", e);
        return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadManifest(manifest: SyncManifest, _previousVersion?: number): Promise<void> {
    if (!this.isAuthenticated()) await this.signIn();

    const fileId = this.manifestFileId || await this.findManifestFileId();

    const fileContent = JSON.stringify(manifest);
    const metadata = {
        name: this.MANIFEST_FILENAME,
        mimeType: 'application/json',
        parents: ['appDataFolder']
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileContent], { type: 'application/json' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gapi = (window as any).gapi;
    const accessToken = gapi.client.getToken()?.access_token || this.accessToken;

    if (fileId) {
        // Update existing
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
            body: form
        });
    } else {
        // Create new
        await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
            body: form
        });
    }

    // Refresh ID cache
    await this.findManifestFileId();
  }

  async getLastModified(): Promise<number | null> {
    if (!this.isAuthenticated()) return null;

    // We need to query the file's metadata
    const fileId = await this.findManifestFileId();
    if (!fileId) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gapi = (window as any).gapi;
    const response = await gapi.client.drive.files.get({
        fileId: fileId,
        fields: 'modifiedTime'
    });

    return response.result.modifiedTime ? new Date(response.result.modifiedTime).getTime() : null;
  }

  private async findManifestFileId(): Promise<string | null> {
      if (this.manifestFileId) return this.manifestFileId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gapi = (window as any).gapi;
      try {
          const response = await gapi.client.drive.files.list({
              spaces: 'appDataFolder',
              q: `name = '${this.MANIFEST_FILENAME}' and trashed = false`,
              fields: 'files(id)',
              pageSize: 1
          });
          const files = response.result.files;
          if (files && files.length > 0) {
              this.manifestFileId = files[0].id;
              return files[0].id;
          }
      } catch (e) {
          console.error("Error finding manifest file", e);
      }
      return null;
  }
}
