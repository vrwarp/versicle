import { dbService } from '../db/DBService';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { TTSState } from '../types/db';

// SessionProxy manages TTS State.
// We haven't created a TTSStateModel yet (it wasn't in the plan as a singular entity).
// But we can leave it returning interfaces for now or create one.
// The user said "design across ALL models".
// But TTSState is complex (Queue is array of objects).
// I will rename to Proxy and keep interface for now, as I didn't create SessionModel (Entity).

export class SessionProxy {
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
