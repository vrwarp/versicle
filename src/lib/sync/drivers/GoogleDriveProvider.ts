/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RemoteStorageProvider } from '../types';

/**
 * Google Drive implementation of RemoteStorageProvider.
 * Uses the GAPI client to access the App Data folder.
 * 
 * V2: Uses Yjs binary snapshots for CRDT sync.
 */
export class GoogleDriveProvider implements RemoteStorageProvider {
    private clientId: string = '';
    private apiKey: string = '';
    private initialized: boolean = false;
    private tokenClient: any; // google.accounts.oauth2.TokenClient
    private accessToken: string | null = null;
    private snapshotFileId: string | null = null;
    private readonly SNAPSHOT_FILENAME = 'versicle_yjs_state.bin';

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
            if ((window as any).gapi && (window as any).google?.accounts) {
                resolve();
                return;
            }

            const script1 = document.createElement('script');
            script1.src = 'https://apis.google.com/js/api.js';
            script1.onload = () => {
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
            const gapi = (window as any).gapi;
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

    async signIn(): Promise<void> {
        if (!this.tokenClient) throw new Error("GAPI not initialized");
        return new Promise((resolve) => {
            this.tokenClient.callback = (resp: any) => {
                if (resp.error) {
                    console.error("Auth Error", resp);
                } else {
                    this.accessToken = resp.access_token;
                }
                resolve();
            };
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    }

    async uploadSnapshot(snapshot: Uint8Array): Promise<void> {
        if (!await this.isAuthenticated()) await this.signIn();

        const fileId = this.snapshotFileId || await this.findSnapshotFileId();

        const metadata = {
            name: this.SNAPSHOT_FILENAME,
            mimeType: 'application/octet-stream',
            parents: ['appDataFolder']
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([new Uint8Array(snapshot).buffer as ArrayBuffer], { type: 'application/octet-stream' }));

        const gapi = (window as any).gapi;
        const accessToken = gapi.client.getToken()?.access_token || this.accessToken;

        if (fileId) {
            await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
                method: 'PATCH',
                headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                body: form
            });
        } else {
            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                body: form
            });
            const result = await response.json();
            this.snapshotFileId = result.id;
        }

        console.log(`[GoogleDrive] Uploaded Yjs snapshot (${snapshot.byteLength} bytes)`);
    }

    async downloadSnapshot(): Promise<Uint8Array | null> {
        if (!await this.isAuthenticated()) await this.signIn();

        const fileId = await this.findSnapshotFileId();
        if (!fileId) {
            console.log('[GoogleDrive] No Yjs snapshot found');
            return null;
        }

        try {
            const gapi = (window as any).gapi;
            const accessToken = gapi.client.getToken()?.access_token || this.accessToken;

            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                method: 'GET',
                headers: new Headers({ 'Authorization': 'Bearer ' + accessToken })
            });

            if (!response.ok) {
                throw new Error(`Failed to download: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log(`[GoogleDrive] Downloaded Yjs snapshot (${arrayBuffer.byteLength} bytes)`);
            return new Uint8Array(arrayBuffer);
        } catch (e) {
            console.error("[GoogleDrive] Failed to download snapshot", e);
            return null;
        }
    }

    async getLastModified(): Promise<number | null> {
        if (!await this.isAuthenticated()) return null;

        const fileId = await this.findSnapshotFileId();
        if (!fileId) return null;

        const gapi = (window as any).gapi;
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            fields: 'modifiedTime'
        });

        return response.result.modifiedTime ? new Date(response.result.modifiedTime).getTime() : null;
    }

    private async findSnapshotFileId(): Promise<string | null> {
        if (this.snapshotFileId) return this.snapshotFileId;

        const gapi = (window as any).gapi;
        try {
            const response = await gapi.client.drive.files.list({
                spaces: 'appDataFolder',
                q: `name = '${this.SNAPSHOT_FILENAME}' and trashed = false`,
                fields: 'files(id)',
                pageSize: 1
            });
            const files = response.result.files;
            if (files && files.length > 0) {
                this.snapshotFileId = files[0].id;
                return files[0].id;
            }
        } catch (e) {
            console.error(`Error finding snapshot file`, e);
        }
        return null;
    }
}
