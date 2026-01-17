
// --- Weighted K-Means Clustering Utils ---

interface Pixel {
    r: number;
    g: number;
    b: number;
    x: number;
    y: number;
    weight: number;
}

interface Point {
    x: number;
    y: number;
}

interface Color {
    r: number;
    g: number;
    b: number;
}

function packColor(c: Color): number {
    const r4 = (Math.round(c.r) >> 4) & 0xF;
    const g8 = Math.round(c.g) & 0xFF;
    const b4 = (Math.round(c.b) >> 4) & 0xF;
    return (r4 << 12) | (g8 << 4) | b4;
}

function distRGBSq(c1: Color, c2: Color): number {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return dr * dr + dg * dg + db * db;
}

function extractRegionColor(pixels: Pixel[], anchor: Point): Color {
    // 1. Pre-calculate weights (1.5f exponent)
    for (const p of pixels) {
        const dist = Math.sqrt(Math.pow(p.x - anchor.x, 2) + Math.pow(p.y - anchor.y, 2));
        p.weight = 1.0 / (1.0 + Math.pow(dist, 1.5));
    }

    // 2. Init Centroids (Deterministic)
    let c1: Color = { r: 0, g: 0, b: 0 };
    let c2: Color = { r: 0, g: 0, b: 0 };

    // Find max/min weight pixels
    let maxW = -1;
    let minW = Infinity;

    for (const p of pixels) {
        if (p.weight > maxW) {
            maxW = p.weight;
            c1 = { r: p.r, g: p.g, b: p.b };
        }
        if (p.weight < minW) {
            minW = p.weight;
            c2 = { r: p.r, g: p.g, b: p.b };
        }
    }

    // 3. Run K-Means (5 iterations)
    for (let i = 0; i < 5; i++) {
        const sum1 = { r: 0, g: 0, b: 0 };
        const sum2 = { r: 0, g: 0, b: 0 };
        let wSum1 = 0;
        let wSum2 = 0;

        for (const p of pixels) {
            // Assign to nearest centroid
            if (distRGBSq(p, c1) < distRGBSq(p, c2)) {
                sum1.r += p.r * p.weight;
                sum1.g += p.g * p.weight;
                sum1.b += p.b * p.weight;
                wSum1 += p.weight;
            } else {
                sum2.r += p.r * p.weight;
                sum2.g += p.g * p.weight;
                sum2.b += p.b * p.weight;
                wSum2 += p.weight;
            }
        }

        // Weighted Update
        if (wSum1 > 0) c1 = { r: sum1.r / wSum1, g: sum1.g / wSum1, b: sum1.b / wSum1 };
        if (wSum2 > 0) c2 = { r: sum2.r / wSum2, g: sum2.g / wSum2, b: sum2.b / wSum2 };

        // Store total weights for winner selection
        if (i === 4) {
            return wSum1 > wSum2 ? c1 : c2;
        }
    }

    return c1;
}

