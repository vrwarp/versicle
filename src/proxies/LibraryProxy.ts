import { dbService } from '../db/DBService';
import { BookModel } from '../models/BookModel';

export class LibraryProxy {
  async getLibrary() {
    const books = await dbService.getLibrary();
    return books.map(b => new BookModel(b));
  }

  async getBook(id: string) {
    const result = await dbService.getBook(id);
    if (!result) return undefined;
    return {
      metadata: result.metadata ? new BookModel(result.metadata) : undefined,
      file: result.file
    };
  }

  async getBookMetadata(id: string) {
    const meta = await dbService.getBookMetadata(id);
    return meta ? new BookModel(meta) : undefined;
  }

  async updateBookMetadata(id: string, metadata: any) {
    // metadata might be a partial. BookModel constructor expects full or Y.Map.
    // But we are passing to DBService which accepts Partial.
    // If we want to return a Model, we need the full object.
    // But update usually returns void.
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
