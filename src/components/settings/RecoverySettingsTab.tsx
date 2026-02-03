import React from 'react';
import { Button } from '../ui/Button';
import { RotateCcw } from 'lucide-react';

export interface Checkpoint {
    id: number;
    timestamp: number;
    trigger: string;
}

export interface RecoverySettingsTabProps {
    checkpoints: Checkpoint[];
    recoveryStatus: string | null;
    onRestoreCheckpoint: (id: number) => void;
}

export const RecoverySettingsTab: React.FC<RecoverySettingsTabProps> = ({
    checkpoints,
    recoveryStatus,
    onRestoreCheckpoint
}) => {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-4">Disaster Recovery</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Restore your library state from local checkpoints. Checkpoints are created automatically before sync.
                </p>
                {recoveryStatus && (
                    <div className="mb-4 p-2 bg-muted text-sm rounded">
                        {recoveryStatus}
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
                                    <span className="text-xs text-muted-foreground capitalize">
                                        Trigger: {cp.trigger}
                                    </span>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => onRestoreCheckpoint(cp.id)}>
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    Restore
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
