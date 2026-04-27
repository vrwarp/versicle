/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCoverPalette, unpackColorToRGB, rgbToL, getOptimizedTextColor, rgbToXyz, xyzToLab, rgbToLab, deltaE, getChroma, extractPerceptualColors } from './cover-palette';

describe('extractCoverPalette', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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
        const result = await extractCoverPalette(blob);

        expect(global.OffscreenCanvas).toHaveBeenCalled();
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(result.palette).toHaveLength(5);

        // Verify packing (approximate due to weighted averaging)
        // With weighted K-Means, we expect 5 colors.
        // We mocked a simple 4-pixel buffer but the code expects 16x16.
        // The mock context needs to provide enough data for 16x16.
        // 16 * 16 * 4 = 1024 bytes.

        expect(result.palette).toHaveLength(5);
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
        const result = await extractCoverPalette(blob);

        expect(document.createElement).toHaveBeenCalledWith('canvas');
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(result.palette).toEqual([0, 0, 0, 0, 0]);
    });

    it('should return empty array if context creation fails', async () => {
        (global as any).OffscreenCanvas = undefined;

        const mockCanvas = {
            getContext: vi.fn().mockReturnValue(null) // Context failure
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const result = await extractCoverPalette(blob);

        expect(result.palette).toEqual([]);
    });

    it('should return empty array if createImageBitmap fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        (global as any).OffscreenCanvas = undefined;
        global.createImageBitmap = vi.fn().mockRejectedValue(new Error('Failed'));

        const blob = new Blob(['test']);
        const result = await extractCoverPalette(blob);

        expect(result.palette).toEqual([]);
    });
});

describe('Perceptual Color Utils', () => {
    describe('rgbToXyz', () => {
        it('should correctly convert sRGB to XYZ', () => {
            const [x, y, z] = rgbToXyz(255, 0, 0); // Red
            expect(x).toBeCloseTo(41.24, 1);
            expect(y).toBeCloseTo(21.26, 1);
            expect(z).toBeCloseTo(1.93, 1);
        });

        it('should handle black', () => {
            const [x, y, z] = rgbToXyz(0, 0, 0);
            expect(x).toBe(0);
            expect(y).toBe(0);
            expect(z).toBe(0);
        });

        it('should handle white', () => {
            const [x, y, z] = rgbToXyz(255, 255, 255);
            expect(x).toBeCloseTo(95.047, 1);
            expect(y).toBeCloseTo(100.0, 1);
            expect(z).toBeCloseTo(108.883, 1);
        });
    });

    describe('xyzToLab', () => {
        it('should correctly convert XYZ to CIELAB', () => {
            const [L, a, b] = xyzToLab(41.24, 21.26, 1.93); // Approx Red XYZ
            expect(L).toBeCloseTo(53.24, 1);
            expect(a).toBeCloseTo(80.09, 1);
            expect(b).toBeCloseTo(67.20, 1);
        });

        it('should handle pure black XYZ', () => {
            const [L, a, b] = xyzToLab(0, 0, 0);
            expect(L).toBe(0);
            expect(a).toBe(0);
            expect(b).toBe(0);
        });

        it('should handle pure white XYZ (D65)', () => {
            const [L, a, b] = xyzToLab(95.047, 100.0, 108.883);
            expect(L).toBeCloseTo(100, 1);
            expect(a).toBeCloseTo(0, 1);
            expect(b).toBeCloseTo(0, 1);
        });
    });

    describe('rgbToLab', () => {
        it('should convert RGB directly to CIELAB', () => {
            const [L, a, b] = rgbToLab(0, 255, 0); // Green
            expect(L).toBeCloseTo(87.73, 1);
            expect(a).toBeCloseTo(-86.18, 1);
            expect(b).toBeCloseTo(83.18, 1);
        });
    });

    describe('deltaE', () => {
        it('should calculate Euclidean distance correctly', () => {
            const lab1: [number, number, number] = [50, 20, -10];
            const lab2: [number, number, number] = [40, 10, 10];
            // sqrt(10^2 + 10^2 + 20^2) = sqrt(100 + 100 + 400) = sqrt(600) ≈ 24.49
            expect(deltaE(lab1, lab2)).toBeCloseTo(24.4948, 3);
        });

        it('should return 0 for identical colors', () => {
            const lab: [number, number, number] = [50, 0, 0];
            expect(deltaE(lab, lab)).toBe(0);
        });
    });

    describe('getChroma', () => {
        it('should calculate chroma correctly', () => {
            const lab: [number, number, number] = [50, 30, 40];
            // sqrt(30^2 + 40^2) = 50
            expect(getChroma(lab)).toBe(50);
        });

        it('should be 0 for pure grayscale (a=0, b=0)', () => {
            const lab: [number, number, number] = [50, 0, 0];
            expect(getChroma(lab)).toBe(0);
        });
    });

    describe('extractPerceptualColors', () => {
        it('should return undefined if context cannot be created', async () => {
            (global as any).OffscreenCanvas = undefined;
            const originalCreateElement = document.createElement;
            vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
                if (tagName === 'canvas') {
                    return {
                        getContext: () => null,
                    } as any;
                }
                return originalCreateElement.call(document, tagName);
            });
            const bitmap = {} as ImageBitmap;
            const result = await extractPerceptualColors(bitmap);
            expect(result).toBeUndefined();
        });

        it('should return undefined if there are no opaque pixels', async () => {
            const mockContext = {
                drawImage: vi.fn(),
                // Return all transparent pixels (alpha = 0)
                getImageData: () => ({ data: new Uint8ClampedArray(50 * 50 * 4) })
            };
            (global as any).OffscreenCanvas = class {
                getContext() { return mockContext; }
            };
            const bitmap = {} as ImageBitmap;
            const result = await extractPerceptualColors(bitmap);
            expect(result).toBeUndefined();
        });

        it('should extract valid background and standout colors', async () => {
            const mockData = new Uint8ClampedArray(50 * 50 * 4);
            // Fill with mostly red (background) and some blue (standout)
            for (let i = 0; i < mockData.length; i += 4) {
                if (i < mockData.length * 0.8) {
                    mockData[i] = 255;     // R
                    mockData[i+1] = 0;     // G
                    mockData[i+2] = 0;     // B
                    mockData[i+3] = 255;   // A
                } else {
                    mockData[i] = 0;       // R
                    mockData[i+1] = 0;     // G
                    mockData[i+2] = 255;   // B
                    mockData[i+3] = 255;   // A
                }
            }

            const mockContext = {
                drawImage: vi.fn(),
                getImageData: () => ({ data: mockData })
            };
            (global as any).OffscreenCanvas = class {
                getContext() { return mockContext; }
            };

            const bitmap = {} as ImageBitmap;
            const result = await extractPerceptualColors(bitmap);

            expect(result).toBeDefined();
            expect(result?.background).toEqual([255, 0, 0]);
            expect(result?.standout).toEqual([0, 0, 255]);
            expect(result?.deltaE).toBeGreaterThan(0);
        });
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
