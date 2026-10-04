/**
 * Export the sync diagnostics report as a gzip-compressed JSON file
 * (`.json.gz`), via the shared exportFile path: the native share sheet on
 * Android/iOS, a browser download on the web. Falls back to plain `.json`
 * where the platform has no CompressionStream (pre-16.4 Safari).
 */
import { getDeviceId } from '@lib/device-id';
import { collectSyncDiagnostics } from './collect';

/** gzip a string with the platform CompressionStream; null when unavailable. */
export async function gzipString(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined' || typeof ReadableStream === 'undefined') return null;
  const input = new TextEncoder().encode(text);
  const reader = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  })
    .pipeThrough(new CompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: 'application/gzip' });
}

export interface SyncDiagnosticsExportResult {
  filename: string;
  rawBytes: number;
  exportedBytes: number;
  compressed: boolean;
}

export async function exportSyncDiagnostics(): Promise<SyncDiagnosticsExportResult> {
  const report = await collectSyncDiagnostics();
  const json = JSON.stringify(report);
  const env = report.environment as { platform?: string } | undefined;
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = `versicle-sync-${env?.platform ?? 'unknown'}-${getDeviceId().replace(/^device-/, '').slice(0, 8)}-${stamp}`;

  const rawBytes = new Blob([json]).size;
  const gz = await gzipString(json).catch(() => null);
  const { exportFile } = await import('@lib/export');
  if (gz) {
    const filename = `${base}.json.gz`;
    await exportFile({ filename, data: gz, mimeType: 'application/gzip' });
    return { filename, rawBytes, exportedBytes: gz.size, compressed: true };
  }
  const filename = `${base}.json`;
  await exportFile({ filename, data: json, mimeType: 'application/json' });
  return { filename, rawBytes, exportedBytes: rawBytes, compressed: false };
}
