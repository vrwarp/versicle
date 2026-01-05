
/**
 * Represents a log entry for a synchronization event.
 */
export interface SyncLogEntry {
  /** Timestamp of the sync event. */
  timestamp: number;
  /** The type of event (e.g., 'pull', 'push', 'merge'). */
  type: 'pull' | 'push' | 'merge' | 'error' | 'restore';
  /** Status of the operation. */
  status: 'success' | 'failure' | 'conflict';
  /** Details or error message. */
  details?: string;
  /** The device ID involved in the sync (if applicable). */
  deviceId?: string;
}

/**
 * Represents a local checkpoint for data restoration.
 */
export interface Checkpoint {
  /** Timestamp of the checkpoint (Primary Key). */
  timestamp: number;
  /** Serialized JSON of the "Moral Layer" (books, annotations, history, lexicon). */
  data: string;
  /** Reason for the checkpoint (e.g., 'pre-sync', 'manual'). */
  reason: string;
  /** Size of the checkpoint in bytes. */
  size: number;
}
