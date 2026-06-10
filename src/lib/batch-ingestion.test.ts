import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractEpubsFromZip, processBatchImport } from './batch-ingestion';

// Mock dependencies
vi.mock('./ingestion', () => ({
    validateZipSignature: vi.fn().mockResolvedValue(true),
}));

vi.mock('./BookImportService', () => ({
    bookImportService: {
        addBook: vi.fn().mockResolvedValue({
            bookId: 'mock-id',
            title: 'Mock Title',
            author: 'Mock Author',
            schemaVersion: 1,
            fileSize: 100,
            coverPalette: [1, 2, 3, 4, 5]
        }),
    }
}));

import { bookImportService } from './BookImportService';

const { mockLoadAsync, mockAsync } = vi.hoisted(() => ({
    mockLoadAsync: vi.fn(),
    mockAsync: vi.fn(),
}));

vi.mock('jszip', () => {
    return {
        default: class MockJSZip {
            loadAsync = mockLoadAsync;
        }
    };
});

// Mock FileReader
global.FileReader = class {
    readAsArrayBuffer() {
        // immediately trigger onload with dummy buffer
        // @ts-expect-error Mocking FileReader internals
        this.onload({ target: { result: new ArrayBuffer(8) } });
    }
} as unknown as typeof FileReader;


