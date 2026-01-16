import { z } from 'zod';

// --- Shared Types (Mirrors src/types/db.ts) ---

export const UserInventoryItemSchema = z.object({
    bookId: z.string(),
    title: z.string(),
    author: z.string(),
    addedAt: z.number(),
    lastInteraction: z.number(),
    sourceFilename: z.string().optional(),
    tags: z.array(z.string()),
    rating: z.number().min(0).max(5).optional(),
    status: z.enum(['unread', 'reading', 'completed', 'abandoned']),
    customTitle: z.string().optional(),
    customAuthor: z.string().optional(),
    coverPalette: z.array(z.number().int().min(0).max(65535)).length(4).optional(),
});

export const ReadingListEntrySchema = z.object({
    filename: z.string(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().optional(),
    percentage: z.number(),
    lastUpdated: z.number(),
    status: z.enum(['read', 'currently-reading', 'to-read']).optional(),
    rating: z.number().optional(),
});

export const UserProgressSchema = z.object({
    bookId: z.string(),
    percentage: z.number().min(0).max(1),
    currentCfi: z.string().optional(),
    lastPlayedCfi: z.string().optional(),
    currentQueueIndex: z.number().optional(),
    currentSectionIndex: z.number().optional(),
    lastRead: z.number(),
    completedRanges: z.array(z.string()),
});

export const UserAnnotationSchema = z.object({
    id: z.string(),
    bookId: z.string(),
    cfiRange: z.string(),
    text: z.string(),
    type: z.enum(['highlight', 'note']),
    color: z.string(),
    note: z.string().optional(),
    created: z.number(),
});

export const UserOverridesSchema = z.object({
    bookId: z.string(),
    lexicon: z.array(z.object({
        id: z.string(),
        original: z.string(),
        replacement: z.string(),
        isRegex: z.boolean().optional(),
        applyBeforeGlobal: z.boolean().optional(),
        created: z.number(),
    })),
    lexiconConfig: z.object({
        applyBefore: z.boolean(),
    }).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
});

// --- Validation Helper ---

export const validateYjsUpdate = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
    return schema.parse(data);
};
