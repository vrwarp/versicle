/**
 * "Sync diagnostics" card on the Diagnostics settings panel: one button that
 * collects the sync diagnostics report (src/app/sync/diagnostics) and
 * exports it gzip-compressed — the share sheet on Android/iOS, a download
 * on the web. Export one file per device and compare them side by side.
 *
 * The collector is dynamically imported on click so the settings chunk does
 * not carry it.
 */
import React, { useState } from 'react';
import { CloudCog, Download } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { formatBytes } from '@kernel/locale/format';

/** "Build abc1234 · 2026-10-04 14:02" — which bundle this device runs. */
function buildLabel(): string {
  if (typeof __VERSICLE_BUILD__ === 'undefined') return 'Build unknown';
  const { sha, dirty, time } = __VERSICLE_BUILD__;
  const short = sha === 'unknown' ? 'unknown' : sha.slice(0, 7);
  return `Build ${short}${dirty ? '+local' : ''} · ${time.slice(0, 16).replace('T', ' ')} UTC`;
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; filename: string; bytes: number }
  | { kind: 'error'; message: string };

export const SyncDiagnosticsSection: React.FC = () => {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });

  const handleExport = async () => {
    setState({ kind: 'busy' });
    try {
      const { exportSyncDiagnostics } = await import('@app/sync/diagnostics/export');
      const result = await exportSyncDiagnostics();
      setState({ kind: 'done', filename: result.filename, bytes: result.exportedBytes });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="bg-muted/50 p-4 rounded-xl border border-border space-y-3" data-testid="sync-diagnostics-section">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <CloudCog className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Sync diagnostics</h3>
            <p className="text-sm text-muted-foreground">
              Connection state, recent sync activity, and a layer-by-layer check of the
              sync libraries: app state, this device's storage and the cloud copy.
            </p>
          </div>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handleExport}
          disabled={state.kind === 'busy'}
          className="gap-2"
          data-testid="sync-diagnostics-export"
        >
          <Download className="w-4 h-4" />
          {state.kind === 'busy' ? 'Collecting…' : 'Export sync diagnostics'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Export on each device that is not syncing, at about the same time, while online —
        collecting downloads a fresh copy of your cloud library to compare against and can
        take up to 30 seconds. The file is compressed (.json.gz) and contains no book text
        or notes — only IDs, timestamps, content hashes and logs. Your email is masked.
      </p>
      <p className="text-xs text-muted-foreground font-mono" data-testid="sync-diagnostics-build">
        {buildLabel()}
      </p>
      {state.kind === 'done' && (
        <p className="text-xs text-primary" role="status">
          Exported {state.filename} ({formatBytes(state.bytes)}).
        </p>
      )}
      {state.kind === 'error' && (
        <p className="text-xs text-destructive" role="alert">
          Export failed: {state.message}
        </p>
      )}
    </div>
  );
};
