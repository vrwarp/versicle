/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { extractCoverPalette, unpackColorToRGB, rgbToL, getOptimizedTextColor } from './cover-palette';

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

describe('Adaptive Contrast', () => {
    describe('rgbToL', () => {
        it('should return 0 for Black', () => {
            expect(rgbToL(0, 0, 0)).toBe(0);
        });

        it('should return 100 for White', () => {
            expect(rgbToL(255, 255, 255)).toBeCloseTo(100, 1);
        });

        it('should return correct L* for mid-grey (128, 128, 128)', () => {
            // Approx 53.6
            expect(rgbToL(128, 128, 128)).toBeCloseTo(53.6, 0.5);
        });

        it('should return correct L* for a known color (Salmon #FA8072)', () => {
            // R=250, G=128, B=114
            // Calculated L* is approx 67.3 with Rec. 709 coefficients
            expect(rgbToL(250, 128, 114)).toBeCloseTo(67.3, 1);
        });
    });

    describe('unpackColorToRGB', () => {
        it('should unpack packed color correctly', () => {
            // Create a packed color. R4-G8-B4
            // R=255 (0xF) -> packed 0xF...
            // G=128 (0x80) -> packed ...80...
            // B=0 (0x0) -> packed ...0

            // Expected R: 0xF * 17 = 255
            // Expected G: 0x80 = 128
            // Expected B: 0x0 * 17 = 0

            const packed = (0xF << 12) | (0x80 << 4) | 0x0;
            const rgb = unpackColorToRGB(packed);

            expect(rgb.r).toBe(255);
            expect(rgb.g).toBe(128);
            expect(rgb.b).toBe(0);
        });
    });

    describe('getOptimizedTextColor', () => {
        // Helper to pack RGB for testing
        const pack = (r: number, g: number, b: number) => {
            const r4 = (Math.round(r) >> 4) & 0xF;
            const g8 = Math.round(g) & 0xFF;
            const b4 = (Math.round(b) >> 4) & 0xF;
            return (r4 << 12) | (g8 << 4) | b4;
        };

        it('should return Soft Dark for High Lightness (White)', () => {
            const white = pack(255, 255, 255);
            const palette = [white, white, white, white, white];
            expect(getOptimizedTextColor(palette)).toBe('text-slate-700');
        });

        it('should return Hard Dark for Mid-High Lightness (Light Grey)', () => {
            // L=75 approx
            // rgbToL(190, 190, 190) is ~76
            const lightGrey = pack(190, 190, 190);
            const palette = [lightGrey, lightGrey, lightGrey, lightGrey, lightGrey];
            expect(getOptimizedTextColor(palette)).toBe('text-black');
        });

        it('should return Hard Light for Mid-Low Lightness (Dark Grey)', () => {
            // L=45 approx
            // rgbToL(100, 100, 100) is ~42
            const darkGrey = pack(100, 100, 100);
            const palette = [darkGrey, darkGrey, darkGrey, darkGrey, darkGrey];
            expect(getOptimizedTextColor(palette)).toBe('text-white');
        });

        it('should return Soft Light for Low Lightness (Black)', () => {
            const black = pack(0, 0, 0);
            const palette = [black, black, black, black, black];
            expect(getOptimizedTextColor(palette)).toBe('text-slate-200');
        });

        it('should handle undefined palette', () => {
             expect(getOptimizedTextColor(undefined)).toBe('text-white');
        });

        it('should handle empty palette', () => {
             expect(getOptimizedTextColor([])).toBe('text-white');
        });
    });
});
