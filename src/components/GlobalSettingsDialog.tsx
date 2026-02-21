import { useState, useEffect } from 'react';
import { useUIStore } from '../store/useUIStore';
import { useTTSStore } from '../store/useTTSStore';
import { useLibraryStore, useBookStore } from '../store/useLibraryStore';
import { useReadingListStore } from '../store/useReadingListStore';
import { useReadingStateStore } from '../store/useReadingStateStore';
import { usePreferencesStore } from '../store/usePreferencesStore';
import { useToastStore } from '../store/useToastStore';
import { useShallow } from 'zustand/react/shallow';
import { Modal, ModalContent, ModalHeader, ModalTitle } from './ui/Modal';
import { Button } from './ui/Button';


import { useGenAIStore } from '../store/useGenAIStore';
import { TTSAbbreviationSettings } from './reader/TTSAbbreviationSettings';
import { LexiconManager } from './reader/LexiconManager';

import { getDB } from '../db/db';
import { maintenanceService } from '../lib/MaintenanceService';
import { backupService } from '../lib/BackupService';
import { dbService } from '../db/DBService';
import { CheckpointService } from '../lib/sync/CheckpointService';
import { useSyncStore } from '../lib/sync/hooks/useSyncStore';
import { useFirestoreSync } from '../lib/sync/hooks/useFirestoreSync';
import { exportReadingListToCSV, parseReadingListCSV } from '../lib/csv';
import { exportFile } from '../lib/export';
import { ReadingListDialog } from './ReadingListDialog';
import { Loader2 } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useDeviceStore } from '../store/useDeviceStore';
import { getDeviceId } from '../lib/device-id';

import { DeviceManager } from './devices/DeviceManager';
import { createLogger } from '../lib/logger';
import { DataExportWizard } from './sync/DataExportWizard';
import { BackButtonPriority } from '../store/useBackNavigationStore';
import { useNavigationGuard } from '../hooks/useNavigationGuard';
import {
    GeneralSettingsTab,
    TTSSettingsTab,
    GenAISettingsTab,
    SyncSettingsTab,
    RecoverySettingsTab,
    DataManagementTab
} from './settings';

const logger = createLogger('GlobalSettingsDialog');

/**
 * Global application settings dialog.
 * Covers:
 * - General settings
 * - TTS Engine configuration (Providers, API keys)
 * - Pronunciation Dictionary & Segmentation rules
 * - Data Management (Backup, Restore, Maintenance, Reset)
 *
 * @returns The Settings dialog component.
 */
