/**
 * LibraryService — owner of the delete/offload/restore/hydrate workflows
 * (Phase 7 §C). Carries the five lifted invariants:
 *
 *   I-1 hydrate is a per-key merge (a book written after hydrate's read
 *       snapshot is never clobbered);
 *   I-2 hydration never resurrects (keys absent from inventory at write
 *       time are dropped);
 *   I-3 restore re-validates existence inside the mutexed register step
 *       (delete(X)/restore(X) serialize on X — via the orchestrator);
 *   I-4 failure paths restore the CAPTURED prior state (offloaded stays
 *       offloaded);
 *   I-5 the offloaded set is updated per-key (structural: the projection
 *       port has no wholesale setter).
 *
 * The suite that proves them is LibraryService.invariants.test.ts — written
 * at the phase entry gate against the legacy store, swapped to this service
 * at the PR-L4 cutover with its assertions unchanged.
 */
import { createLogger } from '@lib/logger';
import type { UserInventoryItem } from '~types/user-data';
import type { KeyedMutex } from './mutex';
import type { InventoryPort, LibraryProjectionPort, LibraryPersistence } from './ports';
import type { ImportOrchestrator } from './import/ImportOrchestrator';

const logger = createLogger('LibraryService');

export interface LibraryServiceDeps {
  mutex: KeyedMutex;
  inventory: InventoryPort;
  projection: LibraryProjectionPort;
  persistence: LibraryPersistence;
  orchestrator: ImportOrchestrator;
  /**
   * Best-effort per-book cloud-artifact GC (Artifact Lane Phase D, §2.7): an
   * injected APP-LAYER port that drops THIS device's `embedCache/{key}` HEAD
   * doc for a removed book (the content-addressed shared blob is deliberately
   * left for the cloud sweeper — a sibling device may still need it). The
   * adapter (createLibrary.ts) resolves contentHash + derives the key + calls
   * the backend, so LibraryService stays store/backend-free (domains-no-store).
   *
   * MUST run BEFORE `persistence.deleteBook` so the manifest row carrying the
   * contentHash is still present (it dies in deleteBook's tx). A rejection is
   * logged but NEVER aborts the local delete (best-effort degrade — the
   * orphaned HEAD doc is reclaimed by the sweeper's TTL). Undefined when no
   * adapter is wired (a null backend / pre-P7 book is a clean no-op there).
   */
  purgeBookArtifact?(bookId: string): Promise<void>;
}

export class LibraryService {
  private hydrating = false;
  private unsubscribeInventory: (() => void) | null = null;
  private knownBookIds = new Set<string>();

  constructor(private readonly deps: LibraryServiceDeps) {}

  /**
   * Subscribe to inventory deltas: new books trigger a hydration pass
   * (finishes D16 — replaces BOTH the boot-task call-through and
   * LibraryView's prevBookCountRef heuristic). Returns an unsubscribe.
   */
  start(): () => void {
    if (this.unsubscribeInventory) return this.unsubscribeInventory;

    this.knownBookIds = new Set(Object.keys(this.deps.inventory.all()));
    const unsubscribe = this.deps.inventory.subscribe((books) => {
      const ids = Object.keys(books);
      const hasNew = ids.some((id) => !this.knownBookIds.has(id));
      this.knownBookIds = new Set(ids);
      if (hasNew) {
        void this.hydrate().catch((e) => logger.error('Delta hydration failed:', e));
      }
    });
    this.unsubscribeInventory = () => {
      unsubscribe();
      this.unsubscribeInventory = null;
    };
    return this.unsubscribeInventory;
  }

