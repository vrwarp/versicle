/**
 * Typed factory doubles for the highest-leverage service seams.
 *
 * Replaces the per-file `vi.mock('../db/DBService', …)` pattern (36+ copies,
 * each with a slightly different hand-rolled shape that nothing typechecks).
 * These factories are typed against the REAL service types, so a service
 * signature change breaks the double at compile time instead of letting
 * stale mocks keep passing.
 *
 * Prefer real DI seams over module mocking where they exist
 * (`createLibraryStore(db)`, `AudioPlayerService.createWithContext(…)`);
 * these doubles are what you inject into them.
 */
import type { dbService } from '@db/DBService';
import type { IDBService } from '@store/useLibraryStore';

/**
 * The public surface of a class instance type. `keyof` only sees public
 * members, and re-mapping strips the class's nominal (private-member)
 * identity so plain object literals can satisfy `Partial<PublicOf<T>>`.
 */
export type PublicOf<T> = { [K in keyof T]: T[K] };

export type DbServiceShape = PublicOf<typeof dbService>;

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
 * Typed double for the `dbService` singleton (`src/db/DBService.ts`).
 *
 * Every unstubbed method throws when called — a test can only depend on
 * behavior it explicitly declared. Overrides are typechecked against the
 * real `dbService` instance type.
 */
export function makeDbServiceDouble(overrides: Partial<DbServiceShape> = {}): DbServiceShape {
  return makeLoudDouble<DbServiceShape>('DbService', overrides);
}

const unstubbed =
  (name: string) =>
  (): never => {
    throw new Error(`[test-harness] libraryDb.${name}() was called but not stubbed.`);
  };

/**
 * Typed double for the `IDBService` seam injected into
 * `createLibraryStore(db)` (`src/store/useLibraryStore.ts`).
 *
 * Required methods default to loud throwers; the OPTIONAL fast-path methods
 * (`getBookMetadataBulk`, `getAvailableResourceIds`) stay `undefined` unless
 * overridden, so the store exercises the same fallback paths it would with a
 * minimal real backend.
 */
export function makeLibraryDbDouble(overrides: Partial<IDBService> = {}): IDBService {
  return {
    addBook: unstubbed('addBook'),
    importBookWithId: unstubbed('importBookWithId'),
    deleteBook: unstubbed('deleteBook'),
    offloadBook: unstubbed('offloadBook'),
    restoreBook: unstubbed('restoreBook'),
    getBookMetadata: unstubbed('getBookMetadata'),
    getOffloadedStatus: unstubbed('getOffloadedStatus'),
    getBookIdByFilename: unstubbed('getBookIdByFilename'),
    ...overrides,
  };
}
