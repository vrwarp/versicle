/**
 * Default image probe for cover validation (no library — keeps the import
 * graph lean).
 *
 * Decoding a full-size cover just to measure it is expensive: a 4400×6800
 * jacket scan is ~120 MB of pixels, and the Drive preview probes covers for
 * a whole library. So the true pixel size comes from the file HEADER
 * (PNG/JPEG/GIF/WebP), and the decode — which proves the bytes are a real
 * image and applies EXIF orientation — runs at a tiny `resizeWidth`. The
 * header size is unrotated; the decoded thumbnail's aspect says which way
 * up it is.
 *
 * Returns 'unknown' where decoding isn't available (jsdom, very old
 * WebViews) and for SVG, which `createImageBitmap` cannot take as a Blob.
 */
import type { ImageProbe } from './coverResolver';

interface Size {
  width: number;
  height: number;
}

const HEADER_BYTES = 64 * 1024;

function pngSize(b: Uint8Array, v: DataView): Size | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((x, i) => b[i] === x)) return null;
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function gifSize(b: Uint8Array, v: DataView): Size | null {
  if (b.length < 10 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
}

function jpegSize(b: Uint8Array, v: DataView): Size | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array, v: DataView): Size | null {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const chunk = tag(12);
  if (chunk === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = v.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

/** Pixel size from the image header, or null for an unrecognised format. */
export async function readImageSize(blob: Blob): Promise<Size | null> {
  const bytes = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    return pngSize(bytes, view) ?? gifSize(bytes, view) ?? jpegSize(bytes, view) ?? webpSize(bytes, view);
  } catch {
    return null;
  }
}

export const probeImage: ImageProbe = async (blob) => {
  if (typeof createImageBitmap !== 'function' || /svg/i.test(blob.type)) return 'unknown';
  const header = await readImageSize(blob).catch(() => null);
  try {
    // With a known size, decode a thumbnail only; otherwise the decode IS
    // the measurement.
    const bitmap = await createImageBitmap(blob, header ? { resizeWidth: 64, resizeQuality: 'low' } : undefined);
    const shown = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    if (!header) return shown;
    const long = Math.max(header.width, header.height);
    const short = Math.min(header.width, header.height);
    if (shown.width === shown.height) return header;
    return shown.height > shown.width ? { width: short, height: long } : { width: long, height: short };
  } catch {
    return 'undecodable';
  }
};
