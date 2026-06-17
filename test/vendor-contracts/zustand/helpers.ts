import * as Y from 'yjs';

/**
 * Shared helpers for the fork contract suite (phase2-fork-surgery.md §3).
 *
 * Tests use REAL Y.Docs and two-doc replication via
 * Y.encodeStateAsUpdate/Y.applyUpdate — no mocks (the pattern of the absorbed
 * src/store/zustand-middleware-yjs-undefined.test.ts).
 */

/**
 * Drain the microtask queue completely (outbound flush AND the inbound
 * processBatch it may trigger) by waiting for a macrotask.
 */
export const drain = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One-way state replication: everything `from` knows lands in `to`. */
export const replicate = (from: Y.Doc, to: Y.Doc): void => {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
};

/** Count Y.Doc 'update' events (i.e. local-or-applied transactions with changes). */
export const countUpdates = (doc: Y.Doc): { count: () => number } => {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return { count: () => n };
};
