import { dbService } from '../db/DBService';
import { ReadingListEntryModel } from '../models/ReadingListEntryModel';
import type { ReadingListEntry } from '../types/db';

export class ReadingListProxy {
  async getReadingList() {
    const list = await dbService.getReadingList();
    return list.map(entry => new ReadingListEntryModel(entry));
  }

  async upsertReadingListEntry(entry: ReadingListEntry | ReadingListEntryModel) {
    const data = entry instanceof ReadingListEntryModel ? entry.toJSON() : entry;
    return dbService.upsertReadingListEntry(data);
  }

  async deleteReadingListEntry(filename: string) {
    return dbService.deleteReadingListEntry(filename);
  }

  async deleteReadingListEntries(filenames: string[]) {
    return dbService.deleteReadingListEntries(filenames);
  }

  async importReadingList(entries: ReadingListEntry[]) {
    // Bulk import usually takes raw data
    return dbService.importReadingList(entries);
  }
}
