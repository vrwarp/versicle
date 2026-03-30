import React from 'react';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { PasswordInput } from '../ui/PasswordInput';
import { Button } from '../ui/Button';
import { Loader2, Trash2 } from 'lucide-react';

export interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
}

import { googleIntegrationManager } from '../../lib/google/GoogleIntegrationManager';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';
import type { FirebaseAuthStatus } from '../../lib/sync/FirestoreSyncManager';

export interface SyncSettingsTabProps {
    // Device
    currentDeviceId: string;
    currentDeviceName: string;
    onDeviceRename: (name: string) => void;
    // Firebase
    isFirebaseAvailable: boolean;
    firebaseAuthStatus: FirebaseAuthStatus;
    firestoreStatus: string;
    firebaseUserEmail: string | null;
    isFirebaseSigningIn: boolean;
    firebaseConfig: FirebaseConfig;
    onFirebaseConfigChange: (config: Partial<FirebaseConfig>) => void;
    onFirebaseSignIn: () => Promise<void>;
    onFirebaseSignOut: () => Promise<void>;
    onClearConfig: () => void;
}

import { Modal, ModalContent, ModalHeader, ModalTitle } from '../ui/Modal';
import { DriveFolderPicker } from '../drive/DriveFolderPicker';
import { useDriveStore } from '../../store/useDriveStore';
import { DriveScannerService } from '../../lib/drive/DriveScannerService';
import { useToastStore } from '../../store/useToastStore';
import { getFirestoreSyncManager, FirestoreSyncManager } from '../../lib/sync/FirestoreSyncManager';
import { useSyncStore } from '../../lib/sync/hooks/useSyncStore';
import { CURRENT_SCHEMA_VERSION } from '../../store/yjs-provider';
import type { WorkspaceMetadata } from '../../types/workspace';

