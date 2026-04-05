import { describe, it } from 'vitest';
import { getDB } from '../db/db';
import { v4 as uuidv4 } from 'uuid';

describe('Ingestion Performance', () => {
    it('benchmarks sequential vs parallel IDB operations', async () => {
        const db = await getDB();
        const bookId = uuidv4();
        const batchCount = 200;
        const batches = Array.from({ length: batchCount }, (_, i) => ({
            id: `${bookId}-batch-${i}`,
            bookId,
            sectionId: `section-${i}`,
            sentences: [{ text: 'Some text', cfi: 'cfi' }]
        }));

        // Warm up
        const warmupTx = db.transaction('cache_tts_preparation', 'readwrite');
        await Promise.all(batches.slice(0, 10).map(b => warmupTx.objectStore('cache_tts_preparation').put(b)));
        await warmupTx.done;

        // --- Sequential Put ---
        const tx1 = db.transaction('cache_tts_preparation', 'readwrite');
        const store1 = tx1.objectStore('cache_tts_preparation');
        const startPutSeq = performance.now();
        for (const batch of batches) {
            await store1.put(batch);
        }
        await tx1.done;
        const endPutSeq = performance.now();
        console.log(`Sequential Put (${batchCount} batches): ${(endPutSeq - startPutSeq).toFixed(4)}ms`);

        // --- Sequential Delete ---
        const tx2 = db.transaction('cache_tts_preparation', 'readwrite');
        const store2 = tx2.objectStore('cache_tts_preparation');
        const prepIndex = store2.index('by_bookId');
        const keys = await prepIndex.getAllKeys(bookId);
        const startDelSeq = performance.now();
        for (const key of keys) {
            await store2.delete(key);
        }
        await tx2.done;
        const endDelSeq = performance.now();
        console.log(`Sequential Delete (${keys.length} keys): ${(endDelSeq - startDelSeq).toFixed(4)}ms`);

        // Refill for parallel test
        const tx3 = db.transaction('cache_tts_preparation', 'readwrite');
        const store3 = tx3.objectStore('cache_tts_preparation');
        for (const batch of batches) {
            await store3.put(batch);
        }
        await tx3.done;

        // --- Parallel Put ---
        const tx4 = db.transaction('cache_tts_preparation', 'readwrite');
        const store4 = tx4.objectStore('cache_tts_preparation');
        const startPutPar = performance.now();
        await Promise.all(batches.map(batch => store4.put(batch)));
        await tx4.done;
        const endPutPar = performance.now();
        console.log(`Parallel Put (${batchCount} batches): ${(endPutPar - startPutPar).toFixed(4)}ms`);

        // --- Parallel Delete ---
        const tx5 = db.transaction('cache_tts_preparation', 'readwrite');
        const store5 = tx5.objectStore('cache_tts_preparation');
        const prepIndex2 = store5.index('by_bookId');
        const keys2 = await prepIndex2.getAllKeys(bookId);
        const startDelPar = performance.now();
        await Promise.all(keys2.map(key => store5.delete(key)));
        await tx5.done;
        const endDelPar = performance.now();
        console.log(`Parallel Delete (${keys2.length} keys): ${(endDelPar - startDelPar).toFixed(4)}ms`);
    });
});
