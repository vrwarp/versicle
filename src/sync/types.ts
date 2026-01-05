import type { BookMetadata, ReadingHistoryEntry, Annotation, LexiconRule, ReadingListEntry, TTSPosition } from '../types/db';

export interface SyncManifest {
  version: number;       // Schema version for migration handling
  lastUpdated: number;    // Global timestamp (UTC)
  deviceId: string;       // Unique ID of the device that last wrote to the manifest
  books: {
    [bookId: string]: {
      metadata: Partial<BookMetadata>;
      history: ReadingHistoryEntry;
      annotations: Annotation[];
    };
  };
  lexicon: LexiconRule[];
  readingList: Record<string, ReadingListEntry>; // Lightweight portable history
  transientState: {
    // High-frequency updates used for "Handoff" scenarios
    ttsPositions: Record<string, TTSPosition>;
  };
  deviceRegistry: {
    [deviceId: string]: {
      name: string;
      lastSeen: number;
    };
  };
}
