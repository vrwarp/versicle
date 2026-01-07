import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { TTSState } from '../types/db';

export class SessionModel extends BaseModel {
  async saveTTSState(bookId: string, queue: TTSQueueItem[], currentIndex: number, sectionIndex?: number) {
    return dbService.saveTTSState(bookId, queue, currentIndex, sectionIndex);
  }

  async saveTTSPosition(bookId: string, currentIndex: number, sectionIndex?: number) {
    return dbService.saveTTSPosition(bookId, currentIndex, sectionIndex);
  }

  async getTTSState(bookId: string): Promise<TTSState | undefined> {
    return dbService.getTTSState(bookId);
  }

  async updatePlaybackState(bookId: string, lastPlayedCfi?: string, lastPauseTime?: number | null) {
      return dbService.updatePlaybackState(bookId, lastPlayedCfi, lastPauseTime);
  }

  async saveProgress(bookId: string, cfi: string, progress: number) {
      return dbService.saveProgress(bookId, cfi, progress);
  }

  async getLocations(bookId: string) {
      return dbService.getLocations(bookId);
  }

  async saveLocations(bookId: string, locations: string) {
      return dbService.saveLocations(bookId, locations);
  }
}

export const sessionModel = new SessionModel();
