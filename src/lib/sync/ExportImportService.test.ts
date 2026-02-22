import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ExportImportService,
    type ExportOptions
} from './ExportImportService';
import { exportFile } from '../export';

// Mock all stores
vi.mock('../../store/useBookStore', () => ({
    useBookStore: {
        getState: vi.fn(() => ({
            books: {
                'book-1': {
                    bookId: 'book-1',
                    title: 'Test Book',
                    author: 'Test Author',
                    addedAt: 1700000000000,
                    lastInteraction: 1700000000000,
                    tags: ['fiction'],
                    status: 'reading',
                    coverPalette: [1, 2, 3, 4, 5],
                    sourceFilename: 'test.epub'
                }
            },
            addBook: vi.fn(),
            updateBook: vi.fn()
        }))
    }
}));

vi.mock('../../store/useAnnotationStore', () => ({
    useAnnotationStore: {
        getState: vi.fn(() => ({
            annotations: {
                'ann-1': {
                    id: 'ann-1',
                    bookId: 'book-1',
                    cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
                    text: 'Test highlight',
                    type: 'highlight',
                    color: '#ffff00',
                    created: 1700000000000
                }
            }
        })),
        setState: vi.fn()
    }
}));

vi.mock('../../store/useLexiconStore', () => ({
    useLexiconStore: {
        getState: vi.fn(() => ({
            rules: {
                'rule-1': {
                    id: 'rule-1',
                    original: 'Capt.',
                    replacement: 'Captain',
                    isRegex: false,
                    created: 1700000000000
                }
            },
            addRule: vi.fn()
        }))
    }
}));

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            progress: {
                'book-1': {
                    'device-1': {
                        bookId: 'book-1',
                        percentage: 0.45,
                        currentCfi: 'epubcfi(/6/14)',
                        lastRead: 1700000000000,
                        completedRanges: []
                    }
                }
            }
        }))
    }
}));

vi.mock('../../store/usePreferencesStore', () => ({
    usePreferencesStore: {
        getState: vi.fn(() => ({
            currentTheme: 'dark',
            fontSize: 100
        }))
    }
}));

vi.mock('../../store/useReadingListStore', () => ({
    useReadingListStore: {
        getState: vi.fn(() => ({
            entries: {},
            addEntry: vi.fn(),
            updateEntry: vi.fn()
        }))
    }
}));

vi.mock('../../store/yjs-provider', () => ({
    yDoc: {
        transact: vi.fn((fn: () => void) => fn())
    }
}));

vi.mock('../device-id', () => ({
    getDeviceId: vi.fn(() => 'test-device-123')
}));

vi.mock('../logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    })
}));

vi.mock('../export', () => ({
    exportFile: vi.fn()
}));

