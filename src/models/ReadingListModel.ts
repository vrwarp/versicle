import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { ReadingListEntry } from '../types/db';
import * as Y from 'yjs';

export class ReadingListModel extends BaseModel<Y.Map<ReadingListEntry>> {
  constructor(doc: Y.Doc) {
    super(doc.getMap('reading_list'));
  }

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
