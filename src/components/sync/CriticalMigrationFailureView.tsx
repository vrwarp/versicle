import React from 'react';
import { Button } from '../ui/Button';
import { MigrationStateService } from '../../lib/sync/MigrationStateService';
import { createLogger } from '../../lib/logger';

const logger = createLogger('CriticalMigrationFailure');

interface CriticalMigrationFailureViewProps {
    backupId?: number;
}

/**
 * Rendered by ErrorBoundary when a crash occurs during AWAITING_CONFIRMATION,
 * indicating the downloaded remote state is incompatible with the current UI.
 */
export const CriticalMigrationFailureView: React.FC<CriticalMigrationFailureViewProps> = ({ backupId }) => {
    const [isRollingBack, setIsRollingBack] = React.useState(false);

    const handleRollback = async () => {
        setIsRollingBack(true);
        try {
            if (backupId != null) {
                MigrationStateService.setState({
                    status: 'RESTORING_BACKUP',
                    backupCheckpointId: backupId,
                });
                window.location.reload();
            } else {
                // No backup ID — just clear state and reload
                logger.error('No backup ID available for rollback');
                MigrationStateService.clear();
                window.location.reload();
            }
        } catch (e) {
            logger.error('Rollback failed:', e);
            setIsRollingBack(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background text-foreground text-center">
            <div className="max-w-md space-y-6">
                <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <h2 className="text-xl font-bold text-destructive mb-2">
                        Workspace Switch Failed
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        The remote workspace data is incompatible with this version of the app
                        and caused a crash. Your previous data is safely backed up.
                    </p>
                </div>

                <Button
                    onClick={handleRollback}
                    disabled={isRollingBack}
                    variant="default"
                    className="w-full"
                >
                    {isRollingBack ? 'Rolling back...' : 'Restore Previous Data'}
                </Button>

                <p className="text-xs text-muted-foreground">
                    This will restore your data to the state before the workspace switch.
                </p>
            </div>
        </div>
    );
};
