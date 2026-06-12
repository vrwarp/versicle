/**
 * Typed factory doubles for the highest-leverage service seams.
 *
 * Replaces the per-file repo-mock factory pattern (36+ copies,
 * each with a slightly different hand-rolled shape that nothing typechecks).
 * These factories are typed against the REAL service types, so a service
 * signature change breaks the double at compile time instead of letting
 * stale mocks keep passing.
 *
 * Prefer real DI seams over module mocking where they exist
 * (`createLibraryStore(db)`, `AudioPlayerService.createWithContext(…)`);
 * these doubles are what you inject into them.
 */
import type { bookContent } from '@data/repos/bookContent';
import type { LibraryPersistence } from '@domains/library/ports';

/**
 * The public surface of a class instance type. `keyof` only sees public
 * members, and re-mapping strips the class's nominal (private-member)
 * identity so plain object literals can satisfy `Partial<PublicOf<T>>`.
 */
export type PublicOf<T> = { [K in keyof T]: T[K] };

export type BookContentShape = PublicOf<typeof bookContent>;

/**
 * Loud-failure double: unstubbed members exist (so optional-feature probes
 * like `if (db.someMethod)` behave like the real object) but throw with a
 * clear message when CALLED, instead of silently returning `undefined`.
 */
function makeLoudDouble<T extends object>(name: string, overrides: Partial<T>): T {
  const throwers = new Map<PropertyKey, () => never>();
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      // Keep promise-likeness probes and debug printing inert.
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'constructor') return undefined;
      let thrower = throwers.get(prop);
      if (!thrower) {
        thrower = () => {
          throw new Error(
            `[test-harness] ${name}.${String(prop)}() was called but not stubbed. ` +
              `Pass an implementation in the overrides: make${name}Double({ ${String(prop)}: vi.fn(…) }).`,
          );
        };
        throwers.set(prop, thrower);
      }
      return thrower;
    },
  });
}

/**
 * Typed double for the `bookContent` repo singleton
 * (`src/data/repos/bookContent.ts` — the carve of the deleted DBService).
 *
 * Every unstubbed method throws when called — a test can only depend on
 * behavior it explicitly declared. Overrides are typechecked against the
 * real repo instance type.
 */
export function makeBookContentDouble(overrides: Partial<BookContentShape> = {}): BookContentShape {
  return makeLoudDouble<BookContentShape>('BookContent', overrides);
}

const unstubbed =
  (name: string) =>
  (): never => {
    throw new Error(`[test-harness] libraryPersistence.${name}() was called but not stubbed.`);
  };

/**
 * Typed double for the `LibraryPersistence` seam injected into the
 * ImportOrchestrator/LibraryService (`src/domains/library/ports.ts` —
 * Phase 7 replacement of the deleted `IDBService` store seam).
 *
 * Required methods default to loud throwers; the OPTIONAL fast-path methods
 * (`getBookMetadataBulk`, `getAvailableResourceIds`) stay `undefined` unless
 * overridden, so the service exercises the same fallback paths it would with
 * a minimal real backend.
 */
export function makeLibraryPersistenceDouble(
  overrides: Partial<LibraryPersistence> = {},
): LibraryPersistence {
  return {
    ingest: unstubbed('ingest'),
    deleteBook: unstubbed('deleteBook'),
    offloadBook: unstubbed('offloadBook'),
    restoreResource: unstubbed('restoreResource'),
    getManifest: unstubbed('getManifest'),
    writeContentHash: unstubbed('writeContentHash'),
    getBookMetadata: unstubbed('getBookMetadata'),
    getOffloadedStatus: unstubbed('getOffloadedStatus'),
    getBookIdByFilename: unstubbed('getBookIdByFilename'),
    reprocess: unstubbed('reprocess'),
    ...overrides,
  };
}
