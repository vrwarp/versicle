import React from 'react';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';
import { DriveSettingsSection } from './DriveSettingsSection';

export interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
}

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

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-4">Cross-Device Sync</h3>
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

                {/* Google Drive Integration */}
                {isFirebaseAvailable && (
                    <DriveSettingsSection />
                )}
            </div>
        </div>
    );
};