export async function extractCoverPalette(blob: Blob): Promise<number[]> {
    try {
        const bitmap = await createImageBitmap(blob);
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

        const size = 16; // 16x16 grid

        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(size, size);
            ctx = canvas.getContext('2d');
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            ctx = canvas.getContext('2d');
        }

        if (!ctx) return [];

        ctx.drawImage(bitmap, 0, 0, size, size);
        const imgData = ctx.getImageData(0, 0, size, size).data;

        // Define regions (Indices in 4x4 block grid, each block is 4px)
        // 16x16 px total.
        // We can just iterate pixels directly.
        // Regions:
        // TL: Blocks (0,0), (1,0), (0,1) -> rects: (0,0,8,4), (0,4,4,4)
        // Or simpler: Assign each pixel (x,y) to list of regions it belongs to.

        const regions: { pixels: Pixel[], anchor: Point }[] = [
            { pixels: [], anchor: { x: 0, y: 0 } },       // TL (Index 0)
            { pixels: [], anchor: { x: 15, y: 0 } },      // TR (Index 1)
            { pixels: [], anchor: { x: 0, y: 15 } },      // BL (Index 2)
            { pixels: [], anchor: { x: 15, y: 15 } },     // BR (Index 3)
            { pixels: [], anchor: { x: 7.5, y: 7.5 } }    // Center (Index 4)
        ];

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const p: Pixel = {
                    r: imgData[i],
                    g: imgData[i + 1],
                    b: imgData[i + 2],
                    x,
                    y,
                    weight: 0
                };

                const bx = Math.floor(x / 4); // Block X (0-3)
                const by = Math.floor(y / 4); // Block Y (0-3)

                // 1. Center: Inner 2x2 blocks ([1,1] to [2,2])
                if (bx >= 1 && bx <= 2 && by >= 1 && by <= 2) {
                    regions[4].pixels.push({ ...p });
                }

                // 2. Top-Left: (0,0), (1,0), (0,1)
                if ((bx === 0 && by === 0) || (bx === 1 && by === 0) || (bx === 0 && by === 1)) {
                    regions[0].pixels.push({ ...p });
                }

                // 3. Top-Right: (3,0), (2,0), (3,1)
                if ((bx === 3 && by === 0) || (bx === 2 && by === 0) || (bx === 3 && by === 1)) {
                    regions[1].pixels.push({ ...p });
                }

                // 4. Bottom-Left: (0,3), (1,3), (0,2)
                if ((bx === 0 && by === 3) || (bx === 1 && by === 3) || (bx === 0 && by === 2)) {
                    regions[2].pixels.push({ ...p });
                }

                // 5. Bottom-Right: (3,3), (2,3), (3,2)
                if ((bx === 3 && by === 3) || (bx === 2 && by === 3) || (bx === 3 && by === 2)) {
                    regions[3].pixels.push({ ...p });
                }
            }
        }

        const palette: number[] = regions.map(r => {
            if (r.pixels.length === 0) return 0; // Should not happen
            const c = extractRegionColor(r.pixels, r.anchor);
            return packColor(c);
        });

        return palette;
    } catch (e) {
        console.warn('Failed to extract cover palette:', e);
        return [];
    }
}

/**
 * Unpacks a 16-bit integer color (R4-G8-B4) into 8-bit components.
 */
export function unpackColorToRGB(packed: number): { r: number, g: number, b: number } {
    const r = ((packed >> 12) & 0xF) * 17;
    const g = (packed >> 4) & 0xFF;
    const b = (packed & 0xF) * 17;
    return { r, g, b };
}

// Constants for sRGB to Lab conversion
const D65_EPSILON = 0.008856;
const D65_KAPPA = 903.3;

/**
 * Calculates ONLY the perceptual lightness (L*) from an RGB triplet.
 * Optimization: Skips calculation of a* and b* components.
 */
export function rgbToL(r: number, g: number, b: number): number {
    // 1. Normalize (0-255 -> 0-1) and Linearize (Gamma Expansion)
    const v = [r, g, b].map(val => {
        val /= 255;
        return val <= 0.04045
            ? val / 12.92
            : Math.pow((val + 0.055) / 1.055, 2.4);
    });

    // 2. Calculate Luminance (Y)
    // Using sRGB / Rec. 709 coefficients
    const Y = (0.2126 * v[0]) + (0.7152 * v[1]) + (0.0722 * v[2]);

    // 3. Calculate L* (CIE 1976 Lightness)
    // Formula: L* = 116 * f(Y) - 16
    return Y <= D65_EPSILON
        ? Y * D65_KAPPA
        : (Math.pow(Y, 1/3) * 116) - 16;
}

/**
 * Determines the optimal text color for a given color palette.
 * Returns a Tailwind class string.
 */
export function getOptimizedTextColor(palette: number[] | undefined): string {
    // Default fallback
    if (!palette || palette.length === 0) return 'text-white';

    // Calculate Average Lightness
    let totalL = 0;
    for (const packed of palette) {
        const { r, g, b } = unpackColorToRGB(packed);
        totalL += rgbToL(r, g, b);
    }
    const avgL = totalL / palette.length;

    // Apply "Soft/Hard" Curve Logic
    if (avgL > 85) return 'text-slate-700'; // Soft Dark
    if (avgL > 55) return 'text-black';     // Hard Black
    if (avgL > 30) return 'text-white';     // Hard White
    return 'text-slate-200';                // Soft Light
}
