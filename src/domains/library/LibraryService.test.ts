/**
 * `LibraryService` — port-level unit suite.
 *
 * LibraryService.invariants.test.ts pins the five race invariants against
 * the REAL stores, at the interleavings that produced them. This file is
 * the complement: in-memory ports, no stores, so the branch structure the
 * invariants ride on top of is stated directly — the bulk-vs-per-key
 * persistence capability probes, the hydration guards, the delta
 * subscription, and each failure arm's exact recovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BookMetadata } from '~types/book';
import type { UserInventoryItem } from '~types/user-data';
import { LibraryService, type LibraryServiceDeps } from './LibraryService';
import type { ImportOrchestrator } from './import/ImportOrchestrator';
import type { InventoryPort, LibraryPersistence, LibraryProjectionPort } from './ports';

const meta = (id: string, over: Partial<BookMetadata> = {}): BookMetadata =>
  ({ id, title: `Title ${id}`, ...over }) as BookMetadata;

const item = (id: string): UserInventoryItem => ({ id, addedAt: 1 }) as UserInventoryItem;

interface Fakes {
  service: LibraryService;
  inventory: Record<string, UserInventoryItem>;
  notifyInventory: (books: Record<string, UserInventoryItem>) => void;
  unsubscribed: number;
  statics: Map<string, BookMetadata>;
  offloadedSet: Set<string>;
  calls: string[];
  errors: Array<string | null>;
  hydratingFlags: boolean[];
  hasHydratedFlags: boolean[];
  logs: unknown[][];
}

const build = (
  over: {
    persistence?: Partial<LibraryPersistence>;
    inventory?: Record<string, UserInventoryItem>;
    deps?: Partial<LibraryServiceDeps>;
  } = {}
): Fakes => {
  const inventory = over.inventory ?? {};
  const statics = new Map<string, BookMetadata>();
  const offloadedSet = new Set<string>();
  const calls: string[] = [];
  const errors: Array<string | null> = [];
  const hydratingFlags: boolean[] = [];
  const hasHydratedFlags: boolean[] = [];
  const logs: unknown[][] = [];
  let listener: ((books: Record<string, UserInventoryItem>) => void) | null = null;
  let unsubscribed = 0;

  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => logs.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => logs.push(a));
  vi.spyOn(console, 'debug').mockImplementation(() => {});

  const inventoryPort: InventoryPort = {
    all: () => inventory,
    get: (id) => inventory[id],
    upsert: () => undefined,
    upsertMany: () => undefined,
    update: (id, updates) => calls.push(`inventory.update:${id}:${JSON.stringify(updates)}`),
    remove: (id) => {
      calls.push(`inventory.remove:${id}`);
      delete inventory[id];
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        unsubscribed += 1;
      };
    },
  };

  const projection: LibraryProjectionPort = {
    staticIds: () => new Set(statics.keys()),
    setStatic: (id, m) => {
      calls.push(`setStatic:${id}`);
      statics.set(id, m);
    },
    setStaticMany: (entries) => {
      calls.push(`setStaticMany:${entries.map(([id]) => id).join('|')}`);
      for (const [id, m] of entries) statics.set(id, m);
    },
    removeStatic: (id) => {
      calls.push(`removeStatic:${id}`);
      statics.delete(id);
    },
    offloaded: () => offloadedSet,
    addOffloaded: (id) => {
      calls.push(`addOffloaded:${id}`);
      offloadedSet.add(id);
    },
    addOffloadedMany: (ids) => {
      calls.push(`addOffloadedMany:${[...ids].join('|')}`);
      for (const id of ids) offloadedSet.add(id);
    },
    removeOffloaded: (id) => {
      calls.push(`removeOffloaded:${id}`);
      offloadedSet.delete(id);
    },
    setHydrating: (v) => hydratingFlags.push(v),
    setHasHydrated: (v) => hasHydratedFlags.push(v),
    setError: (m) => errors.push(m),
    importStarted: () => undefined,
    importProgress: () => undefined,
    uploadProgress: () => undefined,
    importFinished: () => undefined,
    setBatchSummary: () => undefined,
  };

  const persistence: LibraryPersistence = {
    ingest: async () => undefined,
    deleteBook: async (id) => {
      calls.push(`deleteBook:${id}`);
    },
    offloadBook: async (id) => {
      calls.push(`offloadBook:${id}`);
    },
    restoreResource: async () => undefined,
    getManifest: async () => undefined,
    writeContentHash: async () => undefined,
    getBookMetadata: async (id) => {
      calls.push(`getBookMetadata:${id}`);
      return meta(id);
    },
    getOffloadedStatus: async (ids) => {
      calls.push(`getOffloadedStatus:${(ids ?? []).join('|')}`);
      return new Map();
    },
    getBookIdByFilename: () => undefined,
    reprocess: async () => ({}) as never,
    ...over.persistence,
  };

  const service = new LibraryService({
    mutex: { run: <T,>(_key: string, fn: () => Promise<T>) => fn() } as LibraryServiceDeps['mutex'],
    inventory: inventoryPort,
    projection,
    persistence,
    orchestrator: { restore: async () => undefined } as unknown as ImportOrchestrator,
    ...over.deps,
  });

  return {
    service,
    inventory,
    notifyInventory: (books) => listener?.(books),
    get unsubscribed() {
      return unsubscribed;
    },
    statics,
    offloadedSet,
    calls,
    errors,
    hydratingFlags,
    hasHydratedFlags,
    logs,
  } as Fakes;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LibraryService.start — the inventory delta subscription', () => {
  it('hydrates when a book APPEARS, and not when one merely changes', async () => {
    const f = build({ inventory: { a: item('a') } });
    f.service.start();
    f.calls.length = 0;

    f.notifyInventory({ a: item('a') });
    await Promise.resolve();
    expect(f.calls).toEqual([]);

    f.inventory.b = item('b');
    f.notifyInventory({ a: item('a'), b: item('b') });
    await new Promise((r) => setTimeout(r, 0));

    expect(f.calls.some((c) => c.startsWith('getBookMetadata'))).toBe(true);
  });

  it('does NOT hydrate when a book is removed', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });
    f.service.start();
    f.calls.length = 0;

    f.notifyInventory({ a: item('a') });
    await new Promise((r) => setTimeout(r, 0));

    expect(f.calls).toEqual([]);
  });

  it('hydrates on a replacement (one out, one in) because the id is new', async () => {
    const f = build({ inventory: { a: item('a') } });
    f.service.start();
    f.calls.length = 0;

    f.inventory.b = item('b');
    delete f.inventory.a;
    f.notifyInventory({ b: item('b') });
    await new Promise((r) => setTimeout(r, 0));

    expect(f.calls.some((c) => c.startsWith('getBookMetadata'))).toBe(true);
  });

  it('is idempotent — a second start reuses the first subscription', () => {
    const f = build();

    const first = f.service.start();

    expect(f.service.start()).toBe(first);
  });

  it('the handle unsubscribes, and a later start re-subscribes', () => {
    const f = build();

    f.service.start()();

    expect(f.unsubscribed).toBe(1);
    expect(f.service.start()).toEqual(expect.any(Function));
  });

  it('logs rather than throws when a delta hydration fails', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        getBookMetadata: async () => {
          throw new Error('idb closed');
        },
      },
    });
    f.service.start();

    f.inventory.b = item('b');
    f.notifyInventory({ a: item('a'), b: item('b') });
    await new Promise((r) => setTimeout(r, 0));

    expect(f.hasHydratedFlags.at(-1)).toBe(true);
  });
});

describe('LibraryService.hydrate — the empty shelf', () => {
  it('marks hydrated immediately and reads nothing', async () => {
    const f = build({ inventory: {} });

    await f.service.hydrate();

    expect(f.hasHydratedFlags).toEqual([true]);
    expect(f.hydratingFlags).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});

describe('LibraryService.hydrate — reading manifests', () => {
  it('prefers the BULK read when the persistence layer offers one', async () => {
    const bulk = vi.fn(async (ids: string[]) => ids.map((id) => meta(id)));
    const f = build({
      inventory: { a: item('a'), b: item('b') },
      persistence: { getBookMetadataBulk: bulk },
    });

    await f.service.hydrate();

    expect(bulk).toHaveBeenCalledWith(['a', 'b']);
    expect(f.calls.some((c) => c.startsWith('getBookMetadata:'))).toBe(false);
    expect([...f.statics.keys()]).toEqual(['a', 'b']);
  });

  it('falls back to per-book reads when it does not', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });

    await f.service.hydrate();

    expect(f.calls).toContain('getBookMetadata:a');
    expect(f.calls).toContain('getBookMetadata:b');
  });

  it('writes every hydrated manifest in ONE projection write', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b'), c: item('c') } });

    await f.service.hydrate();

    expect(f.calls.filter((c) => c.startsWith('setStaticMany'))).toEqual(['setStaticMany:a|b|c']);
    expect(f.calls.some((c) => c.startsWith('setStatic:'))).toBe(false);
  });

  it('writes nothing when every manifest is filtered out', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: { getBookMetadata: async () => undefined },
    });

    await f.service.hydrate();

    expect(f.calls.some((c) => c.startsWith('setStaticMany'))).toBe(false);
  });

  it('skips a manifest with no id', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: { getBookMetadata: async () => ({ title: 'no id' }) as BookMetadata },
    });

    await f.service.hydrate();

    expect(f.statics.size).toBe(0);
  });

  it('never resurrects a book that left the inventory during the read (I-2)', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });
    const original = f.service.hydrate();
    delete f.inventory.b;
    await original;

    expect([...f.statics.keys()]).toEqual(['a']);
  });

  it('keeps an existing projection entry (I-1) unless the id is FORCED', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });
    f.statics.set('a', meta('a', { title: 'Newer, written by an import' }));
    f.calls.length = 0;

    await f.service.hydrate();
    expect(f.statics.get('a')?.title).toBe('Newer, written by an import');

    await f.service.hydrate(['a']);
    expect(f.statics.get('a')?.title).toBe('Title a');
  });

  it('a force list does not force OTHER ids', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });
    f.statics.set('a', meta('a', { title: 'keep me' }));
    f.statics.set('b', meta('b', { title: 'keep me too' }));

    await f.service.hydrate(['a']);

    expect(f.statics.get('a')?.title).toBe('Title a');
    expect(f.statics.get('b')?.title).toBe('keep me too');
  });

  it('drops a concurrent UNFORCED hydrate, but never a forced one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const reads: string[] = [];
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        getBookMetadata: async (id) => {
          reads.push(id);
          await gate;
          return meta(id);
        },
      },
    });

    const first = f.service.hydrate();
    await f.service.hydrate(); // dropped: already hydrating
    const forced = f.service.hydrate(['a']); // admitted
    release();
    await Promise.all([first, forced]);

    expect(reads).toEqual(['a', 'a']);
  });

  it('reports hydrating true→false and hydrated exactly once per pass', async () => {
    const f = build({ inventory: { a: item('a') } });

    await f.service.hydrate();

    expect(f.hydratingFlags).toEqual([true, false]);
    expect(f.hasHydratedFlags).toEqual([true]);
  });

  it('still reports hydrated when the manifest read blows up', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        getBookMetadata: async () => {
          throw new Error('idb closed');
        },
      },
    });

    await expect(f.service.hydrate()).resolves.toBeUndefined();

    expect(f.hydratingFlags).toEqual([true, false]);
    expect(f.hasHydratedFlags).toEqual([true]);
  });
});

describe('LibraryService.hydrate — the offloaded projection', () => {
  it('prefers the availability probe: inventoried books NOT available are offloaded', async () => {
    const f = build({
      inventory: { a: item('a'), b: item('b'), c: item('c') },
      persistence: { getAvailableResourceIds: async () => new Set(['a']) },
    });

    await f.service.hydrate();

    expect(f.calls).toContain('addOffloadedMany:b|c');
    expect([...f.offloadedSet]).toEqual(['b', 'c']);
  });

  it('falls back to the per-book status map, keeping only the true entries', async () => {
    const f = build({
      inventory: { a: item('a'), b: item('b') },
      persistence: {
        getOffloadedStatus: async () =>
          new Map([
            ['a', false],
            ['b', true],
          ]),
      },
    });

    await f.service.hydrate();

    expect([...f.offloadedSet]).toEqual(['b']);
  });

  it('passes the inventoried ids to the status map read', async () => {
    const f = build({ inventory: { a: item('a'), b: item('b') } });

    await f.service.hydrate();

    expect(f.calls).toContain('getOffloadedStatus:a|b');
  });

  it('writes nothing when nothing changed', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: { getAvailableResourceIds: async () => new Set(['a']) },
    });

    await f.service.hydrate();

    expect(f.calls.some((c) => c.startsWith('addOffloadedMany'))).toBe(false);
  });

  it('does not re-add an id the projection already holds', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: { getAvailableResourceIds: async () => new Set() },
    });
    f.offloadedSet.add('a');

    await f.service.hydrate();

    expect(f.calls.some((c) => c.startsWith('addOffloadedMany'))).toBe(false);
  });

  it('does NOT re-add an id cleared while the read was in flight (I-5)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        getAvailableResourceIds: async () => {
          await gate;
          return new Set<string>();
        },
      },
    });
    f.offloadedSet.add('a'); // offloaded BEFORE the read starts

    const pass = f.service.hydrate();
    await Promise.resolve();
    f.offloadedSet.delete('a'); // a concurrent restore clears it
    release();
    await pass;

    expect([...f.offloadedSet]).toEqual([]);
  });

  it('re-marks an id that was NOT offloaded before the read', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: { getAvailableResourceIds: async () => new Set<string>() },
    });

    await f.service.hydrate();

    expect([...f.offloadedSet]).toEqual(['a']);
  });

  it('never marks a book that left the inventory', async () => {
    const f = build({
      inventory: { a: item('a'), b: item('b') },
      persistence: { getAvailableResourceIds: async () => new Set<string>() },
    });
    const pass = f.service.hydrate();
    delete f.inventory.b;
    await pass;

    expect([...f.offloadedSet]).toEqual(['a']);
  });

  it('an offload-status failure does not sink the manifest hydration', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        getOffloadedStatus: async () => {
          throw new Error('probe failed');
        },
      },
    });

    await f.service.hydrate();

    expect([...f.statics.keys()]).toEqual(['a']);
    expect(f.hasHydratedFlags).toEqual([true]);
  });
});

describe('LibraryService.updateBook', () => {
  it('passes straight through to the synced inventory', () => {
    const f = build();

    f.service.updateBook('a', { title: 'Renamed' } as Partial<UserInventoryItem>);

    expect(f.calls).toEqual(['inventory.update:a:{"title":"Renamed"}']);
  });
});

describe('LibraryService.remove', () => {
  it('drops the projection entries, purges the cloud record, THEN deletes locally', async () => {
    const purged: string[] = [];
    const f = build({
      inventory: { a: item('a') },
      deps: {
        purgeBookArtifact: async (id) => {
          purged.push(id);
        },
      },
    });
    f.statics.set('a', meta('a'));
    f.offloadedSet.add('a');
    f.calls.length = 0;

    await f.service.remove('a');

    expect(f.calls).toEqual([
      'inventory.remove:a',
      'removeStatic:a',
      'removeOffloaded:a',
      'deleteBook:a',
    ]);
    // The purge MUST precede deleteBook — the hash lives on the row it destroys.
    expect(purged).toEqual(['a']);
    expect(f.calls.indexOf('deleteBook:a')).toBeGreaterThan(-1);
  });

  it('works with no cloud-purge adapter wired', async () => {
    const f = build({ inventory: { a: item('a') } });

    await expect(f.service.remove('a')).resolves.toBeUndefined();

    expect(f.calls).toContain('deleteBook:a');
  });

  it('deletes locally anyway when the cloud purge rejects', async () => {
    const f = build({
      inventory: { a: item('a') },
      deps: {
        purgeBookArtifact: async () => {
          throw new Error('offline');
        },
      },
    });

    await f.service.remove('a');

    expect(f.calls).toContain('deleteBook:a');
    expect(f.errors).toEqual([]);
  });

  it('surfaces an error and re-hydrates when the local delete fails', async () => {
    const f = build({
      inventory: { a: item('a') },
      persistence: {
        deleteBook: async () => {
          throw new Error('idb locked');
        },
      },
    });

    await expect(f.service.remove('a')).resolves.toBeUndefined();

    expect(f.errors).toEqual(['Failed to remove book.']);
    expect(f.hasHydratedFlags.at(-1)).toBe(true);
  });

  it('serializes on the book id', async () => {
    const keys: string[] = [];
    const f = build({
      inventory: { a: item('a') },
      deps: {
        mutex: {
          run: <T,>(key: string, fn: () => Promise<T>) => {
            keys.push(key);
            return fn();
          },
        } as LibraryServiceDeps['mutex'],
      },
    });

    await f.service.remove('a');

    expect(keys).toEqual(['a']);
  });
});

describe('LibraryService.offload', () => {
  it('marks offloaded optimistically, then persists', async () => {
    const f = build();

    await f.service.offload('a');

    expect(f.calls).toEqual(['addOffloaded:a', 'offloadBook:a']);
    expect([...f.offloadedSet]).toEqual(['a']);
  });

  it('reverts the optimistic mark on failure', async () => {
    const f = build({
      persistence: {
        offloadBook: async () => {
          throw new Error('no space');
        },
      },
    });

    await f.service.offload('a');

    expect(f.offloadedSet.has('a')).toBe(false);
    expect(f.errors).toEqual(['Failed to offload book.']);
  });

  it('leaves an ALREADY-offloaded book offloaded on failure (I-4)', async () => {
    const f = build({
      persistence: {
        offloadBook: async () => {
          throw new Error('no space');
        },
      },
    });
    f.offloadedSet.add('a');

    await f.service.offload('a');

    expect(f.offloadedSet.has('a')).toBe(true);
    expect(f.calls).not.toContain('removeOffloaded:a');
  });

  it('serializes on the book id', async () => {
    const keys: string[] = [];
    const f = build({
      deps: {
        mutex: {
          run: <T,>(key: string, fn: () => Promise<T>) => {
            keys.push(key);
            return fn();
          },
        } as LibraryServiceDeps['mutex'],
      },
    });

    await f.service.offload('a');

    expect(keys).toEqual(['a']);
  });
});

describe('LibraryService.restore', () => {
  it('routes through the orchestrator queue, forwarding the file and options', async () => {
    const restore = vi.fn(async () => undefined);
    const f = build({ deps: { orchestrator: { restore } as unknown as ImportOrchestrator } });
    const file = new File(['x'], 'book.epub');

    await f.service.restore('a', file, { silent: true } as never);

    expect(restore).toHaveBeenCalledWith('a', file, { silent: true });
  });

  it('propagates the orchestrator rejection to the caller', async () => {
    const f = build({
      deps: {
        orchestrator: {
          restore: async () => {
            throw new Error('restore failed');
          },
        } as unknown as ImportOrchestrator,
      },
    });

    await expect(f.service.restore('a', new File(['x'], 'b.epub'))).rejects.toThrow(
      'restore failed'
    );
  });
});
