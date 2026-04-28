import React from 'react';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';
import { MigrationStateService } from '../../lib/sync/MigrationStateService';
import { CheckpointService } from '../../lib/sync/CheckpointService';
import { getFirestoreSyncManager } from '../../lib/sync/FirestoreSyncManager';
import { createLogger } from '../../lib/logger';

const logger = createLogger('WorkspaceMigrationConfirm');

interface WorkspaceMigrationConfirmModalProps {
    targetWorkspaceId: string;
    backupCheckpointId: number;
    onResolved: () => void;
}

/**
 * Modal overlay shown after reload during workspace switch.
 * Asks the user to finalize or rollback the workspace connection.
 */
export const WorkspaceMigrationConfirmModal: React.FC<WorkspaceMigrationConfirmModalProps> = ({
    targetWorkspaceId,
    backupCheckpointId,
    onResolved,
}) => {
    const [isProcessing, setIsProcessing] = React.useState(false);

    const handleConfirm = async () => {
        setIsProcessing(true);
        try {
            // Clear migration state
            MigrationStateService.clear();

            // Delete the backup checkpoint
            try {
                await CheckpointService.deleteCheckpoint(backupCheckpointId);
                logger.info(`Deleted migration backup checkpoint #${backupCheckpointId}`);
            } catch (e) {
                logger.warn('Failed to delete backup checkpoint:', e);
            }

            // Initialize sync with the new workspace
            const manager = getFirestoreSyncManager();
            manager.initialize();

            onResolved();
        } catch (e) {
            logger.error('Failed to finalize workspace switch:', e);
            setIsProcessing(false);
        }
    };

    const handleReject = () => {
        setIsProcessing(true);
        MigrationStateService.setRestoringBackup();
        window.location.reload();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-background border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-xl space-y-4">
                <h2 className="text-lg font-semibold">Finalize Workspace Switch?</h2>
                <p className="text-sm text-muted-foreground">
                    You've switched to workspace <strong className="text-foreground">{targetWorkspaceId}</strong>.
                    Review the data below. If everything looks correct, finalize the connection.
                </p>
                <p className="text-xs text-muted-foreground">
                    If something looks wrong, you can roll back to your previous workspace data.
                </p>

                <div className="flex gap-3 pt-2">
                    <Button
                        onClick={handleConfirm}
                        disabled={isProcessing}
                        variant="default"
                        className="flex-1"
                    >
                        {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isProcessing ? 'Processing...' : 'Yes, Finalize'}
                    </Button>
                    <Button
                        onClick={handleReject}
                        disabled={isProcessing}
                        variant="outline"
                        className="flex-1"
                    >
                        {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        Roll Back
                    </Button>
                </div>
            </div>
        </div>
    );
};
