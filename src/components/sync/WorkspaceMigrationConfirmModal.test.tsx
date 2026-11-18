import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceMigrationConfirmModal } from './WorkspaceMigrationConfirmModal';

const {
  clearMigrationMock,
  setRestoringBackupMock,
  deleteCheckpointMock,
  clearStagedStateMock,
  startSyncMock,
} = vi.hoisted(() => ({
  clearMigrationMock: vi.fn(),
  setRestoringBackupMock: vi.fn(),
  deleteCheckpointMock: vi.fn(),
  clearStagedStateMock: vi.fn(),
  startSyncMock: vi.fn(),
}));

vi.mock('@domains/sync/workspaces/MigrationStateService', () => ({
  MigrationStateService: {
    clear: clearMigrationMock,
    setRestoringBackup: setRestoringBackupMock,
  },
}));

vi.mock('@domains/sync/checkpoints/CheckpointService', () => ({
  CheckpointService: {
    deleteCheckpoint: deleteCheckpointMock,
  },
}));

vi.mock('@domains/sync/workspaces/stagedSwap', () => ({
  clearStagedState: clearStagedStateMock,
}));

vi.mock('@app/sync/createSync', () => ({
  getSyncOrchestratorAsync: () => Promise.resolve({ start: startSyncMock }),
}));

describe('WorkspaceMigrationConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCheckpointMock.mockResolvedValue(undefined);
    clearStagedStateMock.mockResolvedValue(undefined);
  });

  describe('regression: single button spinner on workspace confirmation', () => {
    it('spins only the Finalize button while async cleanup is in flight', async () => {
      let resolveDelete!: () => void;
      deleteCheckpointMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          }),
      );
      const onResolved = vi.fn();

      const { container } = render(
        <WorkspaceMigrationConfirmModal
          targetWorkspaceId="ws-seminary"
          backupCheckpointId={7}
          onResolved={onResolved}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Yes, Finalize' }));

      const finalizeBtn = screen.getByRole('button', { name: 'Finalizing...' });
      const rollbackBtn = screen.getByRole('button', { name: 'Roll Back' });

      expect(finalizeBtn).toBeDisabled();
      expect(rollbackBtn).toBeDisabled();
      expect(finalizeBtn.querySelector('.animate-spin')).toBeInTheDocument();
      expect(rollbackBtn.querySelector('.animate-spin')).not.toBeInTheDocument();
      expect(container.querySelectorAll('.animate-spin')).toHaveLength(1);

      resolveDelete();
      await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    });
  });
});
