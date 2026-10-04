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

import { SyncDiagnosticsSection } from './SyncDiagnosticsSection';

beforeEach(() => {
  stub.calls = 0;
});

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

  it('surfaces a failed export', async () => {
    stub.impl = async () => {
      throw new Error('Failed to export file on device');
    };
    render(<SyncDiagnosticsSection />);

    fireEvent.click(screen.getByTestId('sync-diagnostics-export'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to export file on device');
  });
});
