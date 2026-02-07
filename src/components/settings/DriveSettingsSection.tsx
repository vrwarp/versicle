import React, { useState } from 'react';
import { useDriveStore } from '../../store/useDriveStore';
import { GoogleDriveService } from '../../lib/drive/GoogleDriveService';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Loader2, RefreshCw, Unlink, ExternalLink, Check, FolderSearch, AlertCircle } from 'lucide-react';
import { useToastStore } from '../../store/useToastStore';
import { createLogger } from '../../lib/logger';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('DriveSettingsSection');

export const DriveSettingsSection: React.FC = () => {
    const {
        accessToken,
        folderId,
        files,
        lastScanTime,
        setAccessToken,
        setFolderId,
        setFiles,
        disconnect
    } = useDriveStore(useShallow(state => ({
        accessToken: state.accessToken,
        folderId: state.folderId,
        files: state.files,
        lastScanTime: state.lastScanTime,
        setAccessToken: state.setAccessToken,
        setFolderId: state.setFolderId,
        setFiles: state.setFiles,
        disconnect: state.disconnect
    })));

    const showToast = useToastStore(state => state.showToast);

    const [isConnecting, setIsConnecting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [folderInput, setFolderInput] = useState('');

    const handleConnect = async () => {
        setIsConnecting(true);
        try {
            const token = await GoogleDriveService.authenticate();
            if (token) {
                setAccessToken(token);
                showToast('Connected to Google Drive', 'success');
            } else {
                // Redirect flow initiated
                showToast('Redirecting to Google Sign-In...', 'info');
            }
        } catch (error) {
            logger.error('Connect failed', error);
            showToast('Failed to connect to Drive', 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleScan = async () => {
        if (!accessToken || !folderId) return;

        setIsScanning(true);
        try {
            const fileList = await GoogleDriveService.listFiles(folderId, accessToken);
            setFiles(fileList);
            showToast(`Found ${fileList.length} EPUBs`, 'success');
        } catch (error) {
            logger.error('Scan failed', error);
            showToast('Failed to scan folder. Token may be expired.', 'error');
            // Optional: prompt re-auth?
        } finally {
            setIsScanning(false);
        }
    };

    const handleSetFolder = () => {
        const extractedId = GoogleDriveService.extractFolderId(folderInput);
        if (extractedId) {
            setFolderId(extractedId);
            setFolderInput('');
            showToast('Folder ID set', 'success');
        } else {
            showToast('Invalid folder link or ID', 'error');
        }
    };

    const handleDisconnect = () => {
        if (confirm('Disconnect Google Drive integration? This will clear the folder setting.')) {
            disconnect();
            showToast('Disconnected', 'info');
        }
    };

    const hasToken = !!accessToken;

    return (
        <div className="space-y-6 border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center gap-2 mb-2">
                <FolderSearch className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-medium">Google Drive Integration</h3>
            </div>

            <p className="text-sm text-muted-foreground">
                Connect a shared Google Drive folder to import EPUBs directly.
            </p>

            {!hasToken ? (
                <div className="space-y-4">
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md flex gap-2 items-start">
                        <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-yellow-800 dark:text-yellow-400">
                            <p className="font-medium">Drive Not Connected</p>
                            <p>You need to grant read-only access to scan folders.</p>
                        </div>
                    </div>

                    <Button
                        onClick={handleConnect}
                        disabled={isConnecting}
                        className="w-full sm:w-auto"
                    >
                        {isConnecting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Connecting...
                            </>
                        ) : (
                            <>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Connect Drive
                            </>
                        )}
                    </Button>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Status Banner */}
                    <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                        <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium text-green-700 dark:text-green-400">
                                Connected (Token Active)
                            </span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleDisconnect} className="h-8 text-destructive hover:text-destructive">
                            <Unlink className="h-4 w-4 mr-2" />
                            Disconnect
                        </Button>
                    </div>

                    {/* Folder Setup */}
                    <div className="space-y-3">
                        <Label htmlFor="drive-folder-input">Shared Folder Link or ID</Label>

                        {!folderId ? (
                            <div className="flex gap-2">
                                <Input
                                    id="drive-folder-input"
                                    placeholder="https://drive.google.com/..."
                                    value={folderInput}
                                    onChange={(e) => setFolderInput(e.target.value)}
                                />
                                <Button onClick={handleSetFolder} variant="secondary">
                                    Set
                                </Button>
                            </div>
                        ) : (
                            <div className="p-3 border rounded-md bg-background flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">Current Folder ID</p>
                                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px] sm:max-w-xs">
                                        {folderId}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => setFolderId(null)}>
                                    Change
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Scan Action */}
                    {folderId && (
                        <div className="space-y-2 pt-2 border-t">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium">Scanned Files: {files.length}</p>
                                    {lastScanTime && (
                                        <p className="text-xs text-muted-foreground">
                                            Last scan: {new Date(lastScanTime).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <Button onClick={handleScan} disabled={isScanning} size="sm">
                                    {isScanning ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                    )}
                                    Scan Now
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
