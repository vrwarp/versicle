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

  describe('root-type discovery', () => {
    /**
     * `docToJson` has to work out each root's type on BOTH sides of the
     * diff, and the two sides are shaped differently: the live doc holds
     * concrete types, a doc hydrated from a checkpoint blob holds
     * `AbstractType`. `Doc.get` coerces the latter instead of throwing, so
     * a getMap-first ladder silently read every Array or Text root as an
     * empty map — making that store diff as "everything removed" from a
     * screen whose job is to say what a restore would cost.
     */
    const blobWith = (mutate: (doc: Y.Doc) => void): Uint8Array => {
      const doc = new Y.Doc();
      mutate(doc);
      const update = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      return update;
    };

    it('reads an ARRAY root on the CHECKPOINT side, not as an empty map', () => {
      yDoc.getArray('queue').insert(0, ['live-item']);
      const blob = blobWith((doc) => doc.getArray('queue').insert(0, ['checkpoint-item']));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.queue.modified['0']).toEqual({
        old: 'live-item',
        new: 'checkpoint-item',
      });
      expect(diffs.queue.removed).toEqual({});
    });

    /**
     * KNOWN LIMITATION, pinned so a change to it is deliberate: `deepDiff`
     * walks object KEYS, and a Text root reads as a plain string, so its
     * content never reaches the comparison — a changed Text root reports as
     * no change at all. `readRoot` still reads Text correctly (that is what
     * keeps it out of the "everything removed" trap the Array roots were
     * in), but surfacing a scalar root would mean changing `DiffResult`'s
     * shape, which is UI-facing. Versicle stores no Text roots today.
     */
    it('does not surface a TEXT root change — deepDiff compares object keys', () => {
      yDoc.getText('notes').insert(0, 'live');
      const blob = blobWith((doc) => doc.getText('notes').insert(0, 'checkpoint'));

      expect(CheckpointInspector.diffCheckpoint(blob).notes).toEqual({
        added: {},
        removed: {},
        modified: {},
        unchangedCount: 0,
      });
    });

    it('does not invent a removal for an array that did not change', () => {
      yDoc.getArray('queue').insert(0, ['same']);
      const blob = blobWith((doc) => doc.getArray('queue').insert(0, ['same']));

      expect(CheckpointInspector.diffCheckpoint(blob).queue).toEqual({
        added: {},
        removed: {},
        modified: {},
        unchangedCount: 1,
      });
    });

    it('reports a genuine array growth as added, not as a wholesale swap', () => {
      yDoc.getArray('queue').insert(0, ['a']);
      const blob = blobWith((doc) => doc.getArray('queue').insert(0, ['a', 'b']));

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.queue.added).toEqual({ '1': 'b' });
      expect(diffs.queue.unchangedCount).toBe(1);
    });

    it('reads an ARRAY root on the LIVE side too', () => {
      yDoc.getArray('queue').insert(0, ['live-only']);
      const blob = blobWith((doc) => doc.getMap('library').set('k', 1));

      expect(CheckpointInspector.diffCheckpoint(blob).queue.removed).toEqual({
        '0': 'live-only',
      });
    });

    it('handles an array of nested types', () => {
      const row = new Y.Map();
      row.set('title', 'live');
      yDoc.getArray('rows').insert(0, [row]);
      const blob = blobWith((doc) => {
        const other = new Y.Map();
        other.set('title', 'checkpoint');
        doc.getArray('rows').insert(0, [other]);
      });

      expect(CheckpointInspector.diffCheckpoint(blob).rows.modified['0']).toEqual({
        old: { title: 'live' },
        new: { title: 'checkpoint' },
      });
    });

    it('SKIPS an xml root on both sides, so it never reads as a change', () => {
      yDoc.getXmlFragment('body').insert(0, [new Y.XmlText('live xml')]);
      const blob = blobWith((doc) => {
        doc.getXmlFragment('body').insert(0, [new Y.XmlText('checkpoint xml')]);
        doc.getMap('library').set('kept', 2);
      });
      yDoc.getMap('library').set('kept', 1);

      const diffs = CheckpointInspector.diffCheckpoint(blob);

      expect(diffs.body).toBeUndefined();
      expect(diffs.library.modified.kept).toEqual({ old: 1, new: 2 });
    });

    it('still reads map roots — the only kind versicle actually stores', () => {
      yDoc.getMap('library').set('a', 1);
      const blob = blobWith((doc) => doc.getMap('library').set('a', 2));

      expect(CheckpointInspector.diffCheckpoint(blob).library.modified.a).toEqual({
        old: 1,
        new: 2,
      });
    });

    it('treats an empty root as an empty map on both sides', () => {
      yDoc.getArray('empty');
      const blob = blobWith((doc) => doc.getMap('library').set('k', 1));

      expect(CheckpointInspector.diffCheckpoint(blob).empty).toEqual({
        added: {},
        removed: {},
        modified: {},
        unchangedCount: 0,
      });
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

      expect(CheckpointInspector.diffCheckpoint(blob).library).toEqual({
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
