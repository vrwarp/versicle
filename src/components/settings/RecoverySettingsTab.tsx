import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { FileSearch } from 'lucide-react';
import { CheckpointService } from '../../lib/sync/CheckpointService';
import { CheckpointInspector, type DiffResult } from '../../lib/sync/CheckpointInspector';
import { CheckpointDiffView } from './CheckpointDiffView';
import type { SyncCheckpoint } from '../../types/db';

export interface RecoverySettingsTabProps {
    checkpoints: SyncCheckpoint[];
    recoveryStatus: string | null;
    onCreateCheckpoint?: () => void;
}

export const RecoverySettingsTab: React.FC<RecoverySettingsTabProps> = ({
    checkpoints,
    recoveryStatus: initialStatus,
    onCreateCheckpoint
}) => {
    const [inspectingCheckpoint, setInspectingCheckpoint] = useState<SyncCheckpoint | null>(null);
    const [diffData, setDiffData] = useState<Record<string, DiffResult> | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const [status, setStatus] = useState<string | null>(initialStatus);

    const handleInspect = async (checkpoint: SyncCheckpoint) => {
        setStatus("Analyzing checkpoint...");
        try {
            // Calculate Diff
            const diff = CheckpointInspector.diffCheckpoint(checkpoint.blob);
            setDiffData(diff);
            setInspectingCheckpoint(checkpoint);
            setStatus(null);
        } catch (error) {
            console.error(error);
            setStatus("Failed to inspect checkpoint.");
        }
    };

    const handleConfirmRestore = async () => {
        if (!inspectingCheckpoint) return;

        setIsRestoring(true);
        setStatus("Restoring...");
        try {
            await CheckpointService.restoreCheckpoint(inspectingCheckpoint.id);
            setStatus("Restore complete. Reloading...");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            console.error(error);
            setStatus("Restore failed.");
            setIsRestoring(false);
        }
    };

    const handleCancelInspect = () => {
        setInspectingCheckpoint(null);
        setDiffData(null);
        setStatus(null);
    };

    if (inspectingCheckpoint && diffData) {
        return (
            <CheckpointDiffView
                diffData={diffData}
                onConfirm={handleConfirmRestore}
                onCancel={handleCancelInspect}
                isRestoring={isRestoring}
            />
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium">Disaster Recovery</h3>
                    {onCreateCheckpoint && (
                        <Button size="sm" onClick={onCreateCheckpoint}>
                            Create Snapshot
                        </Button>
                    )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                    Restore your library state from local checkpoints. Checkpoints are created automatically before sync.
                </p>
                {status && (
                    <div className="mb-4 p-2 bg-muted text-sm rounded animate-pulse">
                        {status}
                    </div>
                )}
                <div className="space-y-2">
                    {checkpoints.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No checkpoints available.</p>
                    ) : (
                        checkpoints.map((cp) => (
                            <div key={cp.id} className="flex items-center justify-between p-3 border rounded-md">
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">
                                        {new Date(cp.timestamp).toLocaleString()}
                                    </span>
                                    <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                                        <span className="capitalize bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground">
                                            {cp.trigger}
                                        </span>
                                        <span className="py-0.5">{cp.size} KB</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                     <Button size="sm" variant="outline" onClick={() => handleInspect(cp)}>
                                        <FileSearch className="h-4 w-4 mr-2" />
                                        Inspect
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
