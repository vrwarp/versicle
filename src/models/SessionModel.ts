import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { TTSState } from '../types/db';
import * as Y from 'yjs';

export class SessionModel extends BaseModel<Y.Map<Y.Map<any>>> {
  constructor(doc: Y.Doc) {
    // Plan: Y.Map<BookId, Y.Map<string, any>>
    // Target Store: tts_queue, tts_position
    // We can group these under 'sessions' or 'playback_state' in Yjs.
    // The plan didn't specify the top-level key name explicitly, but 'SessionModel' suggests 'sessions'.
    // Or maybe 'tts_queue' and 'tts_position' separately?
    // "Key Data Structures: Complete playback queue... current queue index..."
    // "Yjs Type Mapping: Y.Map<BookId, Y.Map<string, any>>"
    // I will use 'sessions'.
    super(doc.getMap('sessions'));
  }

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
