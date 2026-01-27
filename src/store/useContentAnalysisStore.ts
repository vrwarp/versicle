import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { ContentType } from '../types/content-analysis';

/**
 * A content classification entry (CFI -> type).
 */
export interface ContentClassification {
    rootCfi: string;
    type: ContentType;
}

/**
 * A table adaptation entry (CFI -> spoken text).
 */
export interface TableAdaptation {
    rootCfi: string;
    text: string;
}

/**
 * Analysis data for a single section.
 */
export interface SectionAnalysis {
    /** Detected content types (footnote, table, etc). */
    semanticMap?: ContentClassification[];
    /** AI-generated spoken text for tables. */
    tableAdaptations?: TableAdaptation[];
    /** Section title extracted via AI. */
    title?: string;
    /** Generation timestamp. */
    generatedAt: number;
}

/**
 * State interface for the Content Analysis store (Synced).
 *
 * This store handles AI-generated content analysis that is expensive to regenerate.
 * It is wrapped with yjs() middleware to sync across devices.
 *
 * Key structure: `${bookId}/${sectionId}` -> SectionAnalysis
 */
interface ContentAnalysisState {
    // === SYNCED STATE (persisted to Yjs) ===
    /**
     * Map of section analysis data.
     * Key: `${bookId}/${sectionId}` (using / to allow easy parsing)
     */
    sections: Record<string, SectionAnalysis>;

    // === ACTIONS ===
    /**
     * Saves content classifications for a section.
     */
    saveClassifications: (
        bookId: string,
        sectionId: string,
        classifications: ContentClassification[]
    ) => void;

    /**
     * Saves table adaptations for a section.
     */
    saveTableAdaptations: (
        bookId: string,
        sectionId: string,
        adaptations: TableAdaptation[]
    ) => void;

    /**
     * Saves section title.
     */
    saveSectionTitle: (
        bookId: string,
        sectionId: string,
        title: string
    ) => void;

    /**
     * Gets analysis data for a section, if available.
     */
    getAnalysis: (bookId: string, sectionId: string) => SectionAnalysis | undefined;

    /**
     * Deletes all analysis data for a book.
     */
    deleteBookAnalysis: (bookId: string) => void;

    /**
     * Clears all analysis data.
     */
    clearAll: () => void;
}

/**
 * Generates the composite key for a section.
 */
function makeKey(bookId: string, sectionId: string): string {
    return `${bookId}/${sectionId}`;
}

export const useContentAnalysisStore = create<ContentAnalysisState>()(
    yjs(
        yDoc,
        'contentAnalysis', // Yjs map name
        (set, get) => ({
            sections: {},

            saveClassifications: (bookId, sectionId, classifications) =>
                set((state) => {
                    const key = makeKey(bookId, sectionId);
                    const existing = state.sections[key] || { generatedAt: Date.now() };
                    return {
                        sections: {
                            ...state.sections,
                            [key]: {
                                ...existing,
                                semanticMap: classifications,
                                generatedAt: Date.now()
                            }
                        }
                    };
                }),

            saveTableAdaptations: (bookId, sectionId, adaptations) =>
                set((state) => {
                    const key = makeKey(bookId, sectionId);
                    const existing = state.sections[key] || { generatedAt: Date.now() };

                    // Merge with existing adaptations (de-duplicating by rootCfi)
                    const existingAdaptations = existing.tableAdaptations || [];
                    const existingMap = new Map(existingAdaptations.map(a => [a.rootCfi, a]));

                    // New adaptations overwrite existing ones for same CFI
                    for (const adaptation of adaptations) {
                        existingMap.set(adaptation.rootCfi, adaptation);
                    }

                    return {
                        sections: {
                            ...state.sections,
                            [key]: {
                                ...existing,
                                tableAdaptations: Array.from(existingMap.values()),
                                generatedAt: Date.now()
                            }
                        }
                    };
                }),

            saveSectionTitle: (bookId, sectionId, title) =>
                set((state) => {
                    const key = makeKey(bookId, sectionId);
                    const existing = state.sections[key] || { generatedAt: Date.now() };
                    return {
                        sections: {
                            ...state.sections,
                            [key]: {
                                ...existing,
                                title,
                                generatedAt: Date.now()
                            }
                        }
                    };
                }),

            getAnalysis: (bookId, sectionId) => {
                const key = makeKey(bookId, sectionId);
                return get().sections[key];
            },

            deleteBookAnalysis: (bookId) =>
                set((state) => {
                    const prefix = `${bookId}/`;
                    const remaining: Record<string, SectionAnalysis> = {};

                    for (const [key, value] of Object.entries(state.sections)) {
                        if (!key.startsWith(prefix)) {
                            remaining[key] = value;
                        }
                    }

                    return { sections: remaining };
                }),

            clearAll: () => set({ sections: {} })
        })
    )
);
