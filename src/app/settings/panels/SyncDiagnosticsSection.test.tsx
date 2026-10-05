import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// A plain stub (not vi.fn): the component's own try/catch is what is under
// test, and the failure case must reach it as an ordinary rejected promise.
const stub = vi.hoisted(() => ({
  calls: 0,
  impl: async (): Promise<unknown> => undefined,
}));
vi.mock('@app/sync/diagnostics/export', () => ({
  exportSyncDiagnostics: () => {
    stub.calls++;
    return stub.impl();
  },
}));

const repairStub = vi.hoisted(() => ({
  calls: 0,
  impl: async (): Promise<unknown> => ({ ok: true, uploaded: false, bytes: 0, clientsBehind: [], cloudPendingBefore: null, cloudPendingAfter: null, ms: 1 }),
}));
vi.mock('@app/sync/diagnostics/repair', () => ({
  repairCloudCopy: () => {
    repairStub.calls++;
    return repairStub.impl();
  },
}));

import { ConfirmHost } from '@components/ui/ConfirmDialog';
import { SyncDiagnosticsSection } from './SyncDiagnosticsSection';

beforeEach(() => {
  stub.calls = 0;
  repairStub.calls = 0;
});

const renderWithConfirm = () =>
  render(
    <>
      <SyncDiagnosticsSection />
      <ConfirmHost />
    </>
  );

describe('SyncDiagnosticsSection', () => {
  it('exports and reports the file name', async () => {
    stub.impl = async () => ({
      filename: 'versicle-sync-android-abc.json.gz',
      rawBytes: 9000,
      exportedBytes: 1200,
      compressed: true,
    });
    render(<SyncDiagnosticsSection />);

    fireEvent.click(screen.getByTestId('sync-diagnostics-export'));

    expect(await screen.findByRole('status')).toHaveTextContent('versicle-sync-android-abc.json.gz');
    expect(stub.calls).toBe(1);
  });

  it('shows which build this device runs (unknown under vitest: no define)', () => {
    render(<SyncDiagnosticsSection />);
    expect(screen.getByTestId('sync-diagnostics-build')).toHaveTextContent('Build unknown');
  });

  it('surfaces a failed export', async () => {
    stub.impl = async () => {
      throw new Error('Failed to export file on device');
    };
    render(<SyncDiagnosticsSection />);

    fireEvent.click(screen.getByTestId('sync-diagnostics-export'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to export file on device');
  });

  describe('Repair (re-upload what the cloud is missing)', () => {
    it('does nothing when the confirmation is cancelled', async () => {
      renderWithConfirm();
      fireEvent.click(screen.getByTestId('sync-diagnostics-repair'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-cancel'));
      await new Promise((r) => setTimeout(r, 0));
      expect(repairStub.calls).toBe(0);
    });

    it('reports how much it uploaded', async () => {
      repairStub.impl = async () => ({
        ok: true, uploaded: true, bytes: 4096, clientsBehind: [{ client: 1, cloud: 3, local: 9 }],
        cloudPendingBefore: { 1: 3 }, cloudPendingAfter: null, ms: 900,
      });
      renderWithConfirm();
      fireEvent.click(screen.getByTestId('sync-diagnostics-repair'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
      expect(await screen.findByTestId('sync-diagnostics-repair-result')).toHaveTextContent(/^Uploaded .+ the cloud was missing/);
      expect(repairStub.calls).toBe(1);
    });

    it('says so when there was nothing to repair', async () => {
      repairStub.impl = async () => ({
        ok: true, uploaded: false, bytes: 0, clientsBehind: [], cloudPendingBefore: null, cloudPendingAfter: null, ms: 5,
      });
      renderWithConfirm();
      fireEvent.click(screen.getByTestId('sync-diagnostics-repair'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
      expect(await screen.findByTestId('sync-diagnostics-repair-result')).toHaveTextContent('Nothing to repair');
    });

    it('surfaces a failure', async () => {
      repairStub.impl = async () => ({ ok: false, error: 'Cloud download timed out after 30000ms', ms: 30000 });
      renderWithConfirm();
      fireEvent.click(screen.getByTestId('sync-diagnostics-repair'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
      expect(await screen.findByTestId('sync-diagnostics-repair-result')).toHaveTextContent('Repair failed: Cloud download timed out');
    });
  });
});
