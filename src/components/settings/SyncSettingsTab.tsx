import React from 'react';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';

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
    // Provider
    syncProvider: 'none' | 'firebase';
    onSyncProviderChange: (provider: 'none' | 'firebase') => void;
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

export const SyncSettingsTab: React.FC<SyncSettingsTabProps> = ({
    currentDeviceId,
    currentDeviceName,
    onDeviceRename,
    syncProvider,
    onSyncProviderChange,
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

    const {
        isServiceConnected,
        googleClientId
    } = useGoogleServicesStore();
    const [isDriveConnecting, setIsDriveConnecting] = React.useState(false);

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
        } catch (error) {
            console.error("Failed to disconnect Drive", error);
        }
    };

    const isDriveConnected = isServiceConnected('drive');

    return (
        <div className="space-y-8">
            {/* Section 1: App Sync */}
            <div>
                <h3 className="text-lg font-medium mb-4">App Sync</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Sync your reading progress, annotations, and reading list across devices.
                </p>

                {/* Device Identity */}
                <div className="space-y-4 mb-6 pb-6 border-b">
                    <h4 className="text-sm font-medium">Device Identity</h4>
                    <div className="space-y-2">
                        <Label htmlFor="device-name-input">Device Name</Label>
                        <Input
                            id="device-name-input"
                            value={currentDeviceName}
                            onChange={(e) => onDeviceRename(e.target.value)}
                            placeholder="My Device"
                        />
                        <p className="text-xs text-muted-foreground">
                            ID: {currentDeviceId}
                        </p>
                    </div>
                </div>

                {/* Provider Selection */}
                <div className="space-y-4 mb-6">
                    <div className="space-y-2">
                        <Label htmlFor="sync-provider-select" className="text-sm font-medium">Sync Provider</Label>
                        <Select value={syncProvider} onValueChange={(val) => onSyncProviderChange(val as 'none' | 'firebase')}>
                            <SelectTrigger id="sync-provider-select">
                                <SelectValue placeholder="Select sync provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Disabled</SelectItem>
                                <SelectItem value="firebase">Firebase (Recommended)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {syncProvider === 'firebase' && 'Real-time sync with automatic conflict resolution.'}
                            {syncProvider === 'none' && 'Sync is disabled. Data is stored locally only.'}
                        </p>
                    </div>
                </div>

                {/* Firebase Section */}
                {syncProvider === 'firebase' && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
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
                                        className="w-full h-32 p-2 text-xs font-mono border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                                        placeholder="// Paste your Firebase config here"
                                        onChange={(e) => parseFirebaseConfig(e.target.value)}
                                        data-testid="firebase-config-paste"
                                    />
                                </div>
                                <div className="border-t pt-3 mt-2">
                                    <p className="text-xs text-muted-foreground mb-3">Or edit fields individually:</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="firebase-api-key">API Key</Label>
                                    <Input
                                        id="firebase-api-key"
                                        type="password"
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
                                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
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
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
                )}
            </div>

            {/* Section 2: Cloud Integrations */}
            <div className="pt-6 border-t">
                <h3 className="text-lg font-medium mb-4">Cloud Integrations</h3>
                <div className="p-4 border rounded-lg bg-card">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            {/* Drive Icon (Simple SVG or Lucide) */}
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                                <svg className="w-6 h-6" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                                    <path d="m6.6 66.85 25.3-43.8 25.3 43.8z" fill="#0066da" />
                                    <path d="m43.85 66.85 25.3-43.8 18.15 31.45-8.35 14.35h-35.1z" fill="#4395ec" />
                                    <path d="m87.3 52.5-18.15-31.45-18.15-31.45h-36.3l18.15 31.45z" fill="#0093f9" />
                                </svg>
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
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">Connected</span>
                                <Button variant="outline" size="sm" onClick={handleDriveDisconnect}>Disconnect</Button>
                            </div>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDriveConnect}
                                disabled={isDriveConnecting}
                            >
                                {isDriveConnecting ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                                Connect
                            </Button>
                        )}
                    </div>
                    {firebaseUserEmail && isDriveConnected && (
                        <p className="mt-2 text-xs text-muted-foreground pl-[3.5rem]">
                            <span className="opacity-70">Hint: Best used with the same account as Sync ({firebaseUserEmail}).</span>
                        </p>
                    )}

                    {/* Client ID Configuration (Web Only) */}
                    {!isDriveConnected && (
                        <div className="mt-4 pt-4 border-t">
                            <Label htmlFor="google-client-id" className="text-xs font-medium text-muted-foreground">
                                Google Client ID (Web Only)
                            </Label>
                            <div className="flex gap-2 mt-1.5">
                                <Input
                                    id="google-client-id"
                                    value={googleClientId || ''}
                                    onChange={(e) => useGoogleServicesStore.getState().setGoogleClientId(e.target.value)}
                                    placeholder="Optional: Enter custom Client ID"
                                    className="text-xs h-8"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-muted-foreground"
                                    onClick={() => useGoogleServicesStore.getState().setGoogleClientId('')}
                                    title="Clear Client ID"
                                >
                                    ✕
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                Leave empty to use built-in default. Required for custom deployments.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
