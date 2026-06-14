/**
 * Unit pins for the §D5 quarantine primitives. The version reads must match
 * the migration coordinator byte-for-byte (risk R4: a divergent read could
 * false-positive a quarantine and brick a legitimate client) — asserted
 * here against the committed era fixtures the coordinator is pinned on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { readDocSchemaVersion, readUpdateSchemaVersion } from './quarantine';
import { readDocSchemaVersion as coordinatorRead } from '@app/migrations';

const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

const loadFixtureUpdate = (era: 1 | 2 | 4 | 5): Uint8Array =>
  new Uint8Array(readFileSync(join(fixtureDir, `v${era}.update.bin`)));

describe('quarantine version reads (§D5)', () => {
  it('is the coordinator’s exact read (one function, re-exported)', () => {
    expect(coordinatorRead).toBe(readDocSchemaVersion);
  });

  it('reads era fixtures at their captured versions without touching live state', () => {
    expect(readUpdateSchemaVersion(loadFixtureUpdate(1))).toBe(1);
    expect(readUpdateSchemaVersion(loadFixtureUpdate(2))).toBe(2);
    expect(readUpdateSchemaVersion(loadFixtureUpdate(4))).toBe(4);
    expect(readUpdateSchemaVersion(loadFixtureUpdate(5))).toBe(5);
  });

  it('an empty update reads as v1 (pre-versioning era; never quarantined)', () => {
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    expect(readUpdateSchemaVersion(empty)).toBe(1);
  });

  it('max(meta, library) tolerates partial dual-writes in either direction', () => {
    const metaOnly = new Y.Doc();
    metaOnly.getMap('meta').set('schemaVersion', 7);
    expect(readDocSchemaVersion(metaOnly)).toBe(7);

    const libraryOnly = new Y.Doc();
    libraryOnly.getMap('library').set('__schemaVersion', 7);
    expect(readDocSchemaVersion(libraryOnly)).toBe(7);

    const split = new Y.Doc();
    split.getMap('meta').set('schemaVersion', 6);
    split.getMap('library').set('__schemaVersion', 7);
    expect(readDocSchemaVersion(split)).toBe(7);
  });

  it('non-numeric version stamps are ignored, not trusted', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('schemaVersion', 'v99');
    expect(readDocSchemaVersion(doc)).toBe(1);
  });

  it('a malformed update throws (callers route to their failure paths)', () => {
    expect(() => readUpdateSchemaVersion(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