export const GlobalSettingsDialog = () => {
    const { isGlobalSettingsOpen, setGlobalSettingsOpen } = useUIStore();
    const [activeTab, setActiveTab] = useState('general');
    const [isLexiconOpen, setIsLexiconOpen] = useState(false);
    const [orphanScanResult, setOrphanScanResult] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [regenerationProgress, setRegenerationProgress] = useState<string | null>(null);
    const [regenerationPercent, setRegenerationPercent] = useState(0);
    const [backupStatus, setBackupStatus] = useState<string | null>(null);
    const [isClearing, setIsClearing] = useState(false);


    const readingListEntries = useReadingListStore(state => state.entries);
    const readingListCount = Object.keys(readingListEntries).length;
    const [isReadingListOpen, setIsReadingListOpen] = useState(false);
    const [isCsvImporting, setIsCsvImporting] = useState(false);
    const [csvImportMessage, setCsvImportMessage] = useState('');
    const [csvImportComplete, setCsvImportComplete] = useState(false);
    const [isExportWizardOpen, setIsExportWizardOpen] = useState(false);

    const {
        addBooks,

        isImporting,
        importProgress,
        importStatus,
        uploadProgress,
        uploadStatus
    } = useLibraryStore();
    const showToast = useToastStore(state => state.showToast);
    const { currentTheme, setTheme } = usePreferencesStore(useShallow(state => ({
        currentTheme: state.currentTheme,
        setTheme: state.setTheme
    })));

    const {
        setFirebaseEnabled, firestoreStatus, firebaseAuthStatus, firebaseUserEmail,
        syncProvider, setSyncProvider, firebaseConfig, setFirebaseConfig
    } = useSyncStore();
    const { signIn: firebaseSignIn, signOut: firebaseSignOut, isConfigured: isFirebaseAvailable } = useFirestoreSync();
    const [isFirebaseSigningIn, setIsFirebaseSigningIn] = useState(false);
    const [checkpoints, setCheckpoints] = useState<Awaited<ReturnType<typeof CheckpointService.listCheckpoints>>>([]);

    const { devices, renameDevice } = useDeviceStore();
    const currentDeviceId = getDeviceId();

    useNavigationGuard(() => {
        if (isExportWizardOpen) {
            setIsExportWizardOpen(false);
        } else if (isReadingListOpen) {
            setIsReadingListOpen(false);
        } else {
            setGlobalSettingsOpen(false);
        }
    }, BackButtonPriority.OVERLAY, isGlobalSettingsOpen);

    useEffect(() => {
        if (activeTab === 'recovery') {
            CheckpointService.listCheckpoints().then(setCheckpoints);
        }
    }, [activeTab]);

    const handleExportReadingList = async () => {
        try {
            const list = Object.values(useReadingListStore.getState().entries);
            if (!list || list.length === 0) {
                alert('Reading list is empty.');
                return;
            }
            const csv = exportReadingListToCSV(list);
            const filename = `versicle_reading_list_${new Date().toISOString().split('T')[0]}.csv`;

            await exportFile({
                filename,
                data: csv,
                mimeType: 'text/csv'
            });
        } catch (e) {
            logger.error('Export reading list failed', e);
            alert('Failed to export reading list.');
        }
    };



    const handleReturnToLibrary = async () => {
        setIsCsvImporting(false);
        setCsvImportComplete(false);
        setCsvImportMessage('');
        // Phase 2: No need to fetchBooks - Yjs auto-syncs
        setGlobalSettingsOpen(false);
    };

    const handleClearContentAnalysis = async () => {
        if (confirm("Are you sure you want to clear the Content Analysis cache? This will force re-analysis of content.")) {
            try {
                await dbService.clearContentAnalysis();
                showToast("Content Analysis cache cleared.", "success");
            } catch (e) {
                logger.error("Failed to clear content analysis cache", e);
                showToast("Failed to clear cache.", "error");
            }
        }
    };

    const {
        providerId, setProviderId,
        apiKeys, setApiKey,
        backgroundAudioMode, setBackgroundAudioMode,
        whiteNoiseVolume, setWhiteNoiseVolume,
        voice, voices, setVoice,
        downloadVoice, deleteVoice, downloadProgress, downloadStatus, isDownloading, checkVoiceDownloaded,
        minSentenceLength, setMinSentenceLength
    } = useTTSStore(useShallow(state => ({
        // Optimization: Use shallow selector to avoid re-renders on activeCfi/progress updates during playback
        providerId: state.providerId,
        setProviderId: state.setProviderId,
        apiKeys: state.apiKeys,
        setApiKey: state.setApiKey,
        backgroundAudioMode: state.backgroundAudioMode,
        setBackgroundAudioMode: state.setBackgroundAudioMode,
        whiteNoiseVolume: state.whiteNoiseVolume,
        setWhiteNoiseVolume: state.setWhiteNoiseVolume,
        voice: state.voice,
        voices: state.voices,
        setVoice: state.setVoice,
        downloadVoice: state.downloadVoice,
        deleteVoice: state.deleteVoice,
        downloadProgress: state.downloadProgress,
        downloadStatus: state.downloadStatus,
        isDownloading: state.isDownloading,
        checkVoiceDownloaded: state.checkVoiceDownloaded,
        minSentenceLength: state.minSentenceLength,
        setMinSentenceLength: state.setMinSentenceLength
    })));

    const [isVoiceReady, setIsVoiceReady] = useState(false);

    useEffect(() => {
        if (providerId === 'piper' && voice) {
            checkVoiceDownloaded(voice.id).then(setIsVoiceReady);
        } else {
            setIsVoiceReady(false);
        }
    }, [providerId, voice, checkVoiceDownloaded, isDownloading]);

    const {
        apiKey: genAIApiKey,
        setApiKey: setGenAIApiKey,
        model: genAIModel,
        setModel: setGenAIModel,
        isEnabled: isGenAIEnabled,
        setEnabled: setGenAIEnabled,
        isModelRotationEnabled,
        setModelRotationEnabled,
        isContentAnalysisEnabled,
        setContentAnalysisEnabled,
        isTableAdaptationEnabled,
        setTableAdaptationEnabled,
        contentFilterSkipTypes,
        setContentFilterSkipTypes,
        logs: genAILogs,
        isDebugModeEnabled,
        setDebugModeEnabled
    } = useGenAIStore();

    const handleClearAllData = async () => {
        if (confirm("Are you sure you want to delete ALL data? This includes books, annotations, and settings.")) {
            setIsClearing(true);
            try {
                dbService.cleanup();
                // Clear IndexedDB (static and cache stores)
                const db = await getDB();
                await db.clear('static_manifests');
                await db.clear('static_resources');
                await db.clear('static_structure');
                await db.clear('cache_table_images');
                await db.clear('cache_render_metrics');
                await db.clear('cache_audio_blobs');
                await db.clear('cache_session_state');
                await db.clear('cache_tts_preparation');

                // Clear LocalStorage (includes Yjs persistence)
                localStorage.clear();

                // Reload to reset Yjs stores
                window.location.reload();
            } catch (e) {
                logger.error('Failed to clear data', e);
                setIsClearing(false);
                alert('Failed to clear data. Please check console.');
            }
        }
    };

    const handleRepairDB = async () => {
        setIsScanning(true);
        setOrphanScanResult('Scanning...');
        try {
            const report = await maintenanceService.scanForOrphans();
            const total = report.files + report.locations + report.tts_prep;
            if (total > 0) {
                if (confirm(`Found orphans: \n - Files: ${report.files} \n - Locations: ${report.locations} \n - TTS Prep: ${report.tts_prep} \n\nDelete them?`)) {
                    await maintenanceService.pruneOrphans();
                    setOrphanScanResult('Repair complete. Orphans removed.');
                } else {
                    setOrphanScanResult('Repair cancelled.');
                }
            } else {
                setOrphanScanResult('Database is healthy. No orphans found.');
            }
        } catch (e) {
            logger.error('Repair DB failed', e);
            setOrphanScanResult('Error during repair check console.');
        } finally {
            setIsScanning(false);
        }
    };

    const handleRegenerateMetadata = async () => {
        if (!confirm("This will regenerate all book metadata and content structure from the stored files. This may take a while. Continue?")) {
            return;
        }

        setIsRegenerating(true);
        setRegenerationProgress('Starting...');
        setRegenerationPercent(0);

        try {
            await maintenanceService.regenerateAllMetadata((current, total, message) => {
                setRegenerationProgress(message);
                setRegenerationPercent(total > 0 ? Math.round((current / total) * 100) : 0);
            });
            setRegenerationProgress('Regeneration complete.');
            setRegenerationPercent(100);
            setTimeout(() => {
                setIsRegenerating(false);
                setRegenerationProgress(null);
            }, 3000);
        } catch (e) {
            logger.error('Regenerate metadata failed', e);
            setRegenerationProgress('Failed to regenerate metadata.');
            setIsRegenerating(false);
        }
    };

    const handleExportLight = async () => {
        try {
            setBackupStatus('Exporting metadata...');
            await backupService.createLightBackup();
            setBackupStatus('Metadata export complete.');
        } catch (error) {
            logger.error('Export light failed', error);
            setBackupStatus('Export failed.');
        }
    };

    const handleExportFull = async () => {
        try {
            setBackupStatus('Starting full backup...');
            await backupService.createFullBackup((percent, msg) => {
                setBackupStatus(`Backup: ${percent}% - ${msg} `);
            });
            setTimeout(() => setBackupStatus('Full backup complete.'), 2000);
        } catch (error) {
            logger.error('Export full failed', error);
            setBackupStatus('Full backup failed. Check console.');
        }
    };



    const handleDownloadGenAILogs = async () => {
        const content = genAILogs.map(log =>
            `[${new Date(log.timestamp).toISOString()}] ${log.type.toUpperCase()} (${log.method}) \n` +
            JSON.stringify(log.payload, null, 2) +
            `\n${'-'.repeat(40)} \n`
        ).join('\n');

        const filename = `genai_logs_${new Date().toISOString()}.txt`;

        await exportFile({
            filename,
            data: content,
            mimeType: 'text/plain'
        });
    };

    const handleClearConfig = () => {
        if (confirm("Are you sure you want to clear the Firebase configuration?")) {
            setFirebaseConfig({
                apiKey: '',
                authDomain: '',
                projectId: '',
                storageBucket: '',
                messagingSenderId: '',
                appId: '',
                measurementId: ''
            });
            setFirebaseEnabled(false);
        }
    };

    const handleImportReadingListFile = async (file: File) => {
        setIsCsvImporting(true);
        setCsvImportComplete(false);
        setCsvImportMessage('Reading file...');

        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target?.result as string;
            if (text) {
                try {
                    setCsvImportMessage('Parsing CSV...');
                    await new Promise(r => setTimeout(r, 500));
                    const entries = parseReadingListCSV(text);

                    setCsvImportMessage(`Importing ${entries.length} entries and syncing with library...`);
                    await new Promise(r => setTimeout(r, 500));

                    const store = useReadingListStore.getState();
                    const rsStore = useReadingStateStore.getState();
                    for (const entry of entries) {
                        store.upsertEntry(entry);
                        if (entry.percentage !== undefined) {
                            const book = Object.values(useBookStore.getState().books).find(b => b.sourceFilename === entry.filename);
                            const targetId = book ? book.bookId : entry.filename;
                            rsStore.updateLocation(targetId, '', entry.percentage);
                        }
                    }

                    setCsvImportMessage(`Successfully imported ${entries.length} entries.`);
                    setCsvImportComplete(true);
                } catch (err) {
                    logger.error('CSV import failed', err);
                    setCsvImportMessage('Failed to import CSV.');
                    setTimeout(() => setIsCsvImporting(false), 2000);
                }
            }
        };
        reader.readAsText(file);
    };

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

    const handleRestoreBackupFile = async (file: File) => {
        if (!confirm('Restoring a backup will merge data into your library. Existing books will be updated. Continue?')) {
            return;
        }

        try {
            setBackupStatus('Starting restore...');
            await backupService.restoreBackup(file, (percent, msg) => {
                setBackupStatus(`Restore: ${percent}% - ${msg} `);
            });
            setBackupStatus('Restore complete! Reloading...');
            setTimeout(() => window.location.reload(), 500);
        } catch (error) {
            logger.error('Restore failed', error);
            setBackupStatus(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'} `);
        }
    };

    return (
        <>
            <Modal open={isGlobalSettingsOpen} onOpenChange={setGlobalSettingsOpen}>
                <ModalContent className="max-w-3xl h-[90vh] sm:h-[600px] flex flex-col sm:flex-row p-0 overflow-hidden gap-0 sm:rounded-lg" aria-describedby="global-settings-desc">
                    <VisuallyHidden>
                        <ModalHeader>
                            <ModalTitle>Global Settings</ModalTitle>
                        </ModalHeader>
                    </VisuallyHidden>
                    <span id="global-settings-desc" className="sr-only">Global application settings including appearance, TTS configuration, and data management.</span>
                    {isCsvImporting && (
                        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center">
                            <Loader2 className={`h-12 w-12 text-primary mb-4 ${!csvImportComplete ? 'animate-spin' : ''}`} />
                            <h3 className="text-xl font-semibold mb-2">{csvImportComplete ? 'Import Complete' : 'Importing Reading List'}</h3>
                            <p className="text-muted-foreground mb-6">{csvImportMessage}</p>

                            {csvImportComplete && (
                                <Button size="lg" onClick={handleReturnToLibrary}>
                                    Return to Library
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Sidebar */}
                    <div className="w-full sm:w-1/4 bg-muted/30 border-b sm:border-r sm:border-b-0 p-2 sm:p-4 flex flex-row sm:flex-col gap-2 overflow-x-auto sm:overflow-visible items-center sm:items-stretch shrink-0">
                        <h2 className="text-lg font-semibold mb-4 px-2 hidden sm:block">Settings</h2>
                        <Button variant={activeTab === 'general' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('general')}>
                            General
                        </Button>
                        <Button variant={activeTab === 'tts' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('tts')}>
                            TTS Engine
                        </Button>
                        <Button variant={activeTab === 'genai' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('genai')}>
                            Generative AI
                        </Button>

                        {/* ... (existing imports) */}

                        <Button variant={activeTab === 'sync' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('sync')}>
                            Sync & Cloud
                        </Button>
                        <Button variant={activeTab === 'devices' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('devices')}>
                            Devices
                        </Button>
                        <Button variant={activeTab === 'dictionary' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('dictionary')}>
                            Dictionary
                        </Button>
                        <Button variant={activeTab === 'recovery' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('recovery')}>
                            Recovery
                        </Button>
                        {/* Add margin to last item to prevent overlap with Close button on mobile */}
                        <Button variant={activeTab === 'data' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0 text-destructive hover:text-destructive mr-10 sm:mr-0" onClick={() => setActiveTab('data')}>
                            Data Management
                        </Button>
                    </div>

                    {/* Content */}
                    <div className="w-full sm:w-3/4 p-4 sm:p-8 overflow-y-auto flex-1">
                        {activeTab === 'general' && (
                            <GeneralSettingsTab
                                currentTheme={currentTheme}
                                onThemeChange={setTheme}
                                isImporting={isImporting}
                                importProgress={importProgress}
                                importStatus={importStatus}
                                uploadProgress={uploadProgress}
                                uploadStatus={uploadStatus}
                                onBatchImport={(files) => {
                                    addBooks(Array.from(files));
                                    setGlobalSettingsOpen(false);
                                }}
                            />
                        )}

                        {activeTab === 'tts' && (
                            <TTSSettingsTab
                                providerId={providerId}
                                onProviderChange={setProviderId}
                                apiKeys={apiKeys}
                                onApiKeyChange={setApiKey}
                                backgroundAudioMode={backgroundAudioMode}
                                onBackgroundAudioModeChange={setBackgroundAudioMode}
                                whiteNoiseVolume={whiteNoiseVolume}
                                onWhiteNoiseVolumeChange={setWhiteNoiseVolume}
                                voice={voice}
                                voices={voices}
                                onVoiceChange={setVoice}
                                isVoiceReady={isVoiceReady}
                                isDownloading={isDownloading}
                                downloadProgress={downloadProgress}
                                downloadStatus={downloadStatus}
                                onDownloadVoice={downloadVoice}
                                onDeleteVoice={(voiceId) => {
                                    deleteVoice(voiceId).then(() => setIsVoiceReady(false));
                                }}
                                minSentenceLength={minSentenceLength}
                                onMinSentenceLengthChange={setMinSentenceLength}
                            />
                        )}

                        {activeTab === 'genai' && (
                            <GenAISettingsTab
                                isEnabled={isGenAIEnabled}
                                onEnabledChange={setGenAIEnabled}
                                apiKey={genAIApiKey}
                                onApiKeyChange={setGenAIApiKey}
                                model={genAIModel}
                                onModelChange={setGenAIModel}
                                isModelRotationEnabled={isModelRotationEnabled}
                                onModelRotationChange={setModelRotationEnabled}
                                isContentAnalysisEnabled={isContentAnalysisEnabled}
                                onContentAnalysisChange={setContentAnalysisEnabled}
                                contentFilterSkipTypes={contentFilterSkipTypes}
                                onContentFilterSkipTypesChange={setContentFilterSkipTypes}
                                isDebugModeEnabled={isDebugModeEnabled}
                                onDebugModeChange={setDebugModeEnabled}
                                onClearContentAnalysis={handleClearContentAnalysis}
                                isTableAdaptationEnabled={isTableAdaptationEnabled}
                                onTableAdaptationChange={setTableAdaptationEnabled}
                                logs={genAILogs}
                                onDownloadLogs={handleDownloadGenAILogs}
                            />
                        )}

                        {activeTab === 'sync' && (
                            <SyncSettingsTab
                                currentDeviceId={currentDeviceId}
                                currentDeviceName={devices[currentDeviceId]?.name || 'Unknown Device'}
                                onDeviceRename={(name) => {
                                    if (devices[currentDeviceId]) {
                                        renameDevice(currentDeviceId, name);
                                    } else {
                                        // Self-healing: Device not mesh-registered? Register it now with the new name.
                                        const prefs = usePreferencesStore.getState();
                                        const tts = useTTSStore.getState();
                                        const profile = {
                                            theme: prefs.currentTheme,
                                            fontSize: prefs.fontSize,
                                            ttsVoiceURI: tts.voice ? tts.voice.id : null,
                                            ttsRate: tts.rate,
                                            ttsPitch: tts.pitch
                                        };
                                        useDeviceStore.getState().registerCurrentDevice(currentDeviceId, profile, name);
                                        showToast('Device registered to mesh', 'success');
                                    }
                                }}
                                syncProvider={syncProvider}
                                onSyncProviderChange={setSyncProvider}
                                isFirebaseAvailable={isFirebaseAvailable}
                                firebaseAuthStatus={firebaseAuthStatus}
                                firestoreStatus={firestoreStatus}
                                firebaseUserEmail={firebaseUserEmail}
                                isFirebaseSigningIn={isFirebaseSigningIn}
                                firebaseConfig={firebaseConfig}
                                onFirebaseConfigChange={(updates) => setFirebaseConfig({ ...firebaseConfig, ...updates })}
                                onFirebaseSignIn={async () => {
                                    setIsFirebaseSigningIn(true);
                                    try {
                                        await firebaseSignIn();
                                    } catch (e: any) {
                                        logger.error('Firebase sign in failed', e);
                                        showToast(`Sign in failed: ${e?.message || 'Unknown error'}`, 'error');
                                    } finally {
                                        setIsFirebaseSigningIn(false);
                                    }
                                }}
                                onFirebaseSignOut={async () => {
                                    await firebaseSignOut();
                                }}
                                onClearConfig={handleClearConfig}
                            />
                        )}

                        {
                            activeTab === 'devices' && (
                                <div className="space-y-6">
                                    <DeviceManager />
                                </div>
                            )
                        }

                        {
                            activeTab === 'recovery' && (
                                <RecoverySettingsTab
                                    checkpoints={checkpoints}
                                    recoveryStatus={null}
                                    onCreateCheckpoint={handleCreateCheckpoint}
                                />
                            )
                        }

                        {
                            activeTab === 'dictionary' && (
                                <div className="space-y-8">
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-medium">Pronunciation Lexicon</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Manage global and book-specific pronunciation rules.
                                        </p>
                                        <Button onClick={() => setIsLexiconOpen(true)}>Manage Rules</Button>
                                        <LexiconManager open={isLexiconOpen} onOpenChange={setIsLexiconOpen} />
                                    </div>

                                    <div className="border-t pt-4 space-y-4">
                                        <h3 className="text-lg font-medium">Text Segmentation & Abbreviations</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Define abbreviations that should not trigger a sentence break, and enable built-in lexicon packs.
                                        </p>
                                        <TTSAbbreviationSettings />
                                    </div>
                                </div>
                            )
                        }

                        {
                            activeTab === 'data' && (
                                <DataManagementTab
                                    readingListCount={readingListCount}
                                    onViewReadingList={() => setIsReadingListOpen(true)}
                                    onExportReadingList={handleExportReadingList}
                                    onImportReadingList={handleImportReadingListFile}
                                    backupStatus={backupStatus}
                                    onExportFull={handleExportFull}
                                    onExportWizard={() => setIsExportWizardOpen(true)}
                                    onExportLight={handleExportLight}
                                    onRestoreBackup={handleRestoreBackupFile}
                                    isScanning={isScanning}
                                    orphanScanResult={orphanScanResult}
                                    onRepairDB={handleRepairDB}
                                    isRegenerating={isRegenerating}
                                    regenerationProgress={regenerationProgress}
                                    regenerationPercent={regenerationPercent}
                                    onRegenerateMetadata={handleRegenerateMetadata}
                                    onClearAllData={handleClearAllData}
                                    isClearing={isClearing}
                                />
                            )
                        }
                    </div >
                </ModalContent >
            </Modal >
            <ReadingListDialog open={isReadingListOpen} onOpenChange={setIsReadingListOpen} />
            <DataExportWizard open={isExportWizardOpen} onOpenChange={setIsExportWizardOpen} />
        </>
    );
};
