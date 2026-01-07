import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import * as Y from 'yjs';

export class LibraryModel extends BaseModel<Y.Map<Y.Map<any>>> {
  constructor(doc: Y.Doc) {
    super(doc.getMap('books'));
  }

  async getLibrary() {
    return dbService.getLibrary();
  }

  async getBook(id: string) {
    return dbService.getBook(id);
  }

  async getBookMetadata(id: string) {
    return dbService.getBookMetadata(id);
  }

  async updateBookMetadata(id: string, metadata: any) {
    return dbService.updateBookMetadata(id, metadata);
  }

  async addBook(file: File, ttsOptions?: any, onProgress?: (progress: number, message: string) => void) {
    return dbService.addBook(file, ttsOptions, onProgress);
  }

  async deleteBook(id: string) {
    return dbService.deleteBook(id);
  }

  async offloadBook(id: string) {
    return dbService.offloadBook(id);
  }

  async restoreBook(id: string, file: File) {
    return dbService.restoreBook(id, file);
  }
}