describe('batch-ingestion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    describe('extractEpubsFromZip', () => {
        it('should extract epub files from a zip', async () => {
            const zipFile = new File(['dummy zip content'], 'books.zip', { type: 'application/zip' });

            const files = {
                'folder/': { dir: true, name: 'folder/', async: mockAsync },
                'folder/book1.epub': { dir: false, name: 'folder/book1.epub', async: mockAsync },
                'book2.epub': { dir: false, name: 'book2.epub', async: mockAsync },
                'image.png': { dir: false, name: 'image.png', async: mockAsync }
            };

            const mockZipObject = {
                files,
                forEach: (cb: (relativePath: string, file: unknown) => void) => {
                    Object.keys(files).forEach((key) => {
                        // JSZip forEach callback: (relativePath, file)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        cb(key, (files as any)[key]);
                    });
                }
            };

            mockLoadAsync.mockResolvedValue(mockZipObject);
            mockAsync.mockResolvedValue(new Blob(['dummy epub content']));

            const results = await extractEpubsFromZip(zipFile);

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('book1.epub');
            expect(results[1].name).toBe('book2.epub');
        });

        it('should handle errors gracefully', async () => {
            const zipFile = new File(['bad content'], 'bad.zip');
            mockLoadAsync.mockRejectedValue(new Error('Corrupted zip'));

            await expect(extractEpubsFromZip(zipFile)).rejects.toThrow('Failed to process ZIP file');
        });

        it('should report progress when onProgress is provided', async () => {
            const zipFile = new File(['dummy zip content'], 'books.zip', { type: 'application/zip' });
            const onProgress = vi.fn();

            // Override mock FileReader to support progress testing if needed,
            // but here we just check if it runs without crashing given our global mock.
            // Our simple global mock calls onload immediately, skipping progress events unless we enhance it.
            // Enhancing global mock for this test:

            const originalFileReader = global.FileReader;
            global.FileReader = class {
                readAsArrayBuffer() {
                    // @ts-expect-error Mocking FileReader internals
                    if (this.onprogress) this.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
                    // @ts-expect-error Mocking FileReader internals
                    this.onload({ target: { result: new ArrayBuffer(8) } });
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;

            mockLoadAsync.mockResolvedValue({
                files: {},
                forEach: () => { }
            });

            await extractEpubsFromZip(zipFile, onProgress);

            expect(onProgress).toHaveBeenCalled();

            global.FileReader = originalFileReader;
        });
    });

    describe('processBatchImport', () => {
        it('should process individual epub files directly', async () => {
            const file1 = new File(['content'], 'book1.epub');
            const file2 = new File(['content'], 'book2.epub');

            const result = await processBatchImport([file1, file2]);

            expect(bookImportService.addBook).toHaveBeenCalledTimes(2);
            expect(bookImportService.addBook).toHaveBeenCalledWith(file1, undefined);
            expect(bookImportService.addBook).toHaveBeenCalledWith(file2, undefined);

            // Verify structure
            expect(result.successful).toHaveLength(2);
            expect(result.successful[0].sourceFilename).toBe('book1.epub');
            expect(result.successful[0].manifest.coverPalette).toEqual([1, 2, 3, 4, 5]);
            expect(result.successful[1].sourceFilename).toBe('book2.epub');
            expect(result.successful[1].manifest.coverPalette).toEqual([1, 2, 3, 4, 5]);
        });

        it('should unzip and process files from zips', async () => {
            const zipFile = new File(['zip content'], 'archive.zip');
            const epubFile = new File(['epub content'], 'standalone.epub');

            const files = {
                'inside.epub': { dir: false, name: 'inside.epub', async: mockAsync }
            };

            const mockZipObject = {
                files,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                forEach: (cb: any) => {
                    Object.keys(files).forEach((key) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        cb(key, (files as any)[key]);
                    });
                }
            };

            mockLoadAsync.mockResolvedValue(mockZipObject);
            mockAsync.mockResolvedValue(new Blob(['inside content']));

            const result = await processBatchImport([zipFile, epubFile]);

            expect(bookImportService.addBook).toHaveBeenCalledTimes(2);
            // One call for extracted file (we can't easily check equality of the file object created inside, but we know it's there)
            // One call for standalone.epub
            expect(bookImportService.addBook).toHaveBeenCalledWith(epubFile, undefined);

            expect(result.successful).toHaveLength(2);
            // ZIP content processed first
            expect(result.successful[0].sourceFilename).toBe('inside.epub');
            expect(result.successful[1].sourceFilename).toBe('standalone.epub');
        });

        it('should continue if one file fails', async () => {
            const file1 = new File(['content'], 'good.epub');
            const file2 = new File(['content'], 'bad.epub');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bookImportService.addBook as any).mockImplementation((file: File) => {
                if (file.name === 'bad.epub') throw new Error('Failed');
                return Promise.resolve({ bookId: 'book-id' });
            });

            const { successful } = await processBatchImport([file1, file2]);

            expect(bookImportService.addBook).toHaveBeenCalledTimes(2);
            expect(successful.length).toBe(1);
        });

        it('should report import progress', async () => {
            const file1 = new File(['content'], 'book1.epub');
            const file2 = new File(['content'], 'book2.epub');
            const onProgress = vi.fn();

            await processBatchImport([file1, file2], undefined, onProgress);

            expect(onProgress).toHaveBeenCalledTimes(2);
            expect(onProgress).toHaveBeenCalledWith(0, 2, 'book1.epub');
            expect(onProgress).toHaveBeenCalledWith(1, 2, 'book2.epub');
        });

        it('should report upload progress', async () => {
            const file1 = new File(['content'], 'book1.epub');
            const onUploadProgress = vi.fn();

            await processBatchImport([file1], undefined, undefined, onUploadProgress);

            expect(onUploadProgress).toHaveBeenCalled();
            expect(onUploadProgress).toHaveBeenLastCalledWith(100, expect.stringContaining('All files processed'));
        });
    });

    describe('regression: batch import surfaces per-file outcomes (duplicates + failures)', () => {
        it('reports a duplicate and a corrupt file accurately while importing the rest', async () => {
            const good = new File(['content'], 'good.epub');
            const dup = new File(['content'], 'dup.epub');
            const bad = new File(['content'], 'bad.epub');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bookImportService.addBook as any).mockImplementation((file: File) => {
                if (file.name === 'bad.epub') return Promise.reject(new Error('Corrupt EPUB structure'));
                return Promise.resolve({ bookId: `id-${file.name}` });
            });

            const isDuplicate = vi.fn(async (filename: string) => filename === 'dup.epub');

            const result = await processBatchImport([good, dup, bad], undefined, undefined, undefined, { isDuplicate });

            expect(result.successful).toHaveLength(1);
            expect(result.successful[0].sourceFilename).toBe('good.epub');
            expect(result.skipped).toEqual(['dup.epub']);
            expect(result.failed).toEqual([{ filename: 'bad.epub', reason: 'Corrupt EPUB structure' }]);

            // The duplicate must never reach the import pipeline (it would get a fresh UUID)
            expect(bookImportService.addBook).toHaveBeenCalledTimes(2);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const importedNames = (bookImportService.addBook as any).mock.calls.map((call: [File]) => call[0].name);
            expect(importedNames).toEqual(['good.epub', 'bad.epub']);
        });

        it('skips repeated filenames within the same batch', async () => {
            const first = new File(['content'], 'same.epub');
            const second = new File(['content'], 'same.epub');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bookImportService.addBook as any).mockResolvedValue({ bookId: 'id-1' });

            const result = await processBatchImport([first, second]);

            expect(bookImportService.addBook).toHaveBeenCalledTimes(1);
            expect(result.successful).toHaveLength(1);
            expect(result.skipped).toEqual(['same.epub']);
            expect(result.failed).toEqual([]);
        });

        it('records a failure when a ZIP cannot be extracted', async () => {
            const zipFile = new File(['bad'], 'broken.zip');
            const epubFile = new File(['content'], 'fine.epub');

            mockLoadAsync.mockRejectedValue(new Error('Corrupted zip'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bookImportService.addBook as any).mockResolvedValue({ bookId: 'id-fine' });

            const result = await processBatchImport([zipFile, epubFile]);

            expect(result.successful).toHaveLength(1);
            expect(result.successful[0].sourceFilename).toBe('fine.epub');
            expect(result.failed).toEqual([
                { filename: 'broken.zip', reason: expect.stringContaining('Failed to process ZIP file') }
            ]);
        });

        it('records a failure for unsupported file types', async () => {
            const txt = new File(['hello'], 'notes.txt');

            const result = await processBatchImport([txt]);

            expect(bookImportService.addBook).not.toHaveBeenCalled();
            expect(result.successful).toHaveLength(0);
            expect(result.failed).toEqual([
                { filename: 'notes.txt', reason: expect.stringContaining('Unsupported file type') }
            ]);
        });

        it('records a failure when import produces no manifest', async () => {
            const file = new File(['content'], 'empty.epub');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bookImportService.addBook as any).mockResolvedValue(undefined);

            const result = await processBatchImport([file]);

            expect(result.successful).toHaveLength(0);
            expect(result.failed).toEqual([
                { filename: 'empty.epub', reason: 'Import did not produce a book manifest.' }
            ]);
        });
    });

    describe('concurrency limit', () => {
        it('should chunk extraction and yield to main thread for large zips', async () => {
            const zipFile = new File(['dummy zip content'], 'books.zip', { type: 'application/zip' });

            const numFiles = 15; // > concurrency limit of 5
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const files: Record<string, any> = {};
            for (let i = 0; i < numFiles; i++) {
                files[`book${i}.epub`] = { dir: false, name: `book${i}.epub`, async: mockAsync };
            }

            const mockZipObject = {
                files,
                forEach: (cb: (relativePath: string, file: unknown) => void) => {
                    Object.keys(files).forEach((key) => {
                        cb(key, files[key]);
                    });
                }
            };

            mockLoadAsync.mockResolvedValue(mockZipObject);

            let activeCalls = 0;
            let maxActiveCalls = 0;

            mockAsync.mockImplementation(async () => {
                activeCalls++;
                maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
                await new Promise(resolve => setTimeout(resolve, 10));
                activeCalls--;
                return new Blob(['dummy epub content']);
            });

            vi.spyOn(global, 'setTimeout');

            await extractEpubsFromZip(zipFile);

            expect(maxActiveCalls).toBeLessThanOrEqual(5);
            expect(global.setTimeout).toHaveBeenCalled();
        });
    });
});
