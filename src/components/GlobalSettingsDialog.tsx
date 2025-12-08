import { useState, useRef } from 'react';
import { useUIStore } from '../store/useUIStore';
import { useTTSStore } from '../store/useTTSStore';
import { Modal, ModalContent } from './ui/Modal';
import { Button } from './ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Input } from './ui/Input';
import { Slider } from './ui/Slider';
import { TTSAbbreviationSettings } from './reader/TTSAbbreviationSettings';
import { LexiconManager } from './reader/LexiconManager';
import { getDB } from '../db/db';
import { maintenanceService } from '../lib/MaintenanceService';
import { backupService } from '../lib/BackupService';

export const GlobalSettingsDialog = () => {
    const { isGlobalSettingsOpen, setGlobalSettingsOpen } = useUIStore();
    const [activeTab, setActiveTab] = useState('general');
    const [isLexiconOpen, setIsLexiconOpen] = useState(false);
    const [orphanScanResult, setOrphanScanResult] = useState<string | null>(null);
    const [backupStatus, setBackupStatus] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        providerId, setProviderId,
        apiKeys, setApiKey,
        silentAudioType, setSilentAudioType,
        whiteNoiseVolume, setWhiteNoiseVolume
    } = useTTSStore();

    const handleClearAllData = async () => {
        if (confirm("Are you sure you want to delete ALL data? This includes books, annotations, and settings.")) {
            // Clear IndexedDB
            const db = await getDB();
            await db.clear('books');
            await db.clear('files');
            await db.clear('annotations');
            await db.clear('tts_cache');
            await db.clear('lexicon');
            await db.clear('locations');

            // Clear LocalStorage
            localStorage.clear();

            // Reload
            window.location.reload();
        }
    };

    const handleRepairDB = async () => {
        setOrphanScanResult('Scanning...');
        try {
            const report = await maintenanceService.scanForOrphans();
            const total = report.files + report.annotations + report.locations + report.lexicon;
            if (total > 0) {
                if (confirm(`Found orphans:\n- Files: ${report.files}\n- Annotations: ${report.annotations}\n- Locations: ${report.locations}\n- Lexicon: ${report.lexicon}\n\nDelete them?`)) {
                    await maintenanceService.pruneOrphans();
                    setOrphanScanResult('Repair complete. Orphans removed.');
                } else {
                    setOrphanScanResult('Repair cancelled.');
                }
            } else {
                setOrphanScanResult('Database is healthy. No orphans found.');
            }
        } catch (e) {
            console.error(e);
            setOrphanScanResult('Error during repair check console.');
        }
    };

    const handleExportLight = async () => {
        try {
            setBackupStatus('Exporting metadata...');
            await backupService.createLightBackup();
            setBackupStatus('Metadata export complete.');
        } catch (error) {
            console.error(error);
            setBackupStatus('Export failed.');
        }
    };

    const handleExportFull = async () => {
        try {
            setBackupStatus('Starting full backup...');
            await backupService.createFullBackup((percent, msg) => {
                setBackupStatus(`Backup: ${percent}% - ${msg}`);
            });
            setTimeout(() => setBackupStatus('Full backup complete.'), 2000);
        } catch (error) {
            console.error(error);
            setBackupStatus('Full backup failed. Check console.');
        }
    };

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm('Restoring a backup will merge data into your library. Existing books will be updated. Continue?')) {
            e.target.value = '';
            return;
        }

        try {
            setBackupStatus('Starting restore...');
            await backupService.restoreBackup(file, (percent, msg) => {
                setBackupStatus(`Restore: ${percent}% - ${msg}`);
            });
            setBackupStatus('Restore complete! Reloading...');
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            console.error(error);
            setBackupStatus(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            e.target.value = '';
        }
    };

    return (
        <Modal open={isGlobalSettingsOpen} onOpenChange={setGlobalSettingsOpen}>
            <ModalContent className="max-w-3xl h-[90vh] sm:h-[600px] flex flex-col sm:flex-row p-0 overflow-hidden gap-0 sm:rounded-lg">
                {/* Sidebar */}
                <div className="w-full sm:w-1/4 bg-muted/30 border-b sm:border-r sm:border-b-0 p-2 sm:p-4 flex flex-row sm:flex-col gap-2 overflow-x-auto sm:overflow-visible items-center sm:items-stretch shrink-0">
                    <h2 className="text-lg font-semibold mb-4 px-2 hidden sm:block">Settings</h2>
                    <Button variant={activeTab === 'general' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('general')}>
                        General
                    </Button>
                    <Button variant={activeTab === 'tts' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('tts')}>
                        TTS Engine
                    </Button>
                    <Button variant={activeTab === 'dictionary' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('dictionary')}>
                        Dictionary
                    </Button>
                    {/* Add margin to last item to prevent overlap with Close button on mobile */}
                    <Button variant={activeTab === 'data' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0 text-destructive hover:text-destructive mr-10 sm:mr-0" onClick={() => setActiveTab('data')}>
                        Data Management
                    </Button>
                </div>

                {/* Content */}
                <div className="w-full sm:w-3/4 p-4 sm:p-8 overflow-y-auto flex-1">
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium mb-2">Interaction</h3>
                                <p className="text-sm text-muted-foreground">
                                    General system interaction settings.
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tts' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium mb-4">Provider Configuration</h3>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Active Provider</label>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        <Select value={providerId} onValueChange={(val: any) => setProviderId(val)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="local">Web Speech (Local)</SelectItem>
                                                <SelectItem value="google">Google Cloud TTS</SelectItem>
                                                <SelectItem value="openai">OpenAI</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {providerId === 'local' && (
                                        <div className="space-y-4 pt-4 border-t">
                                            <div className="space-y-1">
                                                <h4 className="text-sm font-medium">Silent Audio Workaround</h4>
                                                <p className="text-xs text-muted-foreground">
                                                    Some systems (like Android) pause playback if audio is totally silent. Use white noise to prevent this.
                                                </p>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Silent Track Type</label>
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                <Select value={silentAudioType} onValueChange={(val: any) => setSilentAudioType(val)}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="silence">Silence (Default)</SelectItem>
                                                        <SelectItem value="white-noise">White Noise</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {silentAudioType === 'white-noise' && (
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <label className="text-sm font-medium">White Noise Volume</label>
                                                        <span className="text-sm text-muted-foreground">{Math.round(whiteNoiseVolume * 100)}%</span>
                                                    </div>
                                                    <Slider
                                                        value={[whiteNoiseVolume]}
                                                        min={0}
                                                        max={1}
                                                        step={0.01}
                                                        onValueChange={(vals) => setWhiteNoiseVolume(vals[0])}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {providerId === 'google' && (
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Google API Key</label>
                                            <Input
                                                type="password"
                                                value={apiKeys.google}
                                                onChange={(e) => setApiKey('google', e.target.value)}
                                            />
                                        </div>
                                    )}
                                    {providerId === 'openai' && (
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">OpenAI API Key</label>
                                            <Input
                                                type="password"
                                                value={apiKeys.openai}
                                                onChange={(e) => setApiKey('openai', e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'dictionary' && (
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
                                <h3 className="text-lg font-medium">Text Segmentation</h3>
                                <p className="text-sm text-muted-foreground">
                                    Define abbreviations that should not trigger a sentence break.
                                </p>
                                <TTSAbbreviationSettings />
                            </div>
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <div className="space-y-6">
                             <div className="space-y-4">
                                <h3 className="text-lg font-medium">Backup & Restore</h3>
                                <p className="text-sm text-muted-foreground">
                                    Export your library and settings to a file, or restore from a previous backup.
                                </p>
                                <div className="flex flex-col gap-2">
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Button onClick={handleExportFull} variant="outline" className="flex-1">
                                            Export Full Backup (ZIP)
                                        </Button>
                                        <Button onClick={handleExportLight} variant="outline" className="flex-1">
                                            Export Metadata Only (JSON)
                                        </Button>
                                    </div>
                                    <Button onClick={handleRestoreClick} variant="default" className="w-full">
                                        Restore Backup
                                    </Button>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept=".zip,.json,.vbackup"
                                        onChange={handleFileChange}
                                        data-testid="backup-file-input"
                                    />
                                    {backupStatus && (
                                        <p className="text-sm text-blue-600 dark:text-blue-400 font-medium animate-pulse">
                                            {backupStatus}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t pt-4 space-y-4">
                                <h3 className="text-lg font-medium">Maintenance</h3>
                                <p className="text-sm text-muted-foreground">
                                    Tools to keep the database healthy.
                                </p>
                                <div className="flex flex-col gap-2">
                                    <Button onClick={handleRepairDB} variant="outline">
                                        Check & Repair Database
                                    </Button>
                                    {orphanScanResult && (
                                        <p className="text-sm text-muted-foreground">{orphanScanResult}</p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t pt-4 space-y-4">
                                <h3 className="text-lg font-medium text-destructive">Danger Zone</h3>
                                <Button variant="destructive" onClick={handleClearAllData}>
                                    Clear All Data
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </ModalContent>
        </Modal>
    );
};
