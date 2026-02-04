import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CheckpointInspector } from './CheckpointInspector';
import { yDoc } from '../../store/yjs-provider';
import { SHARED_STORE_SCHEMA } from './CheckpointService';

describe('CheckpointInspector', () => {
  beforeEach(() => {
    // Clear live doc
    yDoc.transact(() => {
        // Clear all schema types
        for (const [key, type] of Object.entries(SHARED_STORE_SCHEMA)) {
            if (type === 'Map') {
                const map = yDoc.getMap(key);
                Array.from(map.keys()).forEach(k => map.delete(k));
            } else if (type === 'Array') {
                const arr = yDoc.getArray(key);
                arr.delete(0, arr.length);
            }
        }
        // Clear dynamic
        Array.from(yDoc.share.keys()).forEach(key => {
            if (key.startsWith('preferences/')) {
                const map = yDoc.getMap(key);
                Array.from(map.keys()).forEach(k => map.delete(k));
            }
        });
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
});
