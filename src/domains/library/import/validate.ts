/**
 * File-shape validation for the import pipeline's "validate" stage
 * (phase7-library-google.md §B). Moved verbatim from `src/lib/ingestion.ts`.
 */
import { createLogger } from '@lib/logger';

const logger = createLogger('Ingestion');

/** True when the file starts with the ZIP local-file-header magic (EPUBs are ZIPs). */
export async function validateZipSignature(file: File): Promise<boolean> {
  try {
    const buffer = await file.slice(0, 4).arrayBuffer();
    const view = new DataView(buffer);
    return (
      view.getUint8(0) === 0x50 &&
      view.getUint8(1) === 0x4b &&
      view.getUint8(2) === 0x03 &&
      view.getUint8(3) === 0x04
    );
  } catch (e) {
    logger.error('File validation failed', e);
    return false;
  }
}
