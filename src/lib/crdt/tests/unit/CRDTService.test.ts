import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CRDTService } from '../CRDTService';
import * as Y from 'yjs';
import 'fake-indexeddb/auto'; // Automatically mock IndexedDB

// Helper to wait for event loop
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CRDTService', () => {
  let serviceA: CRDTService;
  let serviceB: CRDTService;

  beforeEach(async () => {
    // We use different persistence names to simulate different devices
    // sharing "nothing" initially, or we can use the same name to test persistence.
    // For "sync" tests, we want independent docs that we sync manually.

    // Note: In fake-indexeddb, the databases are global to the process unless cleared.
    // We should clear them or use unique names.
    const dbNameA = `test-db-A-${Math.random()}`;
    const dbNameB = `test-db-B-${Math.random()}`;

    serviceA = new CRDTService(dbNameA);
    serviceB = new CRDTService(dbNameB);

    await serviceA.waitForReady();
    await serviceB.waitForReady();
  });

  afterEach(() => {
    serviceA.destroy();
    serviceB.destroy();
  });

  it('should initialize and be ready', async () => {
    expect(serviceA.isReady).toBe(true);
    expect(serviceA.books).toBeInstanceOf(Y.AbstractType); // Y.Map is a Y.AbstractType
  });

  it('should support concurrent metadata updates (Convergence)', async () => {
    // Setup initial state
    const bookId = 'book-123';

    // device A adds a book
    const bookMapA = new Y.Map();
    bookMapA.set('title', 'Original Title');
    serviceA.books.set(bookId, bookMapA);

    // Apply A -> B
    serviceB.applyUpdate(serviceA.getUpdate());

    // Verify B has it
    expect(serviceB.books.get(bookId)?.get('title')).toBe('Original Title');

    // Concurrent updates
    // A updates Title
    serviceA.books.get(bookId)?.set('title', 'New Title by A');

    // B updates Progress
    serviceB.books.get(bookId)?.set('progress', 0.5);

    // Sync: A -> B and B -> A
    const updateA = serviceA.getUpdate();
    const updateB = serviceB.getUpdate();

    serviceB.applyUpdate(updateA);
    serviceA.applyUpdate(updateB);

    // Verify convergence
    const bookA = serviceA.books.get(bookId);
    const bookB = serviceB.books.get(bookId);

    expect(bookA?.get('title')).toBe('New Title by A');
    expect(bookA?.get('progress')).toBe(0.5);

    expect(bookB?.get('title')).toBe('New Title by A');
    expect(bookB?.get('progress')).toBe(0.5);
  });

  it('should accumulate CFI ranges (History)', async () => {
    const bookId = 'book-history';

    // Initialize history map
    serviceA.history.set(bookId, new Y.Array());
    serviceB.applyUpdate(serviceA.getUpdate());

    // Device A adds a range
    const rangeA = 'epubcfi(/6/2!/4/2:0)';
    serviceA.history.get(bookId)?.push([rangeA]);

    // Device B adds a range
    const rangeB = 'epubcfi(/6/6!/4/2:0)';
    serviceB.history.get(bookId)?.push([rangeB]);

    // Sync
    serviceB.applyUpdate(serviceA.getUpdate());
    serviceA.applyUpdate(serviceB.getUpdate());

    // Verify both have both ranges
    const historyA = serviceA.history.get(bookId)?.toArray();
    const historyB = serviceB.history.get(bookId)?.toArray();

    expect(historyA).toContain(rangeA);
    expect(historyA).toContain(rangeB);
    expect(historyA?.length).toBe(2);

    expect(historyB).toEqual(expect.arrayContaining([rangeA, rangeB]));
  });

  it('should persist data to IndexedDB', async () => {
    const dbName = `test-persistence-${Math.random()}`;
    const service1 = new CRDTService(dbName);
    await service1.waitForReady();

    service1.books.set('persist-test', new Y.Map());
    service1.books.get('persist-test')?.set('val', 123);

    // Wait for IDB write (y-indexeddb usually writes on update,
    // but give it a tick)
    await flushPromises();

    service1.destroy();

    // Re-open same DB
    const service2 = new CRDTService(dbName);
    await service2.waitForReady();

    expect(service2.books.has('persist-test')).toBe(true);
    expect(service2.books.get('persist-test')?.get('val')).toBe(123);

    service2.destroy();
  });
});
