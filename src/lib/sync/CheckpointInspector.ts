import * as Y from 'yjs';
import { yDoc as liveDoc } from '../../store/yjs-provider';
import { SHARED_STORE_SCHEMA } from './CheckpointService';

// Type definitions for the Diff result
export interface DiffResult {
  added: Record<string, any>;
  removed: Record<string, any>;
  modified: Record<string, { old: any; new: any }>;
  unchangedCount: number;
}

const DYNAMIC_STORE_PREFIXES = ['preferences/'];

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

    // 1. Static Schema
    for (const [key, type] of Object.entries(SHARED_STORE_SCHEMA)) {
      if (type === 'Map') {
        const map = doc.getMap(key);
        // Only add if it has content or exists in share (to differentiate empty vs missing)
        // Actually, getMap always returns a Map. We check keys size or if it's in doc.share?
        // To be safe and consistent, we always include it if it's in the schema.
        json[key] = map.toJSON();
      } else if (type === 'Array') {
        const arr = doc.getArray(key);
        json[key] = arr.toJSON();
      }
    }

    // 2. Dynamic Keys (iterate doc.share)
    const allKeys = Array.from(doc.share.keys());
    for (const key of allKeys) {
      if (SHARED_STORE_SCHEMA[key]) continue; // Already handled

      const isDynamic = DYNAMIC_STORE_PREFIXES.some(prefix => key.startsWith(prefix));
      if (isDynamic) {
        // Dynamic keys (preferences) are Maps. Force getMap to ensure correct instantiation.
        // doc.share.get() might return a generic AbstractType that hasn't fully hydrated to Y.Map yet.
        const map = doc.getMap(key);
        json[key] = map.toJSON();
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
