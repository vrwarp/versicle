import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CheckpointInspector } from './CheckpointInspector';
import { getYDoc } from '@store/yjs-provider';

const yDoc = getYDoc();

describe('CheckpointInspector', () => {
  beforeEach(() => {
    // Clear live doc
    yDoc.transact(() => {
        const keys = Array.from(yDoc.share.keys());
        for (const key of keys) {
            const type = yDoc.share.get(key);
            if (type instanceof Y.Map) {
                Array.from(type.keys()).forEach(k => type.delete(k));
            } else if (type instanceof Y.Array) {
                type.delete(0, type.length);
            }
        }
    });
  });

  it('should detect added items (in Checkpoint, not in Live)', () => {
    // Setup Checkpoint State
    const tempDoc = new Y.Doc();
    const map = tempDoc.getMap('library');
    map.set('book1', { title: 'Moby Dick' });
    const blob = Y.encodeStateAsUpdate(tempDoc);

    const result = CheckpointInspector.diffCheckpoint(blob);

    expect(result['library'].added).toEqual({ 'book1': { title: 'Moby Dick' } });
    expect(result['library'].removed).toEqual({});
    expect(result['library'].modified).toEqual({});
  });

  it('should detect removed items (in Live, not in Checkpoint)', () => {
    // Setup Live State
    const map = yDoc.getMap('library');
    map.set('book1', { title: 'Moby Dick' });

    // Setup Checkpoint State (Empty)
    const tempDoc = new Y.Doc();
    const blob = Y.encodeStateAsUpdate(tempDoc);

    const result = CheckpointInspector.diffCheckpoint(blob);

    expect(result['library'].removed).toEqual({ 'book1': { title: 'Moby Dick' } });
    expect(result['library'].added).toEqual({});
  });

  it('should detect modified items', () => {
    // Setup Live State
    const map = yDoc.getMap('library');
    map.set('book1', { title: 'Moby Dick', progress: 0.5 });

    // Setup Checkpoint State
    const tempDoc = new Y.Doc();
    const tempMap = tempDoc.getMap('library');
    tempMap.set('book1', { title: 'Moby Dick', progress: 0.1 });
    const blob = Y.encodeStateAsUpdate(tempDoc);

    const result = CheckpointInspector.diffCheckpoint(blob);

    expect(result['library'].modified['book1']).toEqual({
      old: { title: 'Moby Dick', progress: 0.5 },
      new: { title: 'Moby Dick', progress: 0.1 }
    });
  });

  it('should handle multiple stores', () => {
     // Live
     yDoc.getMap('library').set('b1', 'live');

     // Checkpoint
     const tempDoc = new Y.Doc();
     tempDoc.getMap('reading-list').set('b1', 'read');
     const blob = Y.encodeStateAsUpdate(tempDoc);

     const result = CheckpointInspector.diffCheckpoint(blob);

     expect(result['library'].removed['b1']).toBe('live');
     expect(result['reading-list'].added['b1']).toBe('read');
  });

  it('should handle dynamic keys (preferences)', () => {
      // Checkpoint with Preferences
      const tempDoc = new Y.Doc();
      const map = tempDoc.getMap('preferences/device-123');
      map.set('theme', 'dark');
      const blob = Y.encodeStateAsUpdate(tempDoc);

      const result = CheckpointInspector.diffCheckpoint(blob);
      // Ensure the key exists before checking property
      if (result['preferences/device-123']) {
          expect(result['preferences/device-123'].added).toEqual({ theme: 'dark' });
      } else {
          // Fail explicitly if key missing, to distinguish from missing property
          expect(Object.keys(result)).toContain('preferences/device-123');
      }
  });

  describe('dynamic root-type discovery', () => {
    /**
     * `docToJson` has to GUESS each root's type — Map, then Array, then
     * Text — because a doc hydrated from a blob holds AbstractTypes. The
     * guessing shows up on the LIVE doc, whose roots are concrete: if a
     * fallback is missing, that whole store silently vanishes from the
     * diff, and the recovery UI shows "nothing will be lost" for data that
     * would be.
     */
    const blobWith = (mutate: (doc: Y.Doc) => void): Uint8Array => {
      const doc = new Y.Doc();
      mutate(doc);
      const update = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      return update;
    };

    it('reads an ARRAY root after the map attempt fails', () => {
      yDoc.getArray('queue').insert(0, ['live-item']);
      const blob = blobWith((doc) => doc.getMap('library').set('k', 1));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.queue).toBeDefined();
      expect(diffs.queue.removed).toEqual({ '0': 'live-item' });
    });

    it('reads a TEXT root after both the map and array attempts fail', () => {
      yDoc.getText('notes').insert(0, 'live');
      const blob = blobWith((doc) => doc.getMap('library').set('k', 1));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.notes).toBeDefined();
    });

    it('skips a root type it cannot read, without losing its siblings', () => {
      yDoc.getXmlFragment('body').insert(0, [new Y.XmlText('live xml')]);
      yDoc.getMap('library').set('kept', 1);
      const blob = blobWith((doc) => doc.getMap('library').set('kept', 2));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.body).toBeUndefined();
      expect(diffs.library.modified.kept).toEqual({ old: 1, new: 2 });
    });

    it('diffs every root the two docs hold BETWEEN them', () => {
      yDoc.getMap('only-live').set('a', 1);
      const blob = blobWith((doc) => doc.getMap('only-checkpoint').set('b', 2));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(Object.keys(diffs)).toEqual(
        expect.arrayContaining(['only-checkpoint', 'only-live'])
      );
      expect(diffs['only-live'].removed).toEqual({ a: 1 });
      expect(diffs['only-checkpoint'].added).toEqual({ b: 2 });
    });

    it('counts unchanged keys rather than listing them', () => {
      yDoc.getMap('library').set('same', 'v');
      const blob = blobWith((doc) => doc.getMap('library').set('same', 'v'));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.library).toEqual({
        added: {},
        removed: {},
        modified: {},
        unchangedCount: 1,
      });
    });

    it('compares by VALUE, so an equal nested object counts as unchanged', () => {
      yDoc.getMap('library').set('book', { title: 'T', tags: ['a'] });
      const blob = blobWith((doc) => doc.getMap('library').set('book', { title: 'T', tags: ['a'] }));

      expect(CheckpointInspector.diffCheckpoint(blob).library.unchangedCount).toBe(1);
    });
  });
});
