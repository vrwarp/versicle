import type { Timepoint } from '../lib/tts/providers/types';

export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  description?: string;
  coverUrl?: string; // Blob URL (created on load, revoked on unload)
  coverBlob?: Blob; // Stored in IndexedDB, not usually passed to UI
  addedAt: number;
  lastRead?: number;
  progress?: number; // 0-1 percentage
  currentCfi?: string; // Last read position
}

export interface Annotation {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string; // The selected text
  type: 'highlight' | 'note';
  color: string;
  note?: string;
  created: number;
}

export interface CachedSegment {
  key: string;      // SHA-256 hash
  audio: ArrayBuffer;
  alignment?: Timepoint[];
  createdAt: number;
  lastAccessed: number;
}
