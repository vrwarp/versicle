import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { ReadingEventType, ReadingHistoryEntry } from '../types/db';

export class HistoryModel extends BaseModel {
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

export const historyModel = new HistoryModel();
