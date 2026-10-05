/**
 * Sync diagnostics recorder: bounded in-memory history of what the sync
 * layer did on THIS device since boot, for the exportable diagnostics bundle
 * (./collect.ts). Three rings:
 *
 *  - `events`    — every typed SyncEvent (fed by wireSyncEvents, which stays
 *                  the bus's single subscriber);
 *  - `updates`   — every Y.Doc update with its origin class (local edit,
 *                  y-idb load, or a firebase snapshot/history/update apply)
 *                  and the top-level maps it touched — the "did the other
 *                  device's change ever arrive here?" question;
 *  - `lifecycle` — online/offline and visibility transitions (mobile
 *                  WebViews suspend Firestore listeners in the background).
 *
 * Plus running per-origin totals, so a long session that overflowed the
 * ring still reports when the last remote update arrived. Nothing here is
 * persisted; everything is reset on reload.
 */
import type * as Y from 'yjs';
import type { SyncEvent } from '@domains/sync/events';

const EVENT_CAPACITY = 500;
const UPDATE_CAPACITY = 1500;
const LIFECYCLE_CAPACITY = 300;

/** How a Y.Doc update reached the doc. */
export type UpdateOriginClass =
  | 'local'
  | 'idb'
  | 'remote:snapshot'
  | 'remote:history'
  | 'remote:update'
  | 'remote:other'
  | 'other';

interface RecordedSyncEvent {
  t: number;
  event: SyncEvent;
}

interface RecordedUpdate {
  t: number;
  origin: UpdateOriginClass;
  bytes: number;
  /** Top-level shared types this update touched. */
  roots: string[];
}

interface RecordedLifecycle {
  t: number;
  kind: string;
  detail?: string;
}

interface OriginTotals {
  count: number;
  bytes: number;
  firstAt: number | null;
  lastAt: number | null;
}

class Ring<T> {
  private items: T[] = [];
  private start = 0;
  dropped = 0;
  constructor(private readonly capacity: number) {}
  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      this.items[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
      this.dropped++;
    }
  }
  toArray(): T[] {
    return [...this.items.slice(this.start), ...this.items.slice(0, this.start)];
  }
  clear(): void {
    this.items = [];
    this.start = 0;
    this.dropped = 0;
  }
}

const events = new Ring<RecordedSyncEvent>(EVENT_CAPACITY);
const updates = new Ring<RecordedUpdate>(UPDATE_CAPACITY);
const lifecycle = new Ring<RecordedLifecycle>(LIFECYCLE_CAPACITY);
let totals: Partial<Record<UpdateOriginClass, OriginTotals>> = {};
const recorderStartedAt = Date.now();

/** Record one SyncEvent (called from wireSyncEvents' single subscriber). */
export function recordSyncEvent(event: SyncEvent): void {
  events.push({ t: Date.now(), event });
}

function recordLifecycle(kind: string, detail?: string): void {
  lifecycle.push({ t: Date.now(), kind, ...(detail !== undefined ? { detail } : {}) });
}

/**
 * Classify a Y.Doc transaction origin. y-cinder applies remote state with
 * the string origins `origin:firebase/{snapshot,history,update}`; y-idb
 * applies its stored state with the persistence instance as origin
 * (recognised via `isIdbOrigin`); a local store write carries no origin
 * (or the zustand middleware's) and is `local` by the transaction flag.
 */
export function classifyOrigin(
  origin: unknown,
  isLocal: boolean,
  isIdbOrigin: (origin: unknown) => boolean
): UpdateOriginClass {
  if (typeof origin === 'string' && origin.startsWith('origin:firebase/')) {
    const kind = origin.slice('origin:firebase/'.length);
    if (kind === 'snapshot' || kind === 'history' || kind === 'update') return `remote:${kind}`;
    return 'remote:other';
  }
  if (origin != null && isIdbOrigin(origin)) return 'idb';
  return isLocal ? 'local' : 'other';
}

