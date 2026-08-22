/**
 * `readUpdateSchemaVersion` runs the pre-apply version check on a THROWAWAY
 * doc — the whole point is that a malformed or hostile update never touches
 * live state. That means the scratch doc must be released on both exits;
 * a leaked Y.Doc per checked update is a slow memory leak on the connect
 * and switch paths, invisible to a value-only assertion.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { readUpdateSchemaVersion } from './quarantine';

const updateWith = (mutate: (doc: Y.Doc) => void): Uint8Array => {
  const doc = new Y.Doc();
  mutate(doc);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readUpdateSchemaVersion — scratch-doc hygiene', () => {
  it('destroys the scratch doc after a successful read', () => {
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
    const update = updateWith((d) => d.getMap('meta').set('schemaVersion', 6));
    destroy.mockClear();

    expect(readUpdateSchemaVersion(update)).toBe(6);

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the scratch doc even when the update is malformed', () => {
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);
    destroy.mockClear();

    expect(() => readUpdateSchemaVersion(garbage)).toThrow();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('never leaks the scratch doc into the answer', () => {
    const update = updateWith((d) => d.getMap('library').set('__schemaVersion', 4));

    expect(readUpdateSchemaVersion(update)).toBe(4);
  });

  it('reads the MAX of the two version keys, tolerating a partial dual-write', () => {
    const update = updateWith((d) => {
      d.getMap('meta').set('schemaVersion', 5);
      d.getMap('library').set('__schemaVersion', 6);
    });

    expect(readUpdateSchemaVersion(update)).toBe(6);
  });

  it('reads a doc carrying neither key as the pre-versioning era', () => {
    expect(readUpdateSchemaVersion(updateWith((d) => d.getMap('library').set('x', 1)))).toBe(1);
  });

  it('ignores a non-numeric version', () => {
    const update = updateWith((d) => d.getMap('meta').set('schemaVersion', 'six'));

    expect(readUpdateSchemaVersion(update)).toBe(1);
  });
});
