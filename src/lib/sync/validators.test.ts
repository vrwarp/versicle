import { describe, it, expect } from 'vitest';
import { UserInventoryItemSchema, validateYjsUpdate } from './validators';

describe('Yjs Validators', () => {
    it('should validate a correct UserInventoryItem', () => {
        const validItem = {
            bookId: '123',
            title: 'Moby Dick',
            author: 'Herman Melville',
            addedAt: Date.now(),
            lastInteraction: Date.now(),
            status: 'unread',
            sourceFilename: 'test.epub',
            tags: ['classic', 'sea'],
            rating: 5
        };

        const result = validateYjsUpdate(UserInventoryItemSchema, validItem);
        expect(result).toEqual(validItem);
    });

    it('should throw on missing required fields', () => {
        const invalidItem = {
            title: 'No ID Book'
        };

        expect(() => validateYjsUpdate(UserInventoryItemSchema, invalidItem)).toThrow();
    });

    it('should throw on invalid types', () => {
        const invalidItem = {
            bookId: '123',
            title: 'Bad Rating',
            addedAt: Date.now(),
            rating: 10 // Max is 5
        };

        expect(() => validateYjsUpdate(UserInventoryItemSchema, invalidItem)).toThrow();
    });
});
