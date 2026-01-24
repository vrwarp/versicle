/**
 * ExportImportService
 *
 * Service for manual JSON export/import of library data.
 * Enables cross-platform data portability as the Cold Path backup mechanism.
 *
 * Architecture:
 * - Export: Collects data from all Yjs stores, serializes to JSON
 * - Import: Parses JSON, validates schema, merges into Yjs via transact
 */

import { yDoc } from '../../store/yjs-provider';
import { useBookStore } from '../../store/useBookStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useLexiconStore } from '../../store/useLexiconStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReadingListStore } from '../../store/useReadingListStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { getDeviceId } from '../device-id';
import { createLogger } from '../logger';
import type {
    SyncManifest,
    UserInventoryItem,
    UserProgress
} from '../../types/db';

const logger = createLogger('ExportImport');

// Current schema version for export format
const EXPORT_SCHEMA_VERSION = 1;

/**
 * Options for export operation
 */
export interface ExportOptions {
    /** Include library books and metadata */
    includeLibrary: boolean;
    /** Include reading progress/locations */
    includeProgress: boolean;
    /** Include highlights and notes */
    includeAnnotations: boolean;
    /** Include app settings (theme, font) */
    includeSettings: boolean;
    /** Include lexicon rules */
    includeLexicon: boolean;
    /** Include reading list entries */
    includeReadingList: boolean;
    /** Pretty-print JSON for readability */
    prettyPrint?: boolean;
}

export type ExportFormat = 'json' | 'html' | 'csv';

/**
 * Result from export operation
 */
export interface ExportResult {
    /** The generated JSON blob */
    blob: Blob;
    /** Suggested filename */
    filename: string;
    /** SHA-256 checksum of the blob */
    checksum: string;
    /** Export statistics */
    stats: {
        booksCount: number;
        annotationsCount: number;
        lexiconRulesCount: number;
    };
}

/**
 * Result from import operation
 */
export interface ImportResult {
    /** Whether import completed successfully */
    success: boolean;
    /** Number of books imported/merged */
    booksImported: number;
    /** Number of annotations imported/merged */
    annotationsImported: number;
    /** Number of lexicon rules imported/merged */
    lexiconRulesImported: number;
    /** List of merge decisions/conflicts logged */
    conflicts: string[];
    /** Any errors encountered */
    errors: string[];
}

/**
 * Validation result for import data
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    schemaVersion?: number;
}

/**
 * Export format wrapper with metadata
 */
interface ExportPayload {
    meta: {
        exporter: string;
        version: string;
        schemaVersion: number;
        timestamp: string;
        deviceId: string;
        checksum?: string;
    };
    data: Partial<SyncManifest>;
}

/**
 * Default export options - include everything
 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    includeLibrary: true,
    includeProgress: true,
    includeAnnotations: true,
    includeSettings: true,
    includeLexicon: true,
    includeReadingList: true,
    prettyPrint: true
};

/**
 * Service for exporting and importing library data as JSON.
 */
