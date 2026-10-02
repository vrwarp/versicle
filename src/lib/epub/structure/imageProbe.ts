/**
 * Default image probe for cover validation: decode with the platform's
 * `createImageBitmap` (no library — keeps the eager import graph lean).
 * Returns 'unknown' where decoding isn't available (jsdom, very old
 * WebViews) and for SVG, which `createImageBitmap` cannot take as a Blob.
 */
import type { ImageProbe } from './coverResolver';

export const probeImage: ImageProbe = async (blob) => {
  if (typeof createImageBitmap !== 'function' || /svg/i.test(blob.type)) return 'unknown';
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return 'undecodable';
  }
};
