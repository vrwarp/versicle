/**
 * Recovery settings panel (Phase 8 §B): checkpoint listing/creation wiring
 * for the presentational RecoverySettingsTab, moved verbatim from the
 * deleted GlobalSettingsDialog (including the unmount-safe listing the
 * predictability regression pinned — see SettingsShell.test.tsx).
 */
import React, { useEffect, useState } from 'react';
import { CheckpointService } from '@domains/sync/checkpoints/CheckpointService';
import { useToastStore } from '@store/useToastStore';
import { RecoverySettingsTab } from '@components/settings';
import { createLogger } from '@lib/logger';

const logger = createLogger('RecoveryPanel');

const RecoveryPanel: React.FC = () => {
  const showToast = useToastStore((state) => state.showToast);
  const [checkpoints, setCheckpoints] = useState<Awaited<ReturnType<typeof CheckpointService.listCheckpoints>>>([]);

  useEffect(() => {
    let ignore = false;
    CheckpointService.listCheckpoints().then(list => {
      if (!ignore) {
        setCheckpoints(list);
      }
    });
    return () => { ignore = true; };
  }, []);

  const handleCreateCheckpoint = async () => {
    try {
      await CheckpointService.createCheckpoint('manual');
      const list = await CheckpointService.listCheckpoints();
      setCheckpoints(list);
      showToast('Snapshot created', 'success');
    } catch (e) {
      logger.error('Failed to create checkpoint', e);
      showToast('Failed to create snapshot', 'error');
    }
  };

  return (
    <RecoverySettingsTab
      checkpoints={checkpoints}
      recoveryStatus={null}
      onCreateCheckpoint={handleCreateCheckpoint}
    />
  );
};

export default RecoveryPanel;
