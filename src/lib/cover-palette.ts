
import type { PerceptualPalette } from '../types/db';

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

export async function extractCoverPalette(blob: Blob): Promise<{ palette: number[], perceptualPalette?: PerceptualPalette }> {
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

        if (!ctx) return { palette: [] };

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

        let perceptualPalette: PerceptualPalette | undefined;
        try {
            perceptualPalette = await extractPerceptualColors(bitmap);
        } catch (e) {
            console.warn('Failed to extract perceptual palette:', e);
        }

        return { palette, perceptualPalette };
    } catch (e) {
        console.warn('Failed to extract cover palette:', e);
        return { palette: [] };
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

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
    let [vR, vG, vB] = [r / 255, g / 255, b / 255];

    vR = vR > 0.04045 ? Math.pow((vR + 0.055) / 1.055, 2.4) : vR / 12.92;
    vG = vG > 0.04045 ? Math.pow((vG + 0.055) / 1.055, 2.4) : vG / 12.92;
    vB = vB > 0.04045 ? Math.pow((vB + 0.055) / 1.055, 2.4) : vB / 12.92;

    vR *= 100;
    vG *= 100;
    vB *= 100;

    const x = vR * 0.4124564 + vG * 0.3575761 + vB * 0.1804375;
    const y = vR * 0.2126729 + vG * 0.7151522 + vB * 0.0721750;
    const z = vR * 0.0193339 + vG * 0.1191920 + vB * 0.9503041;

    return [x, y, z];
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
    const d65X = 95.047;
    const d65Y = 100.000;
    const d65Z = 108.883;

    let vX = x / d65X;
    let vY = y / d65Y;
    let vZ = z / d65Z;

    vX = vX > D65_EPSILON ? Math.pow(vX, 1 / 3) : (D65_KAPPA * vX + 16) / 116;
    vY = vY > D65_EPSILON ? Math.pow(vY, 1 / 3) : (D65_KAPPA * vY + 16) / 116;
    vZ = vZ > D65_EPSILON ? Math.pow(vZ, 1 / 3) : (D65_KAPPA * vZ + 16) / 116;

    const L = Math.max(0, 116 * vY - 16);
    const a = 500 * (vX - vY);
    const b = 200 * (vY - vZ);

    return [L, a, b];
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    const [x, y, z] = rgbToXyz(r, g, b);
    return xyzToLab(x, y, z);
}

export function deltaE(labA: [number, number, number], labB: [number, number, number]): number {
    const dL = labA[0] - labB[0];
    const da = labA[1] - labB[1];
    const db = labA[2] - labB[2];
    return Math.sqrt(dL * dL + da * da + db * db);
}

export function getChroma(lab: [number, number, number]): number {
    return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
}

async function extractPerceptualColors(bitmap: ImageBitmap): Promise<PerceptualPalette | undefined> {
    const size = 50;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(size, size);
        ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    } else {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    }

    if (!ctx) return undefined;

    ctx.drawImage(bitmap, 0, 0, size, size);
    const imgData = ctx.getImageData(0, 0, size, size).data;
    const pixels: { rgb: [number, number, number], lab: [number, number, number] }[] = [];

    for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];

        if (a < 128) continue; // Skip transparent pixels

        const lab = rgbToLab(r, g, b);
        pixels.push({ rgb: [r, g, b], lab });
    }

    if (pixels.length === 0) return undefined;

    // 5 Centers Deterministically Spaced
    const k = 5;
    const centers: { lab: [number, number, number], rgbSum: [number, number, number], labSum: [number, number, number], count: number }[] = [];
    const step = Math.max(1, Math.floor(pixels.length / k));
    for (let i = 0; i < k; i++) {
        const idx = Math.min(i * step, pixels.length - 1);
        centers.push({
            lab: [...pixels[idx].lab],
            rgbSum: [0, 0, 0],
            labSum: [0, 0, 0],
            count: 0
        });
    }

    // Lloyd's Algorithm
    const maxIters = 10;
    for (let iter = 0; iter < maxIters; iter++) {
        // Reset sums
        for (const center of centers) {
            center.rgbSum = [0, 0, 0];
            center.count = 0;
            center.labSum = [0, 0, 0];
        }

        // Assign to nearest
        let changed = false;
        for (const p of pixels) {
            let minDist = Infinity;
            let bestCenter = centers[0];
            for (const center of centers) {
                const dist = deltaE(p.lab, center.lab);
                if (dist < minDist) {
                    minDist = dist;
                    bestCenter = center;
                }
            }
            bestCenter.rgbSum[0] += p.rgb[0];
            bestCenter.rgbSum[1] += p.rgb[1];
            bestCenter.rgbSum[2] += p.rgb[2];
            bestCenter.labSum[0] += p.lab[0];
            bestCenter.labSum[1] += p.lab[1];
            bestCenter.labSum[2] += p.lab[2];
            bestCenter.count++;
        }

        // Update centers
        for (const center of centers) {
            if (center.count > 0) {
                const newLab: [number, number, number] = [
                    center.labSum[0] / center.count,
                    center.labSum[1] / center.count,
                    center.labSum[2] / center.count
                ];
                if (deltaE(center.lab, newLab) > 0.5) changed = true;
                center.lab = newLab;
            }
        }
        if (!changed) break;
    }

    // Filter empty clusters
    const validCenters = centers.filter(c => c.count > 0);
    if (validCenters.length === 0) return undefined;

    // Background is most frequent
    validCenters.sort((a, b) => b.count - a.count);
    const bgCluster = validCenters[0];
    const bgRgb: [number, number, number] = [
        Math.round(bgCluster.rgbSum[0] / bgCluster.count),
        Math.round(bgCluster.rgbSum[1] / bgCluster.count),
        Math.round(bgCluster.rgbSum[2] / bgCluster.count)
    ];

    if (validCenters.length === 1) {
        return {
            background: bgRgb,
            standout: bgRgb,
            deltaE: 0
        };
    }

    // Standout using Salience Score
    let bestStandout = validCenters[1];
    let maxSalience = -Infinity;

    for (let i = 1; i < validCenters.length; i++) {
        const cluster = validCenters[i];
        const dist = deltaE(bgCluster.lab, cluster.lab);
        const chroma = getChroma(cluster.lab);
        const salience = dist * (chroma + 15);
        if (salience > maxSalience) {
            maxSalience = salience;
            bestStandout = cluster;
        }
    }

    const stRgb: [number, number, number] = [
        Math.round(bestStandout.rgbSum[0] / bestStandout.count),
        Math.round(bestStandout.rgbSum[1] / bestStandout.count),
        Math.round(bestStandout.rgbSum[2] / bestStandout.count)
    ];

    return {
        background: bgRgb,
        standout: stRgb,
        deltaE: deltaE(bgCluster.lab, bestStandout.lab)
    };
}


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

/**
 * Determines if a color palette is predominantly bright/light.
 * Useful for selecting contrasting overlay colors (e.g. for Media Session artwork).
 */
export function isPaletteBright(palette: number[] | undefined): boolean {
    if (!palette || palette.length === 0) return false;

    // Calculate Average Lightness
    let totalL = 0;
    for (const packed of palette) {
        const { r, g, b } = unpackColorToRGB(packed);
        totalL += rgbToL(r, g, b);
    }
    const avgL = totalL / palette.length;

    // Threshold of 55 matches the "Hard Black" cutoff in getOptimizedTextColor
    return avgL > 55;
}