export const SyncSettingsTab: React.FC<SyncSettingsTabProps> = ({
    currentDeviceId,
    currentDeviceName,
    onDeviceRename,
    isFirebaseAvailable,
    firebaseAuthStatus,
    firestoreStatus,
    firebaseUserEmail,
    isFirebaseSigningIn,
    firebaseConfig,
    onFirebaseConfigChange,
    onFirebaseSignIn,
    onFirebaseSignOut,
    onClearConfig
}) => {
    const parseFirebaseConfig = (text: string) => {
        const extractValue = (key: string): string => {
            const patterns = [
                new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`),
                new RegExp(`"${key}"\\s*:\\s*["']([^"']+)["']`),
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) return match[1];
            }
            return '';
        };

        const apiKey = extractValue('apiKey');
        const authDomain = extractValue('authDomain');
        const projectId = extractValue('projectId');
        const storageBucket = extractValue('storageBucket');
        const messagingSenderId = extractValue('messagingSenderId');
        const appId = extractValue('appId');
        const measurementId = extractValue('measurementId');

        if (apiKey || authDomain || projectId || appId) {
            onFirebaseConfigChange({
                ...(apiKey && { apiKey }),
                ...(authDomain && { authDomain }),
                ...(projectId && { projectId }),
                ...(storageBucket && { storageBucket }),
                ...(messagingSenderId && { messagingSenderId }),
                ...(appId && { appId }),
                ...(measurementId && { measurementId }),
            });
        }
    };

    // ... inside component ...
    const {
        isServiceConnected,
    } = useGoogleServicesStore();
    const [isDriveConnecting, setIsDriveConnecting] = React.useState(false);

    // Drive Folder Picker State
    const [isPickerOpen, setIsPickerOpen] = React.useState(false);
    const { linkedFolderName, setLinkedFolder } = useDriveStore();
    const [isScanning, setIsScanning] = React.useState(false);
    const { showToast } = useToastStore();

    // Workspace State
    const [workspaces, setWorkspaces] = React.useState<WorkspaceMetadata[]>([]);
    const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = React.useState('');
    const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
    const [isSwitchingWorkspace, setIsSwitchingWorkspace] = React.useState<string | null>(null);
    const [isDeletingWorkspace, setIsDeletingWorkspace] = React.useState<string | null>(null);
    const activeWorkspaceId = useSyncStore(state => state.activeWorkspaceId);

    // Load workspaces when signed in
    React.useEffect(() => {
        if (firebaseAuthStatus === 'signed-in') {
            setIsLoadingWorkspaces(true);
            getFirestoreSyncManager().listWorkspaces()
                .then(setWorkspaces)
                .catch(err => console.error('Failed to load workspaces:', err))
                .finally(() => setIsLoadingWorkspaces(false));
        }
    }, [firebaseAuthStatus]);

    const handleCreateWorkspace = async () => {
        if (!newWorkspaceName.trim()) return;
        setIsCreatingWorkspace(true);
        try {
            await getFirestoreSyncManager().createWorkspace(newWorkspaceName.trim());
            showToast(`Workspace "${newWorkspaceName.trim()}" created!`, 'success');
            setNewWorkspaceName('');
            // Refresh workspace list
            const updated = await getFirestoreSyncManager().listWorkspaces();
            setWorkspaces(updated);
        } catch (err) {
            console.error('Failed to create workspace:', err);
            showToast('Failed to create workspace.', 'error');
        } finally {
            setIsCreatingWorkspace(false);
        }
    };

    const handleSwitchWorkspace = async (workspaceId: string) => {
        setIsSwitchingWorkspace(workspaceId);
        try {
            await getFirestoreSyncManager().switchWorkspace(workspaceId);
            // switchWorkspace triggers reload, so this won't typically reach here
        } catch (err) {
            console.error('Failed to switch workspace:', err);
            setIsSwitchingWorkspace(null);
        }
    };

    const handleDeleteWorkspace = async (workspaceId: string, name: string) => {
        if (!confirm(`Are you sure you want to delete workspace "${name}"?\n\nThis will permanently reclaim cloud storage for this workspace. Your local data will be preserved but sync will be disabled for this workspace ID.`)) {
            return;
        }

        setIsDeletingWorkspace(workspaceId);
        try {
            await getFirestoreSyncManager().deleteWorkspace(workspaceId);
            showToast(`Workspace "${name}" deleted.`, 'success');
            // Refresh workspace list
            const updated = await getFirestoreSyncManager().listWorkspaces();
            setWorkspaces(updated);
        } catch (err) {
            console.error('Failed to delete workspace:', err);
            showToast('Failed to delete workspace.', 'error');
        } finally {
            setIsDeletingWorkspace(null);
        }
    };

    const handleFolderSelect = (id: string, name: string) => {
        setLinkedFolder(id, name);
        setIsPickerOpen(false);
    };

    const handleScan = async () => {
        if (!linkedFolderName) return;

        setIsScanning(true);
        try {
            const newFiles = await DriveScannerService.checkForNewFiles();
            if (newFiles.length > 0) {
                showToast(`Found ${newFiles.length} new books in "${linkedFolderName}".`, 'success');
            } else {
                showToast('No new books found.', 'info');
            }
        } catch (error) {
            console.error("Scan failed", error);
            showToast('Failed to scan for books.', 'error');
        } finally {
            setIsScanning(false);
        }
    };

    const handleDriveConnect = async () => {
        setIsDriveConnecting(true);
        try {
            // Pass login_hint if we have the firebase email to encourage same-account usage
            await googleIntegrationManager.connectService('drive', firebaseUserEmail || undefined);
        } catch (error) {
            console.error("Failed to connect Drive", error);
        } finally {
            setIsDriveConnecting(false);
        }
    };

    const handleDriveDisconnect = async () => {
        try {
            await googleIntegrationManager.disconnectService('drive');
            // Optionally clear linked folder on disconnect?
            // useDriveStore.getState().clearLinkedFolder();
        } catch (error) {
            console.error("Failed to disconnect Drive", error);
        }
    };

    const isDriveConnected = isServiceConnected('drive');

    // Device Name State
    const [localDeviceName, setLocalDeviceName] = React.useState(currentDeviceName);
    React.useEffect(() => {
        setLocalDeviceName(currentDeviceName);
    }, [currentDeviceName]);
    const hasDeviceNameChanged = localDeviceName !== currentDeviceName;

    return (
        <div className="space-y-8">
            {/* Section 1: App Sync */}
            <div>
                <h3 className="text-lg font-medium mb-4">App Sync</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Sync your reading progress, annotations, and reading list across devices.
                </p>

                {/* Device Identity */}
                <div className="space-y-4 mb-6 pb-6 border-b border-border">
                    <h4 className="text-sm font-medium">Device Identity</h4>
                    <div className="space-y-2">
                        <Label htmlFor="device-name-input">Device Name</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="device-name-input"
                                value={localDeviceName}
                                onChange={(e) => setLocalDeviceName(e.target.value)}
                                placeholder="My Device"
                                className="max-w-[300px]"
                            />
                            {hasDeviceNameChanged && (
                                <>
                                    <Button
                                        size="sm"
                                        onClick={() => onDeviceRename(localDeviceName)}
                                        disabled={!localDeviceName.trim()}
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setLocalDeviceName(currentDeviceName)}
                                    >
                                        Cancel
                                    </Button>
                                </>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            ID: {currentDeviceId}
                        </p>
                    </div>
                </div>

                {/* Firebase Section */}
                <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
                    <h4 className="text-sm font-medium">Firebase Configuration</h4>

                    {!isFirebaseAvailable ? (
                        /* Configuration Form */
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Paste your Firebase configuration snippet from the Firebase Console.
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="firebase-config-paste">Paste Firebase Config</Label>
                                <textarea
                                    id="firebase-config-paste"
                                    className="w-full h-32 p-2 text-xs font-mono border border-input rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="// Paste your Firebase config here"
                                    onChange={(e) => parseFirebaseConfig(e.target.value)}
                                    data-testid="firebase-config-paste"
                                />
                            </div>
                            <div className="border-t border-border pt-3 mt-2">
                                <p className="text-xs text-muted-foreground mb-3">Or edit fields individually:</p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="firebase-api-key">API Key</Label>
                                <PasswordInput
                                    id="firebase-api-key"
                                    value={firebaseConfig.apiKey}
                                    onChange={(e) => onFirebaseConfigChange({ apiKey: e.target.value })}
                                    placeholder="AIza..."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="firebase-project-id">Project ID</Label>
                                <Input
                                    id="firebase-project-id"
                                    type="text"
                                    value={firebaseConfig.projectId}
                                    onChange={(e) => onFirebaseConfigChange({ projectId: e.target.value })}
                                    placeholder="your-project-id"
                                />
                            </div>
                        </div>
                    ) : firebaseAuthStatus === 'signed-in' ? (
                        /* Connected State */
                        <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-success">
                                        {firestoreStatus === 'connected' ? '✓ Connected' : 'Connecting...'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Signed in as {firebaseUserEmail}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={onFirebaseSignOut}>
                                    Sign Out
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Your data is syncing automatically in real-time.
                            </p>

                            {/* Workspace Management */}
                            <div className="mt-4 pt-4 border-t border-border space-y-3">
                                <h5 className="text-sm font-medium">Workspaces</h5>
                                <p className="text-xs text-muted-foreground">
                                    Switch between different data contexts.<br />
                                    Active: <strong>
                                        {workspaces.find(w => w.workspaceId === (activeWorkspaceId || FirestoreSyncManager.getDefaultWorkspaceId()))?.name || 'Default'}
                                    </strong>
                                </p>

                                {/* Workspace List */}
                                {isLoadingWorkspaces ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                        Loading workspaces...
                                    </div>
                                ) : workspaces.length > 0 ? (
                                    <div className="space-y-1">
                                        {workspaces.map(ws => (
                                            <div key={ws.workspaceId} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{ws.name}</span>
                                                    <span className="text-[10px] text-muted-foreground leading-tight px-0.5 opacity-70">ID: {ws.workspaceId}</span>
                                                </div>
                                                {ws.workspaceId === activeWorkspaceId ? (
                                                    <span className="text-xs text-success pr-2 font-medium">● Active</span>
                                                ) : ws.schemaVersion > CURRENT_SCHEMA_VERSION ? (
                                                    <span className="text-xs text-destructive pr-2 font-medium shrink-0">Update App to Connect</span>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleSwitchWorkspace(ws.workspaceId)}
                                                            disabled={isSwitchingWorkspace !== null || isDeletingWorkspace !== null}
                                                        >
                                                            {isSwitchingWorkspace === ws.workspaceId ? (
                                                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                                            ) : 'Switch'}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                                            onClick={() => handleDeleteWorkspace(ws.workspaceId, ws.name)}
                                                            disabled={isSwitchingWorkspace !== null || isDeletingWorkspace !== null}
                                                        >
                                                            {isDeletingWorkspace === ws.workspaceId ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                            ) : (
                                                                <Trash2 className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground italic">
                                        No additional workspaces. Create one below.
                                    </p>
                                )}

                                {/* Create Workspace */}
                                <div className="flex items-center gap-2 pt-2">
                                    <Input
                                        value={newWorkspaceName}
                                        onChange={(e) => setNewWorkspaceName(e.target.value)}
                                        placeholder="New workspace name"
                                        className="flex-1 h-8 text-sm"
                                        onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                                    />
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleCreateWorkspace}
                                        disabled={isCreatingWorkspace || !newWorkspaceName.trim()}
                                    >
                                        {isCreatingWorkspace ? (
                                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                        ) : 'Create'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Sign In State */
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Sign in with your Google account to enable real-time sync.
                            </p>
                            <Button
                                onClick={onFirebaseSignIn}
                                disabled={isFirebaseSigningIn}
                                className="w-full"
                            >
                                {isFirebaseSigningIn ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                        Signing in...
                                    </>
                                ) : (
                                    'Sign in with Google'
                                )}
                            </Button>
                            <div className="flex justify-center pt-2">
                                <Button variant="ghost" size="sm" onClick={onClearConfig}>
                                    Clear Configuration
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Section 2: Cloud Integrations */}
            <div className="pt-6 border-t border-border">
                <h3 className="text-lg font-medium mb-4">Cloud Integrations</h3>
                <div className="p-4 border border-border rounded-lg bg-card">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            {/* Drive Logo */}
                            <div className="p-2 bg-muted rounded-full">
                                <img
                                    src="/logo_drive_2020q4_color_2x_web_64dp.png"
                                    alt="Google Drive"
                                    className="w-6 h-6 object-contain"
                                />
                            </div>
                            <div>
                                <h4 className="text-sm font-medium">Google Drive</h4>
                                <p className="text-xs text-muted-foreground">
                                    Import books directly from your Cloud Storage.
                                </p>
                            </div>
                        </div>
                        {isDriveConnected ? (
                            <div className="flex items-center space-x-2">
                                <span className="text-xs font-medium text-success">Connected</span>
                                <Button variant="outline" size="sm" onClick={handleDriveDisconnect}>Disconnect</Button>
                            </div>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDriveConnect}
                                disabled={isDriveConnecting}
                            >
                                {isDriveConnecting ? <Loader2 className="h-3 w-3 animate-spin mr-2" aria-hidden="true" /> : null}
                                Connect
                            </Button>
                        )}
                    </div>
                    {firebaseUserEmail && isDriveConnected && (
                        <p className="mt-2 text-xs text-muted-foreground pl-[3.5rem]">
                            <span className="opacity-70">Hint: Best used with the same account as Sync ({firebaseUserEmail}).</span>
                        </p>
                    )}

                    {/* Linked Folder Selection */}
                    {isDriveConnected && (
                        <div className="mt-4 pt-4 border-t border-border pl-[3.5rem]">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-medium">Library Folder</Label>
                                    <p className="text-xs text-muted-foreground">
                                        {linkedFolderName
                                            ? `Linked to "${linkedFolderName}"`
                                            : "Select a folder to sync books from."}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsPickerOpen(true)}
                                >
                                    {linkedFolderName ? "Change Folder" : "Link Folder"}
                                </Button>
                            </div>

                            {/* Scan Action */}
                            {linkedFolderName && (
                                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                                    <div className="space-y-0.5">
                                        <Label className="text-sm font-medium">Sync Library</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Check for new books in "{linkedFolderName}".
                                        </p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleScan}
                                        disabled={isScanning}
                                    >
                                        {isScanning ? (
                                            <>
                                                <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" />
                                                Scanning...
                                            </>
                                        ) : (
                                            "Scan for New Books"
                                        )}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Client ID Configuration */}
                    {!isDriveConnected && (
                        <div className="mt-4 pt-4 border-t border-border space-y-4">
                            <div>
                                <h4 className="text-sm font-medium mb-2">Google Authentication Configuration</h4>
                                <p className="text-xs text-muted-foreground mb-4">
                                    Override default Client IDs for custom deployments. Leave empty to use defaults.
                                </p>

                                <div className="grid gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="google-web-client-id" className="text-xs font-medium">
                                            Web Client ID
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="google-web-client-id"
                                                value={useGoogleServicesStore.getState().googleClientId || ''}
                                                onChange={(e) => useGoogleServicesStore.getState().setGoogleClientId(e.target.value)}
                                                placeholder="Default Web Client ID"
                                                className="text-xs h-8"
                                            />
                                            {useGoogleServicesStore.getState().googleClientId && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 text-muted-foreground"
                                                    onClick={() => useGoogleServicesStore.getState().setGoogleClientId('')}
                                                    title="Clear"
                                                >
                                                    ✕
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="google-ios-client-id" className="text-xs font-medium">
                                            iOS Client ID
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="google-ios-client-id"
                                                value={useGoogleServicesStore.getState().googleIosClientId || ''}
                                                onChange={(e) => useGoogleServicesStore.getState().setGoogleIosClientId(e.target.value)}
                                                placeholder="Default iOS Client ID"
                                                className="text-xs h-8"
                                            />
                                            {useGoogleServicesStore.getState().googleIosClientId && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 text-muted-foreground"
                                                    onClick={() => useGoogleServicesStore.getState().setGoogleIosClientId('')}
                                                    title="Clear"
                                                >
                                                    ✕
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {/* Folder Picker Dialog */}
            {/* Folder Picker Modal */}
            <Modal open={isPickerOpen} onOpenChange={(open) => !open && setIsPickerOpen(false)}>
                <ModalContent className="max-w-2xl h-[600px] p-0 overflow-hidden flex flex-col gap-0 border-border bg-background">
                    <ModalHeader className="p-6 pb-2">
                        <ModalTitle>Select Library Folder</ModalTitle>
                    </ModalHeader>
                    <div className="flex-1 min-h-0">
                        <DriveFolderPicker
                            onSelect={handleFolderSelect}
                            onCancel={() => setIsPickerOpen(false)}
                        />
                    </div>
                </ModalContent>
            </Modal>
        </div>
    );
};
