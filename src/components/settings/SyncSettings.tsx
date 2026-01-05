import { useEffect } from 'react';
import { useSyncStore } from '../../store/useSyncStore';
import { Button } from '../ui/Button';
import { Cloud, CloudOff, RefreshCw, History } from 'lucide-react';

export const SyncSettings = () => {
    const {
        isAuthorized,
        authorize,
        disconnect,
        sync,
        isSyncing,
        syncStatus,
        lastSyncTime,
        errorMessage,
        checkpoints,
        fetchCheckpoints,
        restoreCheckpoint,
        createCheckpoint
    } = useSyncStore();

    useEffect(() => {
        fetchCheckpoints();
    }, [fetchCheckpoints]);

    const handleRestore = async (timestamp: number) => {
        if (confirm('Are you sure you want to restore this checkpoint? Current data will be replaced.')) {
            try {
                await restoreCheckpoint(timestamp);
                alert('Restoration complete. The app will now reload.');
                window.location.reload();
            } catch (error) {
                alert('Restoration failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
        }
    };

    const handleManualCheckpoint = async () => {
        await createCheckpoint('Manual User Checkpoint');
    };

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <h3 className="text-lg font-medium">Cloud Synchronization</h3>
                <p className="text-sm text-muted-foreground">
                    Sync your reading progress and highlights across devices using Google Drive.
                </p>

                <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            {isAuthorized ? (
                                <Cloud className="h-5 w-5 text-primary" />
                            ) : (
                                <CloudOff className="h-5 w-5 text-muted-foreground" />
                            )}
                            <span className="font-medium">
                                {isAuthorized ? 'Connected to Google Drive' : 'Not Connected'}
                            </span>
                        </div>
                        {isAuthorized ? (
                            <Button variant="outline" size="sm" onClick={disconnect}>
                                Disconnect
                            </Button>
                        ) : (
                            <Button variant="default" size="sm" onClick={authorize}>
                                Connect
                            </Button>
                        )}
                    </div>

                    {isAuthorized && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <div className="space-y-1">
                                <div className="text-sm font-medium">Sync Status</div>
                                <div className="text-xs text-muted-foreground">
                                    {isSyncing ? 'Syncing...' :
                                     syncStatus === 'success' ? `Last synced: ${lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never'}` :
                                     syncStatus === 'error' ? 'Sync Failed' : 'Idle'}
                                </div>
                                {errorMessage && (
                                    <div className="text-xs text-destructive">{errorMessage}</div>
                                )}
                            </div>
                            <Button onClick={sync} disabled={isSyncing} variant="secondary">
                                {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                Sync Now
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">Data Recovery (Checkpoints)</h3>
                    <Button variant="outline" size="sm" onClick={handleManualCheckpoint}>
                        Create Checkpoint
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                    Local snapshots of your data are created automatically before every sync.
                </p>

                <div className="bg-muted p-2 rounded-md h-60 overflow-y-auto">
                    {checkpoints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <History className="h-8 w-8 mb-2 opacity-50" />
                            <span className="text-sm">No checkpoints available.</span>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {checkpoints.map((cp) => (
                                <div key={cp.timestamp} className="bg-background p-3 rounded border flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium">
                                            {new Date(cp.timestamp).toLocaleString()}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {cp.reason} • {Math.round(cp.size / 1024)} KB
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => handleRestore(cp.timestamp)}
                                    >
                                        Restore
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