describe('ExportImportService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('exportToJSON', () => {
        it('should export library data with default options', async () => {
            const result = await ExportImportService.exportToJSON();

            expect(result).toBeDefined();
            expect(result.blob).toBeInstanceOf(Blob);
            expect(result.filename).toMatch(/versicle_export_\d{4}-\d{2}-\d{2}\.json/);
            expect(result.checksum).toBeDefined();
            expect(result.stats.booksCount).toBe(1);
            expect(result.stats.annotationsCount).toBe(1);
            expect(result.stats.lexiconRulesCount).toBe(1);
        });

        it('should call exportFile when using exportAndDownload', async () => {
            await ExportImportService.exportAndDownload();
            expect(exportFile).toHaveBeenCalled();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const callArgs = (exportFile as any).mock.calls[0][0];
            expect(callArgs.filename).toMatch(/versicle_export_\d{4}-\d{2}-\d{2}\.json/);
            expect(callArgs.data).toBeInstanceOf(Blob);
            expect(callArgs.mimeType).toBe('application/json');
        });

        it('should respect export options', async () => {
            const options: ExportOptions = {
                includeLibrary: true,
                includeProgress: false,
                includeAnnotations: false,
                includeSettings: false,
                includeLexicon: false,
                includeReadingList: false,
                prettyPrint: false
            };

            const result = await ExportImportService.exportToJSON(options);

            // Parse the blob to verify content
            const text = await result.blob.text();
            const parsed = JSON.parse(text);

            expect(parsed.data.books).toBeDefined();
            expect(parsed.data.lexicon).toBeUndefined();
        });

        it('should include metadata in export', async () => {
            const result = await ExportImportService.exportToJSON();
            const text = await result.blob.text();
            const parsed = JSON.parse(text);

            expect(parsed.meta.exporter).toBe('Versicle');
            expect(parsed.meta.schemaVersion).toBe(1);
            expect(parsed.meta.deviceId).toBe('test-device-123');
            expect(parsed.meta.timestamp).toBeDefined();
        });

        it('should include settings in export', async () => {
            const result = await ExportImportService.exportToJSON();
            const text = await result.blob.text();
            const parsed = JSON.parse(text);

            expect(parsed.data.settings).toBeDefined();
            expect(parsed.data.settings.theme).toBe('dark');
            expect(parsed.data.settings.fontSize).toBe(100);
        });
    });

    describe('validateImportData', () => {
        it('should validate correct import data', () => {
            const validData = {
                meta: {
                    exporter: 'Versicle',
                    version: '1.0.0',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    deviceId: 'other-device'
                },
                data: {
                    version: 1,
                    lastUpdated: Date.now(),
                    deviceId: 'other-device',
                    books: {}
                }
            };

            const result = ExportImportService.validateImportData(validData);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.schemaVersion).toBe(1);
        });

        it('should reject data without meta section', () => {
            const invalidData = {
                data: { books: {} }
            };

            const result = ExportImportService.validateImportData(invalidData);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing meta section');
        });

        it('should reject data without schema version', () => {
            const invalidData = {
                meta: { exporter: 'Test' },
                data: { books: {} }
            };

            const result = ExportImportService.validateImportData(invalidData);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing or invalid schemaVersion');
        });

        it('should reject non-object data', () => {
            const result = ExportImportService.validateImportData('not an object');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Data must be an object');
        });
    });

    describe('parseImportFile', () => {
        it('should parse valid JSON file', async () => {
            const validPayload = {
                meta: {
                    exporter: 'Versicle',
                    version: '1.0.0',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    deviceId: 'test'
                },
                data: {
                    version: 1,
                    lastUpdated: Date.now(),
                    deviceId: 'test',
                    books: {}
                }
            };

            const file = new File(
                [JSON.stringify(validPayload)],
                'test.json',
                { type: 'application/json' }
            );

            const result = await ExportImportService.parseImportFile(file);

            expect(result.meta.exporter).toBe('Versicle');
            expect(result.data).toBeDefined();
        });

        it('should throw on invalid JSON', async () => {
            const file = new File(['not valid json'], 'test.json');

            await expect(ExportImportService.parseImportFile(file))
                .rejects.toThrow('Invalid JSON file');
        });

        it('should throw on validation failure', async () => {
            const invalidPayload = { invalid: true };
            const file = new File(
                [JSON.stringify(invalidPayload)],
                'test.json'
            );

            await expect(ExportImportService.parseImportFile(file))
                .rejects.toThrow('Validation failed');
        });
    });

    describe('migrateSchema', () => {
        it('should update schema version', () => {
            const payload = {
                meta: {
                    exporter: 'Versicle',
                    version: '0.9.0',
                    schemaVersion: 0,
                    timestamp: new Date().toISOString(),
                    deviceId: 'test'
                },
                data: {}
            };

            const result = ExportImportService.migrateSchema(payload, 0);

            expect(result.meta.schemaVersion).toBe(1);
        });
    });

    describe('round-trip export/import', () => {
        it('should export and import without data loss', async () => {
            // Export
            const exportResult = await ExportImportService.exportToJSON();

            // Create file from export
            const file = new File(
                [await exportResult.blob.text()],
                exportResult.filename,
                { type: 'application/json' }
            );

            // Parse (validation step)
            const parsed = await ExportImportService.parseImportFile(file);

            expect(parsed.data.books).toBeDefined();
            expect(Object.keys(parsed.data.books!)).toContain('book-1');
        });
    });
});
