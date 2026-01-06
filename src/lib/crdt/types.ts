import * as Y from 'yjs';
import type { Annotation, LexiconRule, ReadingListEntry, TTSPosition } from '../../types/db';

/**
 * The strict schema for the Versicle Y.Doc "Moral Layer".
 */
export interface VersicleDocSchema {
  /**
   * Keyed by bookId.
   * Value: A child Y.Map containing BookMetadata fields.
   */
  books: Y.Map<Y.Map<any>>;

  /**
   * Global append-only array of user highlights.
   */
  annotations: Y.Array<Annotation>;

  /**
   * Ordered global/book pronunciation rules.
   */
  lexicon: Y.Array<LexiconRule>;

  /**
   * Keyed by bookId.
   * Value: Y.Array of CFI strings representing read ranges.
   */
  history: Y.Map<Y.Array<string>>;

  /**
   * Keyed by filename.
   * Lightweight portable history.
   */
  readingList: Y.Map<ReadingListEntry>;

  /**
   * High-frequency "Handoff" data (TTS positions).
   * Keyed by bookId.
   */
  transient: Y.Map<TTSPosition>;

  /**
   * synchronized settings (credentials, flags).
   * Keyed by setting name.
   */
  settings: Y.Map<any>;
}

/**
 * Helper type to access the doc structure.
 *
 * Note: Yjs doesn't strictly enforce schema on the doc object itself
 * like a typed object, but we use this to define what we expect
 * to retrieve via doc.getMap() or doc.getArray().
 */
export type VersicleDoc = Y.Doc;

/**
 * Keys used to access the shared types in the Y.Doc.
 */
export const CRDT_KEYS = {
  BOOKS: 'books',
  ANNOTATIONS: 'annotations',
  LEXICON: 'lexicon',
  HISTORY: 'history',
  READING_LIST: 'readingList',
  TRANSIENT: 'transient',
  SETTINGS: 'settings',
} as const;
