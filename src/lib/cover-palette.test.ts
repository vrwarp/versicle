/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { extractCoverPalette } from './cover-palette';

describe('extractCoverPalette', () => {
    it('should extract palette using OffscreenCanvas when available', async () => {
         // Mock OffscreenCanvas
        const mockContext = {
            drawImage: vi.fn(),
            getImageData: vi.fn().mockReturnValue({
                data: new Uint8ClampedArray(1024).fill(255) // White
            })
        };

        class MockOffscreenCanvas {
            getContext() {
                return mockContext;
            }
        }
        // Mock global.OffscreenCanvas as a class (constructor)
        global.OffscreenCanvas = vi.fn(function() {
            return new MockOffscreenCanvas();
        }) as unknown as typeof OffscreenCanvas;

        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(global.OffscreenCanvas).toHaveBeenCalled();
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(palette).toHaveLength(5);

        // Verify packing (approximate due to weighted averaging)
        // With weighted K-Means, we expect 5 colors.
        // We mocked a simple 4-pixel buffer but the code expects 16x16.
        // The mock context needs to provide enough data for 16x16.
        // 16 * 16 * 4 = 1024 bytes.

        expect(palette).toHaveLength(5);
    });

    it('should fallback to document.createElement if OffscreenCanvas is missing', async () => {
        // Unset OffscreenCanvas
        (global as any).OffscreenCanvas = undefined;

        const mockContext = {
            drawImage: vi.fn(),
            getImageData: vi.fn().mockReturnValue({
                data: new Uint8ClampedArray(1024).fill(0) // All black (16*16*4)
            })
        };

        const mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn().mockReturnValue(mockContext)
        };

        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(document.createElement).toHaveBeenCalledWith('canvas');
        expect(mockCanvas.width).toBe(16);
        expect(mockCanvas.height).toBe(16);
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(palette).toEqual([0, 0, 0, 0, 0]);
    });

    it('should return empty array if context creation fails', async () => {
        (global as any).OffscreenCanvas = undefined;

        const mockCanvas = {
            getContext: vi.fn().mockReturnValue(null) // Context failure
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(palette).toEqual([]);
    });

    it('should return empty array if createImageBitmap fails', async () => {
        (global as any).OffscreenCanvas = undefined;
        global.createImageBitmap = vi.fn().mockRejectedValue(new Error('Failed'));

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(palette).toEqual([]);
    });
});