  /**
   * Hydrate the static-metadata/offloaded projection from IDB for every
   * inventoried book. Per-key merge + never-resurrect + per-key offload
   * deltas (I-1, I-2, I-5).
   */
  async hydrate(forceBookIds?: string[]): Promise<void> {
    const { inventory, projection, persistence } = this.deps;
    const bookIds = Object.keys(inventory.all());
    logger.debug(`Hydrate called. Books in store: ${bookIds.length}`);

    if (bookIds.length === 0) {
      projection.setHasHydrated(true);
      return;
    }
    if (this.hydrating && !forceBookIds) return;

    this.hydrating = true;
    projection.setHydrating(true);
    try {
      // Capture the offloaded snapshot BEFORE any async work to detect
      // concurrent removals during the DB read (I-5).
      const offloadedBefore = new Set(projection.offloaded());

      let manifests: (Awaited<ReturnType<LibraryPersistence['getBookMetadata']>>)[];
      if (persistence.getBookMetadataBulk) {
        manifests = await persistence.getBookMetadataBulk(bookIds);
      } else {
        manifests = await Promise.all(bookIds.map((id) => persistence.getBookMetadata(id)));
      }

      const force = new Set(forceBookIds ?? []);
      const staticIds = projection.staticIds();
      for (const manifest of manifests) {
        if (!manifest || !manifest.id) continue;
        // I-2: never resurrect — inventory presence checked at WRITE time.
        if (!inventory.get(manifest.id)) continue;
        // I-1: per-key merge — existing (possibly newer) entries are kept
        // unless this id was explicitly forced.
        if (staticIds.has(manifest.id) && !force.has(manifest.id)) continue;
        projection.setStatic(manifest.id, manifest);
      }

      // Offloaded status — per-key deltas only (I-5).
      try {
        const offloadedNow = new Set<string>();
        if (persistence.getAvailableResourceIds) {
          const available = await persistence.getAvailableResourceIds();
          for (const id of bookIds) {
            if (!available.has(id)) offloadedNow.add(id);
          }
        } else {
          const map = await persistence.getOffloadedStatus(bookIds);
          map.forEach((isOffloaded, id) => {
            if (isOffloaded) offloadedNow.add(id);
          });
        }

        const current = projection.offloaded();
        for (const id of offloadedNow) {
          // Concurrently cleared while the DB read was pending (e.g. a
          // restore) → do NOT re-add from the stale snapshot.
          if (offloadedBefore.has(id) && !current.has(id)) continue;
          // I-2 sibling: never mark books that left the inventory.
          if (!inventory.get(id)) continue;
          if (!current.has(id)) projection.addOffloaded(id);
        }
      } catch (e) {
        logger.error('Failed to hydrate offload status:', e);
      }
    } catch (err) {
      logger.error('Failed to hydrate static metadata:', err);
    } finally {
      this.hydrating = false;
      projection.setHydrating(false);
      projection.setHasHydrated(true);
    }
  }

  /** Update user-editable inventory fields (pass-through to the synced store). */
  updateBook(bookId: string, updates: Partial<UserInventoryItem>): void {
    this.deps.inventory.update(bookId, updates);
  }

  /** Remove a book and its local data. Serializes with restore/import on the same id. */
  async remove(bookId: string): Promise<void> {
    const { inventory, projection, persistence } = this.deps;
    try {
      await this.deps.mutex.run(bookId, async () => {
        inventory.remove(bookId);
        projection.removeStatic(bookId);
        projection.removeOffloaded(bookId);
        // Best-effort cloud-artifact GC (Phase D): the adapter resolves
        // contentHash from the manifest, so this MUST run BEFORE deleteBook (the
        // manifest row dies in that tx). A failure is logged but NEVER aborts
        // the local delete — the orphaned HEAD doc is reclaimed by the sweeper.
        if (this.deps.purgeBookArtifact) {
          try {
            await this.deps.purgeBookArtifact(bookId);
          } catch (err) {
            logger.warn('Best-effort cloud-artifact purge failed; deleting locally anyway:', err);
          }
        }
        await persistence.deleteBook(bookId);
      });
    } catch (err) {
      logger.error('Failed to remove book:', err);
      projection.setError('Failed to remove book.');
      await this.hydrate();
    }
  }

  /** Offload the binary, keeping metadata. I-4: failure restores the CAPTURED prior state. */
  async offload(bookId: string): Promise<void> {
    const { projection, persistence } = this.deps;
    await this.deps.mutex.run(bookId, async () => {
      const wasAlreadyOffloaded = projection.offloaded().has(bookId);
      projection.addOffloaded(bookId); // optimistic
      try {
        await persistence.offloadBook(bookId);
      } catch (err) {
        logger.error('Failed to offload book:', err);
        projection.setError('Failed to offload book.');
        if (!wasAlreadyOffloaded) projection.removeOffloaded(bookId);
      }
    });
  }

  /**
   * Restore the binary (or download a synced book). Routed through the
   * orchestrator queue, so it serializes with delete on the same id (I-3);
   * failures reject AND surface via the projection's error field.
   */
  restore(bookId: string, file: File): Promise<void> {
    return this.deps.orchestrator.restore(bookId, file);
  }
}