export class ExportImportService {
    /**
     * Exports the current library state to a JSON blob.
     */
    static async exportToJSON(options: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<ExportResult> {
        logger.info('Starting export with options:', options);

        const deviceId = getDeviceId();
        const data: Partial<SyncManifest> = {
            version: EXPORT_SCHEMA_VERSION,
            lastUpdated: Date.now(),
            deviceId
        };

        let booksCount = 0;
        let annotationsCount = 0;
        let lexiconRulesCount = 0;

        // Collect library data
        if (options.includeLibrary) {
            const { books } = useBookStore.getState();
            data.books = {};

            for (const [bookId, book] of Object.entries(books)) {
                data.books[bookId] = {
                    metadata: {
                        id: bookId,
                        title: book.title,
                        author: book.author,
                        addedAt: book.addedAt,
                        coverPalette: book.coverPalette,
                        filename: book.sourceFilename
                    },
                    history: {
                        bookId,
                        readRanges: [],
                        sessions: [],
                        lastUpdated: book.lastInteraction || Date.now()
                    },
                    annotations: []
                };
                booksCount++;
            }
        }

        // Collect progress data
        if (options.includeProgress && data.books) {
            const { progress } = useReadingStateStore.getState();

            for (const [bookId, deviceProgress] of Object.entries(progress)) {
                if (data.books[bookId]) {
                    // Flatten per-device progress into history
                    const entries = Object.values(deviceProgress as Record<string, UserProgress>);
                    if (entries.length > 0) {
                        // Take the max progress entry
                        const maxEntry = entries.reduce((max, curr) =>
                            (curr.percentage || 0) > (max.percentage || 0) ? curr : max
                        );
                        data.books[bookId].history = {
                            bookId,
                            readRanges: maxEntry.completedRanges || [],
                            sessions: [],
                            lastUpdated: maxEntry.lastRead || Date.now()
                        };

                        // Add progress to metadata for compat
                        data.books[bookId].metadata = {
                            ...data.books[bookId].metadata,
                            progress: maxEntry.percentage,
                            currentCfi: maxEntry.currentCfi
                        };
                    }
                }
            }
        }

        // Collect annotations
        if (options.includeAnnotations && data.books) {
            const { annotations } = useAnnotationStore.getState();

            for (const annotation of Object.values(annotations)) {
                if (data.books[annotation.bookId]) {
                    data.books[annotation.bookId].annotations.push(annotation);
                    annotationsCount++;
                }
            }
        }

        // Collect lexicon rules
        if (options.includeLexicon) {
            const { rules } = useLexiconStore.getState();
            data.lexicon = Object.values(rules);
            lexiconRulesCount = data.lexicon.length;
        }

        // Collect reading list
        if (options.includeReadingList) {
            const { entries } = useReadingListStore.getState();
            data.readingList = entries;
        }

        // Collect transient state (TTS positions)
        data.transientState = {
            ttsPositions: {}
        };

        // Collect settings
        if (options.includeSettings) {
            const {
                currentTheme, customTheme, fontFamily, fontSize, lineHeight,
                shouldForceFont, readerViewMode, libraryLayout
            } = usePreferencesStore.getState();

            data.settings = {
                theme: currentTheme,
                customTheme,
                fontFamily,
                fontSize,
                lineHeight,
                shouldForceFont,
                readerViewMode,
                libraryLayout
            };
        }

        // Build export payload
        const payload: ExportPayload = {
            meta: {
                exporter: 'Versicle',
                version: '1.0.0',
                schemaVersion: EXPORT_SCHEMA_VERSION,
                timestamp: new Date().toISOString(),
                deviceId
            },
            data
        };

        // Serialize
        const jsonString = options.prettyPrint
            ? JSON.stringify(payload, null, 2)
            : JSON.stringify(payload);

        // Calculate checksum
        const checksum = await this.calculateChecksum(jsonString);
        payload.meta.checksum = checksum;

        // Re-serialize with checksum
        const finalJsonString = options.prettyPrint
            ? JSON.stringify(payload, null, 2)
            : JSON.stringify(payload);

        const blob = new Blob([finalJsonString], { type: 'application/json' });

        // Generate filename
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `versicle_export_${dateStr}.json`;

        logger.info(`Export complete: ${booksCount} books, ${annotationsCount} annotations, ${lexiconRulesCount} lexicon rules`);

        return {
            blob,
            filename,
            checksum,
            stats: {
                booksCount,
                annotationsCount,
                lexiconRulesCount
            }
        };
    }

    /**
     * Parses and validates an import file.
     */
    static async parseImportFile(file: File): Promise<ExportPayload> {
        logger.info(`Parsing import file: ${file.name} (${file.size} bytes)`);

        const text = await file.text();
        let parsed: unknown;

        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON file');
        }

        const validation = this.validateImportData(parsed);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        return parsed as ExportPayload;
    }

