
import type { DriveFile } from './DriveService';

export class MockDriveService {
    private files: Map<string, DriveFile> = new Map();
    private fileContents: Map<string, Blob> = new Map();

    constructor() {
        this.reset();
    }

    reset() {
        this.files.clear();
        this.fileContents.clear();

        // Add root folder
        this.files.set('root', {
            id: 'root',
            name: 'Root',
            mimeType: 'application/vnd.google-apps.folder',
            parents: []
        });
    }

    // Helper to seed data
    addFolder(id: string, name: string, parentId: string = 'root') {
        const folder: DriveFile = {
            id,
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        };
        this.files.set(id, folder);
        return folder;
    }

    addFile(id: string, name: string, mimeType: string, parentId: string, content: Blob | string, size?: number, modifiedTime?: string) {
        const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;

        const file: DriveFile = {
            id,
            name,
            mimeType,
            parents: [parentId],
            size: size ? size.toString() : blob.size.toString(),
            modifiedTime: modifiedTime || new Date().toISOString()
        };

        this.files.set(id, file);
        this.fileContents.set(id, blob);
        return file;
    }

    // Mocked methods matching DriveService
    async listFolders(parentId = 'root'): Promise<DriveFile[]> {
        return Array.from(this.files.values()).filter(f =>
            f.parents?.includes(parentId) &&
            f.mimeType === 'application/vnd.google-apps.folder' &&
            f.id !== 'root' // listFolders usually doesn't return root itself if querying children of root
        );
    }

    async getFolderMetadata(folderId: string): Promise<DriveFile> {
        const folder = this.files.get(folderId);
        if (!folder) throw new Error(`Folder not found: ${folderId}`);
        return folder;
    }

    async listFiles(parentId: string, mimeType?: string): Promise<DriveFile[]> {
        return Array.from(this.files.values()).filter(f => {
            const isChild = f.parents?.includes(parentId);
            const isCorrectType = mimeType ? f.mimeType === mimeType : f.mimeType !== 'application/vnd.google-apps.folder';
            return isChild && isCorrectType;
        });
    }

    async downloadFile(fileId: string): Promise<Blob> {
        const content = this.fileContents.get(fileId);
        if (!content) throw new Error(`File content not found: ${fileId}`);
        return content;
    }

    // Helper to verify state
    getFile(id: string) {
        return this.files.get(id);
    }
}

export const mockDriveService = new MockDriveService();
