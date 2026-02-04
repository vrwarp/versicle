import * as Y from 'yjs';
import { yDoc as liveDoc } from '../../store/yjs-provider';

// Type definitions for the Diff result
export interface DiffResult {
  added: Record<string, any>;
  removed: Record<string, any>;
  modified: Record<string, { old: any; new: any }>;
  unchangedCount: number;
}

export class CheckpointInspector {
  /**
   * Generates a diff: Live State vs Checkpoint Blob
   */
  static diffCheckpoint(checkpointBlob: Uint8Array): Record<string, DiffResult> {
    // 1. Hydrate blob into an ephemeral doc
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, checkpointBlob);

    // 2. Convert both to JSON
    const liveJson = this.docToJson(liveDoc);
    const checkpointJson = this.docToJson(tempDoc);

    const diffs: Record<string, DiffResult> = {};
    // Iterate known shared types
    const allStores = new Set([...Object.keys(liveJson), ...Object.keys(checkpointJson)]);

    // 3. Diff each store individually
    for (const store of allStores) {
      diffs[store] = this.deepDiff(liveJson[store] || {}, checkpointJson[store] || {});
    }

    return diffs;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static docToJson(doc: Y.Doc): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: Record<string, any> = {};

    // Iterate all shared types in the document
    // doc.share contains all top-level types (Map, Array, etc.)
    const allKeys = Array.from(doc.share.keys());

    for (const key of allKeys) {
      // Dynamic Type Discovery
      // When hydrating a doc from blob, items in share are AbstractType.
      // We must attempt to retrieve them as specific types to access content.
      try {
        // Try Map (most common)
        const map = doc.getMap(key);
        // access toJSON to verify it works (might throw if type mismatch actually happens on access?)
        // actually getMap throws if type mismatch.
        json[key] = map.toJSON();
      } catch {
        try {
          // Try Array
          const arr = doc.getArray(key);
          json[key] = arr.toJSON();
        } catch {
          // Try Text or others if needed, or ignore
          try {
             const text = doc.getText(key);
             json[key] = text.toJSON();
          } catch {
             // Unknown type or Xml, skip
          }
        }
      }
    }

    return json;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static deepDiff(live: any, checkpoint: any): DiffResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const added: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const removed: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modified: Record<string, { old: any; new: any }> = {};
    let unchangedCount = 0;

    // Handle non-object types safely
    if (typeof live !== 'object' || live === null) live = {};
    if (typeof checkpoint !== 'object' || checkpoint === null) checkpoint = {};

    const allKeys = new Set([...Object.keys(live), ...Object.keys(checkpoint)]);

    for (const key of allKeys) {
      const liveVal = live[key];
      const cpVal = checkpoint[key];

      if (cpVal === undefined) {
        // Exists in Live, not in Checkpoint.
        // If we restore Checkpoint, this will be LOST (Removed from Live).
        removed[key] = liveVal;
      } else if (liveVal === undefined) {
        // Exists in Checkpoint, not in Live.
        // If we restore Checkpoint, this will be ADDED (Restored to Live).
        added[key] = cpVal;
      } else if (JSON.stringify(liveVal) !== JSON.stringify(cpVal)) {
        modified[key] = { old: liveVal, new: cpVal }; // Changed
      } else {
        unchangedCount++;
      }
    }
    return { added, removed, modified, unchangedCount };
  }
}