    /**
     * Validates import data structure.
     */
    static validateImportData(data: unknown): ValidationResult {
        const errors: string[] = [];

        if (!data || typeof data !== 'object') {
            return { valid: false, errors: ['Data must be an object'] };
        }

        const payload = data as Partial<ExportPayload>;

        // Check meta
        if (!payload.meta) {
            errors.push('Missing meta section');
        } else {
            if (!payload.meta.schemaVersion || typeof payload.meta.schemaVersion !== 'number') {
                errors.push('Missing or invalid schemaVersion');
            }
            if (!payload.meta.exporter) {
                errors.push('Missing exporter field');
            }
        }

        // Check data section
        if (!payload.data) {
            errors.push('Missing data section');
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return {
            valid: true,
            errors: [],
            schemaVersion: payload.meta?.schemaVersion
        };
    }

    /**
     * Migrates data from older schema versions to current.
     */
    static migrateSchema(payload: ExportPayload, fromVersion: number): ExportPayload {
        logger.info(`Migrating schema from v${fromVersion} to v${EXPORT_SCHEMA_VERSION}`);

        // Currently at v1, no migrations needed yet
        // Future migrations would be handled here
        if (fromVersion < EXPORT_SCHEMA_VERSION) {
            // Add migration logic as schema evolves
            payload.meta.schemaVersion = EXPORT_SCHEMA_VERSION;
        }

        return payload;
    }

    /**
     * Merges imported data into Yjs document using transactions.
     */
    static async mergeIntoYDoc(payload: ExportPayload): Promise<ImportResult> {
        logger.info('Starting merge into yDoc');

        const result: ImportResult = {
            success: false,
            booksImported: 0,
            annotationsImported: 0,
            lexiconRulesImported: 0,
            conflicts: [],
            errors: []
        };

        try {
            // Migrate if needed
            const migrated = payload.meta.schemaVersion < EXPORT_SCHEMA_VERSION
                ? this.migrateSchema(payload, payload.meta.schemaVersion)
                : payload;

            const { data } = migrated;

            // Use yDoc.transact for atomic updates
            yDoc.transact(() => {
                // Merge books
                if (data.books) {
                    const bookStore = useBookStore.getState();

                    for (const [bookId, bookEntry] of Object.entries(data.books)) {
                        const existing = bookStore.books[bookId];

                        if (existing) {
                            // LWW: Compare lastInteraction timestamps
                            const importedTime = bookEntry.metadata?.addedAt || 0;
                            const existingTime = existing.lastInteraction || 0;

                            if (importedTime > existingTime) {
                                bookStore.updateBook(bookId, {
                                    title: bookEntry.metadata?.title || existing.title,
                                    author: bookEntry.metadata?.author || existing.author,
                                    coverPalette: bookEntry.metadata?.coverPalette || existing.coverPalette,
                                    lastInteraction: importedTime
                                });
                                result.conflicts.push(`Book '${existing.title}' updated from import (LWW)`);
                            } else {
                                result.conflicts.push(`Book '${existing.title}' kept local version (LWW)`);
                            }
                        } else {
                            // New book: add as Ghost Book entry
                            const newBook: UserInventoryItem = {
                                bookId,
                                title: bookEntry.metadata?.title || 'Unknown',
                                author: bookEntry.metadata?.author || 'Unknown Author',
                                addedAt: bookEntry.metadata?.addedAt || Date.now(),
                                lastInteraction: Date.now(),
                                tags: [],
                                status: 'unread',
                                coverPalette: bookEntry.metadata?.coverPalette,
                                sourceFilename: bookEntry.metadata?.filename
                            };
                            bookStore.addBook(newBook);
                        }
                        result.booksImported++;
                    }
                }

                // Merge annotations (Union strategy)
                if (data.books) {
                    const annotationStore = useAnnotationStore.getState();

                    for (const bookEntry of Object.values(data.books)) {
                        for (const annotation of bookEntry.annotations || []) {
                            const existing = annotationStore.annotations[annotation.id];

                            if (!existing) {
                                // Add new annotation (bypass the add method to preserve ID)
                                const { annotations, ...rest } = annotationStore;
                                useAnnotationStore.setState({
                                    ...rest,
                                    annotations: {
                                        ...annotations,
                                        [annotation.id]: annotation
                                    }
                                });
                                result.annotationsImported++;
                            }
                            // Existing annotations are preserved (Union)
                        }
                    }
                }

                // Merge lexicon rules (Union strategy)
                if (data.lexicon) {
                    const lexiconStore = useLexiconStore.getState();

                    for (const rule of data.lexicon) {
                        const existing = lexiconStore.rules[rule.id];

                        if (!existing) {
                            lexiconStore.addRule({
                                original: rule.original,
                                replacement: rule.replacement,
                                isRegex: rule.isRegex,
                                bookId: rule.bookId
                            });
                            result.lexiconRulesImported++;
                        }
                    }
                }

                // Merge reading list (Union strategy)
                if (data.readingList) {
                    const readingListStore = useReadingListStore.getState();

                    for (const [filename, entry] of Object.entries(data.readingList)) {
                        const existing = readingListStore.entries[filename];

                        if (!existing) {
                            readingListStore.addEntry(entry);
                        } else if ((entry.lastUpdated || 0) > (existing.lastUpdated || 0)) {
                            readingListStore.updateEntry(filename, entry);
                            result.conflicts.push(`Reading list '${filename}' updated from import`);
                        }
                    }
                }

                // Merge settings (LWW strategy)
                if (data.settings) {
                    const preferencesStore = usePreferencesStore.getState();

                    // Only update if import has settings
                    // We assume import is intentional override or sync
                    // Ideally we'd compare timestamp but settings don't have one globally.
                    // We'll treat import as "newer" or explicit user intent.

                    if (data.settings.theme) {
                        preferencesStore.setTheme(data.settings.theme as 'light' | 'dark' | 'sepia');
                    }
                    if (data.settings.customTheme) {
                        preferencesStore.setCustomTheme(data.settings.customTheme);
                    }
                    if (data.settings.fontFamily) preferencesStore.setFontFamily(data.settings.fontFamily);
                    if (data.settings.fontSize) preferencesStore.setFontSize(data.settings.fontSize);
                    if (data.settings.lineHeight) preferencesStore.setLineHeight(data.settings.lineHeight);
                    if (data.settings.shouldForceFont !== undefined) preferencesStore.setShouldForceFont(data.settings.shouldForceFont);
                    if (data.settings.readerViewMode) {
                        preferencesStore.setReaderViewMode(data.settings.readerViewMode as 'paginated' | 'scrolled');
                    }
                    if (data.settings.libraryLayout) {
                        preferencesStore.setLibraryLayout(data.settings.libraryLayout as 'grid' | 'list');
                    }
                }
            });

            result.success = true;
            logger.info(`Merge complete: ${result.booksImported} books, ${result.annotationsImported} annotations, ${result.lexiconRulesImported} lexicon rules`);

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(message);
            logger.error('Merge failed:', error);
        }

        return result;
    }

    /**
     * Calculates SHA-256 checksum of a string.
     */
    private static async calculateChecksum(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Triggers browser download of the export blob.
     */
    static downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Full export workflow: export and trigger download.
     */
    static async exportAndDownload(options: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<ExportResult> {
        const result = await this.exportToJSON(options);
        this.downloadBlob(result.blob, result.filename);
        return result;
    }

    /**
     * Full import workflow: parse, validate, and merge.
     */
    static async importFromFile(file: File): Promise<ImportResult> {
        const payload = await this.parseImportFile(file);
        return this.mergeIntoYDoc(payload);
    }
}
