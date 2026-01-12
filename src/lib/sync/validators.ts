import { z } from 'zod';

// --- Shared Types (Mirrors src/types/db.ts) ---

export const UserInventoryItemSchema = z.object({
    bookId: z.string(),
    title: z.string(),
    author: z.string().optional(),
    coverUrl: z.string().optional(), // For ghost books
    addedAt: z.number(),
    lastOpenedAt: z.number().optional(),
    isFavorite: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    rating: z.number().min(0).max(5).optional(),
});

export const ReadingListEntrySchema = z.object({
    filename: z.string(),
    bookId: z.string().optional(),
    addedAt: z.number(),
});

export const UserProgressSchema = z.object({
    bookId: z.string(),
    cfi: z.string(),
    percentage: z.number().min(0).max(100),
    chapterTitle: z.string().optional(),
    lastUpdated: z.number(),
    device: z.string().optional(), // Setup for multi-device sync
});

export const UserAnnotationSchema = z.object({
    id: z.string(),
    bookId: z.string(),
    cfiRange: z.string(),
    text: z.string(),
    color: z.string().optional(),
    note: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number().optional(),
});

export const UserOverridesSchema = z.object({
    bookId: z.string(),
    // Allow flexible key-value pairs for overrides
    settings: z.record(z.string(), z.any()),
});

// --- Validation Helper ---

export const validateYjsUpdate = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
    return schema.parse(data);
};
