import { describe, it, expect, beforeEach } from 'vitest';
import { useReadingListStore } from './useReadingListStore';
import { yDoc } from './yjs-provider';
import type { ReadingListEntry } from '../types/db';

describe('useReadingListStore', () => {
    beforeEach(() => {
        // Clear Yjs map
        yDoc.getMap('reading_list').clear();
        useReadingListStore.setState({ entries: {} });
    });

    it('should upsert reading list entries', () => {
        const store = useReadingListStore.getState();
        const entry: ReadingListEntry = {
            filename: 'test.epub',
            title: 'Test Title',
            author: 'Test Author',
            percentage: 0.5,
            lastUpdated: 100,
            status: 'currently-reading',
            rating: 4
        };

        store.upsertEntry(entry);

        const updatedStore = useReadingListStore.getState();
        expect(updatedStore.entries['test.epub']).toEqual(entry);
    });

    it('should upsert reading list entries (existing update)', () => {
        const store = useReadingListStore.getState();
        const entry: ReadingListEntry = {
            filename: 'test.epub',
            title: 'Test Title',
            author: 'Test Author',
            percentage: 0.5,
            lastUpdated: 100,
            status: 'currently-reading'
        };

        store.upsertEntry(entry);

        // Update
        store.upsertEntry({ ...entry, percentage: 0.8 });

        const updatedStore = useReadingListStore.getState();
        expect(updatedStore.entries['test.epub'].percentage).toBe(0.8);
    });

    it('should remove reading list entries', () => {
        const store = useReadingListStore.getState();
        const entry: ReadingListEntry = {
            filename: 'remove.epub',
            title: 'Remove',
            author: 'Me',
            percentage: 0,
            lastUpdated: 100,
            status: 'to-read'
        };

        store.upsertEntry(entry);
        expect(useReadingListStore.getState().entries['remove.epub']).toBeDefined();

        store.removeEntry('remove.epub');
        expect(useReadingListStore.getState().entries['remove.epub']).toBeUndefined();
    });
});
