import * as Y from 'yjs';
import { getYDoc } from '@store/yjs-provider';

// Type definitions for the Diff result
export interface DiffResult {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Record<string, { old: unknown; new: unknown }>;
  unchangedCount: number;
}

/** Xml roots are not represented in the diff — see readRoot. */
function isXmlType(type: unknown): boolean {
  return (
    type instanceof Y.XmlElement || type instanceof Y.XmlText || type instanceof Y.XmlFragment
  );
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
    const liveJson = this.docToJson(getYDoc());
    const checkpointJson = this.docToJson(tempDoc);

    const diffs: Record<string, DiffResult> = {};
    // Iterate known shared types
    const allStores = new Set([...Object.keys(liveJson), ...Object.keys(checkpointJson)]);

    // 3. Diff each store individually
    for (const store of allStores) {
      diffs[store] = this.deepDiff(liveJson[store], checkpointJson[store]);
    }

    return diffs;
  }

  private static docToJson(doc: Y.Doc): Record<string, unknown> {
    const json: Record<string, unknown> = {};

    // doc.share holds every top-level type (Map, Array, Text, …).
    for (const key of Array.from(doc.share.keys())) {
      const value = CheckpointInspector.readRoot(doc, key);
      if (value !== undefined) json[key] = value;
    }

    return json;
  }

  /**
   * One root type as JSON, for either side of the diff.
   *
   * The LIVE doc holds concrete types, but a doc hydrated from a checkpoint
   * blob holds `AbstractType` roots — and `Doc.get` COERCES those into
   * whichever constructor it is asked for rather than throwing. So the
   * previous try/catch ladder (getMap → getArray → getText) never fell
   * through on the checkpoint side: an Array or Text root came back as an
   * empty map, and that store then diffed as "everything removed" — the
   * worst possible answer from a screen whose whole job is to say what a
   * destructive restore would cost. Infer from the STRUCTURE instead, so
   * both sides of the diff read the same root the same way.
   *
   * Xml roots are deliberately absent from the diff, on both sides —
   * symmetry is what stops a skipped root reading as a change. Versicle
   * stores none today: every root of the replicated doc is a Map.
   *
   * A Text root reads correctly here but still does not SHOW a change:
   * {@link deepDiff} walks object keys, and a string has none. Surfacing a
   * scalar root would mean changing `DiffResult`'s UI-facing shape, so it is
   * left alone and pinned as a known limitation in the suite.
   */
  private static readRoot(doc: Y.Doc, key: string): unknown {
    const shared = doc.share.get(key);
    if (!shared) return undefined;

    // Live doc: the root already is the type it will stay. (YXmlElement
    // extends YXmlFragment, so this covers both.)
    if (shared instanceof Y.XmlFragment) return undefined;
    if (shared instanceof Y.Map || shared instanceof Y.Array || shared instanceof Y.Text) {
      return shared.toJSON();
    }

    // Hydrated doc: an AbstractType carrying the content but not the class.
    const start = (shared as unknown as { _start: Y.Item | null })._start;
    if (start === null) {
      // No sequence content, so map-like. A wholly empty root reads as {}
      // under either interpretation, which makes the choice immaterial.
      return doc.getMap(key).toJSON();
    }

    const content = start.content;
    if (content instanceof Y.ContentString || content instanceof Y.ContentFormat) {
      return doc.getText(key).toJSON();
    }
    if (content instanceof Y.ContentType && isXmlType(content.type)) {
      return undefined;
    }
    return doc.getArray(key).toJSON();
  }

  private static deepDiff(live: unknown, checkpoint: unknown): DiffResult {
    const added: Record<string, unknown> = {};
    const removed: Record<string, unknown> = {};
    const modified: Record<string, { old: unknown; new: unknown }> = {};
    let unchangedCount = 0;

    // Handle non-object types safely
    const liveObj = (typeof live === 'object' && live !== null) ? (live as Record<string, unknown>) : {};
    const checkpointObj = (typeof checkpoint === 'object' && checkpoint !== null) ? (checkpoint as Record<string, unknown>) : {};

    const allKeys = new Set([...Object.keys(liveObj), ...Object.keys(checkpointObj)]);

    for (const key of allKeys) {
      const liveVal = liveObj[key];
      const cpVal = checkpointObj[key];

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
