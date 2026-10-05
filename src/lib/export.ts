import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { saveAs } from 'file-saver';

interface ExportOptions {
  filename: string;
  data: string | Blob;
  mimeType?: string;
}

/**
 * Bytes written per Filesystem bridge call on native platforms.
 *
 * Every Capacitor call is serialized as ONE JSON message that the Android
 * side parses on the Java heap (org.json → UTF-16 strings, several copies),
 * and that heap is capped at 256MB on many phones. Writing a large export in
 * a single `writeFile` OOM-killed the app (a ~70MB light-backup JSON needed a
 * 118MB allocation just to parse the message). Chunks keep each message
 * small. A multiple of 3 so every chunk base64-encodes without padding.
 */
export const NATIVE_WRITE_CHUNK_BYTES = 3 * 512 * 1024;

/**
 * Unified export function that handles both Web (download) and Native (share) workflows.
 */
export async function exportFile({ filename, data, mimeType = 'text/plain' }: ExportOptions): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Write to Cache (no permission needed) in bounded chunks — see
      //    NATIVE_WRITE_CHUNK_BYTES. Everything goes over as base64 binary
      //    (no `encoding`), so text is written as its UTF-8 bytes and a chunk
      //    boundary can never split a character.
      const path = filename;
      let offset = 0;
      do {
        const chunk = await blobToBase64(blob.slice(offset, offset + NATIVE_WRITE_CHUNK_BYTES));
        const options = { path, data: chunk, directory: Directory.Cache };
        if (offset === 0) {
          await Filesystem.writeFile(options);
        } else {
          await Filesystem.appendFile(options);
        }
        offset += NATIVE_WRITE_CHUNK_BYTES;
      } while (offset < blob.size);

      // 2. Get URI and Share
      const uriResult = await Filesystem.getUri({
        directory: Directory.Cache,
        path
      });

      await Share.share({
        title: `Export ${filename}`,
        files: [uriResult.uri],
      });

    } catch (e) {
      console.error('Native export failed', e);
      throw new Error('Failed to export file on device');
    }
  } else {
    // Web Fallback
    saveAs(blob, filename);
  }
}

// Helper to convert Blob to Base64 string (required for Capacitor Filesystem binary write)
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:application/octet-stream;base64,....."
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
