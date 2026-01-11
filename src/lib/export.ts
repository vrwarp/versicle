import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { saveAs } from 'file-saver';

interface ExportOptions {
  filename: string;
  data: string | Blob;
  mimeType?: string;
}

/**
 * Unified export function that handles both Web (download) and Native (share) workflows.
 */
export async function exportFile({ filename, data, mimeType = 'text/plain' }: ExportOptions): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Convert Blob to Base64 if necessary
      let dataToWrite: string;

      if (data instanceof Blob) {
        dataToWrite = await blobToBase64(data);
      } else {
        dataToWrite = data; // Assume string is text content
      }

      // 2. Write to Cache (no permission needed)
      const path = filename;
      await Filesystem.writeFile({
        path,
        data: dataToWrite,
        directory: Directory.Cache,
        encoding: data instanceof Blob ? undefined : Encoding.UTF8 // Binary for blobs, UTF8 for text
      });

      // 3. Get URI and Share
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
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
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