/** Names of the top-level shared types a transaction touched. */
function changedRoots(doc: Y.Doc, transaction: Y.Transaction | undefined): string[] {
  if (!transaction) return [];
  const names = new Set<string>();
  let reverse: Map<unknown, string> | null = null;
  for (const type of transaction.changed.keys()) {
    // Walk up to the top-level type (a root has no parent item).
    let root: { _item: { parent: unknown } | null } = type;
    while (root._item && root._item.parent) {
      root = root._item.parent as { _item: { parent: unknown } | null };
    }
    if (!reverse) {
      reverse = new Map();
      for (const [name, shared] of doc.share) reverse.set(shared, name);
    }
    names.add(reverse.get(root) ?? '?');
  }
  return [...names].sort();
}

function noteUpdate(origin: UpdateOriginClass, bytes: number, roots: string[]): void {
  const t = Date.now();
  updates.push({ t, origin, bytes, roots });
  const bucket = (totals[origin] ??= { count: 0, bytes: 0, firstAt: null, lastAt: null });
  bucket.count++;
  bucket.bytes += bytes;
  bucket.firstAt ??= t;
  bucket.lastAt = t;
}

/**
 * Start recording doc updates + lifecycle transitions. Returns the cleanup.
 * Idempotent per doc in practice (the boot task calls it once).
 */
export function startSyncDiagnosticsRecorder(opts: {
  doc: Y.Doc;
  isIdbOrigin: (origin: unknown) => boolean;
}): () => void {
  const { doc, isIdbOrigin } = opts;
  const onUpdate = (
    update: Uint8Array,
    origin: unknown,
    _doc: Y.Doc,
    transaction: Y.Transaction
  ): void => {
    try {
      noteUpdate(
        classifyOrigin(origin, transaction?.local ?? false, isIdbOrigin),
        update.byteLength,
        changedRoots(doc, transaction)
      );
    } catch {
      // Diagnostics must never break a doc update.
    }
  };
  doc.on('update', onUpdate);

  const cleanups: Array<() => void> = [() => doc.off('update', onUpdate)];
  if (typeof window !== 'undefined') {
    const listen = (target: EventTarget, name: string, describe: () => string | undefined): void => {
      const handler = (): void => recordLifecycle(name, describe());
      target.addEventListener(name, handler);
      cleanups.push(() => target.removeEventListener(name, handler));
    };
    listen(window, 'online', () => undefined);
    listen(window, 'offline', () => undefined);
    listen(window, 'pagehide', () => undefined);
    listen(window, 'pageshow', () => undefined);
    if (typeof document !== 'undefined') {
      listen(document, 'visibilitychange', () => document.visibilityState);
      listen(document, 'freeze', () => undefined);
      listen(document, 'resume', () => undefined);
    }
    recordLifecycle(
      'recorder-started',
      `online=${typeof navigator !== 'undefined' ? String(navigator.onLine) : '?'} visibility=${
        typeof document !== 'undefined' ? document.visibilityState : '?'
      }`
    );
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export interface RecorderSnapshot {
  recorderStartedAt: number;
  updateTotals: Partial<Record<UpdateOriginClass, OriginTotals>>;
  events: RecordedSyncEvent[];
  eventsDropped: number;
  updates: RecordedUpdate[];
  updatesDropped: number;
  lifecycle: RecordedLifecycle[];
  lifecycleDropped: number;
}

export function getRecorderSnapshot(): RecorderSnapshot {
  return {
    recorderStartedAt,
    updateTotals: structuredClone(totals),
    events: events.toArray(),
    eventsDropped: events.dropped,
    updates: updates.toArray(),
    updatesDropped: updates.dropped,
    lifecycle: lifecycle.toArray(),
    lifecycleDropped: lifecycle.dropped,
  };
}

/** Test isolation only. */
export function resetSyncDiagnosticsRecorder(): void {
  events.clear();
  updates.clear();
  lifecycle.clear();
  totals = {};
}
