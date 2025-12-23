
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractEpubsFromZip, processBatchImport } from './batch-ingestion';
import { processEpub } from './ingestion';

// Mock dependencies
vi.mock('./ingestion', () => ({
    processEpub: vi.fn(),
    validateZipSignature: vi.fn().mockResolvedValue(true),
}));

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

describe('batch-ingestion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                forEach: (cb: any) => {
                    Object.keys(files).forEach((key) => {
                        // JSZip forEach callback: (relativePath, file)
                        // @ts-expect-error Mocking JSZip internals
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
    });

    describe('processBatchImport', () => {
        it('should process individual epub files directly', async () => {
            const file1 = new File(['content'], 'book1.epub');
            const file2 = new File(['content'], 'book2.epub');

            await processBatchImport([file1, file2]);

            expect(processEpub).toHaveBeenCalledTimes(2);
            expect(processEpub).toHaveBeenCalledWith(file1, undefined);
            expect(processEpub).toHaveBeenCalledWith(file2, undefined);
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
                         // @ts-expect-error Mocking JSZip internals
                         // eslint-disable-next-line @typescript-eslint/no-explicit-any
                         cb(key, (files as any)[key]);
                     });
                 }
             };

             mockLoadAsync.mockResolvedValue(mockZipObject);
             mockAsync.mockResolvedValue(new Blob(['inside content']));

             await processBatchImport([zipFile, epubFile]);

             expect(processEpub).toHaveBeenCalledTimes(2);
             // One call for extracted file (we can't easily check equality of the file object created inside, but we know it's there)
             // One call for standalone.epub
             expect(processEpub).toHaveBeenCalledWith(epubFile, undefined);
        });

        it('should continue if one file fails', async () => {
             const file1 = new File(['content'], 'good.epub');
             const file2 = new File(['content'], 'bad.epub');

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (processEpub as any).mockImplementation((file: File) => {
                 if (file.name === 'bad.epub') throw new Error('Failed');
                 return Promise.resolve('book-id');
             });

             const successCount = await processBatchImport([file1, file2]);

             expect(processEpub).toHaveBeenCalledTimes(2);
             expect(successCount).toBe(1);
        });

        it('should report progress', async () => {
            const file1 = new File(['content'], 'book1.epub');
            const file2 = new File(['content'], 'book2.epub');
            const onProgress = vi.fn();

            await processBatchImport([file1, file2], undefined, onProgress);

            expect(onProgress).toHaveBeenCalledTimes(2);
            expect(onProgress).toHaveBeenCalledWith(0, 2, 'book1.epub');
            expect(onProgress).toHaveBeenCalledWith(1, 2, 'book2.epub');
        });
    });
});
