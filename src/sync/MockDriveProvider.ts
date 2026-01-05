import type { RemoteStorageProvider } from './RemoteStorageProvider';
import type { SyncManifest } from './types';

export class MockDriveProvider implements RemoteStorageProvider {
  private manifest: SyncManifest | null = null;
  private etag = '0';
  private authorized = true;
  private shouldFailNextRequest = false;
  private shouldConflictNextRequest = false;

  constructor(initialManifest?: SyncManifest) {
    if (initialManifest) {
      this.manifest = initialManifest;
      this.etag = Date.now().toString();
    }
  }

  setShouldFailNextRequest(fail: boolean) {
    this.shouldFailNextRequest = fail;
  }

  setShouldConflictNextRequest(conflict: boolean) {
    this.shouldConflictNextRequest = conflict;
  }

  setAuthorization(auth: boolean) {
    this.authorized = auth;
  }

  async getManifest(): Promise<{ data: SyncManifest; etag: string } | null> {
    if (this.shouldFailNextRequest) {
      this.shouldFailNextRequest = false;
      throw new Error('503 Service Unavailable');
    }

    if (!this.manifest) {
      return null;
    }

    return { data: JSON.parse(JSON.stringify(this.manifest)), etag: this.etag };
  }

  async updateManifest(data: SyncManifest, etag: string): Promise<void> {
    if (this.shouldFailNextRequest) {
      this.shouldFailNextRequest = false;
      throw new Error('503 Service Unavailable');
    }

    if (this.shouldConflictNextRequest) {
        this.shouldConflictNextRequest = false;
        throw new Error('412 Precondition Failed');
    }

    if (this.manifest && etag !== this.etag) {
      throw new Error('412 Precondition Failed');
    }

    this.manifest = JSON.parse(JSON.stringify(data));
    this.etag = Date.now().toString();
  }

  async deleteManifest(): Promise<void> {
    if (this.shouldFailNextRequest) {
      this.shouldFailNextRequest = false;
      throw new Error('503 Service Unavailable');
    }
    this.manifest = null;
    this.etag = '0';
  }

  isAuthorized(): boolean {
    return this.authorized;
  }

  async authorize(): Promise<void> {
    this.authorized = true;
  }

  async signOut(): Promise<void> {
    this.authorized = false;
  }
}
