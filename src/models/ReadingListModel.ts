import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { ReadingListEntry } from '../types/db';

export class ReadingListModel extends BaseModel {
  async getReadingList() {
    return dbService.getReadingList();
  }

  async upsertReadingListEntry(entry: ReadingListEntry) {
    return dbService.upsertReadingListEntry(entry);
  }

  async deleteReadingListEntry(filename: string) {
    return dbService.deleteReadingListEntry(filename);
  }

  async deleteReadingListEntries(filenames: string[]) {
    return dbService.deleteReadingListEntries(filenames);
  }

  async importReadingList(entries: ReadingListEntry[]) {
    return dbService.importReadingList(entries);
  }
}

export const readingListModel = new ReadingListModel();
