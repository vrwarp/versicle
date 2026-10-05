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
import { CloudCog, Download, Wrench } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useConfirm } from '@components/ui/ConfirmDialog';
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

type RepairState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export const SyncDiagnosticsSection: React.FC = () => {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const [repair, setRepair] = useState<RepairState>({ kind: 'idle' });
  const confirm = useConfirm();

  const handleRepair = async () => {
    if (!(await confirm({ titleKey: 'diagnostics.syncRepair.title', bodyKey: 'diagnostics.syncRepair.body' }))) {
      return;
    }
    setRepair({ kind: 'busy' });
    try {
      const { repairCloudCopy } = await import('@app/sync/diagnostics/repair');
      const result = await repairCloudCopy();
      if (!result.ok) {
        setRepair({ kind: 'error', message: result.error });
      } else if (!result.uploaded) {
        setRepair({ kind: 'done', message: 'Nothing to repair: the cloud already has everything on this device.' });
      } else {
        setRepair({
          kind: 'done',
          message: `Uploaded ${formatBytes(result.bytes)} the cloud was missing. Your other devices should catch up within a minute.`,
        });
      }
    } catch (error) {
      setRepair({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

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
      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Changes from this device not reaching your others? Re-upload what the cloud is missing.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRepair}
          disabled={repair.kind === 'busy'}
          className="gap-2 shrink-0"
          data-testid="sync-diagnostics-repair"
        >
          <Wrench className="w-4 h-4" />
          {repair.kind === 'busy' ? 'Repairing…' : 'Repair'}
        </Button>
      </div>
      {repair.kind === 'done' && (
        <p className="text-xs text-primary" role="status" data-testid="sync-diagnostics-repair-result">
          {repair.message}
        </p>
      )}
      {repair.kind === 'error' && (
        <p className="text-xs text-destructive" role="alert" data-testid="sync-diagnostics-repair-result">
          Repair failed: {repair.message}
        </p>
      )}
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
