import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { ReadingEventType, ReadingHistoryEntry } from '../types/db';
import * as Y from 'yjs';

export class HistoryModel extends BaseModel<Y.Map<Y.Array<string>>> {
  constructor(doc: Y.Doc) {
    // Plan: Y.Map<BookId, Y.Array<string>>
    super(doc.getMap('reading_history'));
  }

  async getReadingHistory(bookId: string) {
    return dbService.getReadingHistory(bookId);
  }

  async getReadingHistoryEntry(bookId: string): Promise<ReadingHistoryEntry | undefined> {
    return dbService.getReadingHistoryEntry(bookId);
  }

  async updateReadingHistory(bookId: string, newRange: string, type: ReadingEventType, label?: string, skipSession: boolean = false) {
    return dbService.updateReadingHistory(bookId, newRange, type, label, skipSession);
  }
}
