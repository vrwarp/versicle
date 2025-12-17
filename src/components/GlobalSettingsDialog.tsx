import { useState, useRef, useEffect } from 'react';
import { useUIStore } from '../store/useUIStore';
import { useTTSStore } from '../store/useTTSStore';
import { Modal, ModalContent } from './ui/Modal';
import { Button } from './ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Input } from './ui/Input';
import { Slider } from './ui/Slider';
import { Switch } from './ui/Switch';
import { useGenAIStore } from '../store/useGenAIStore';
import { TTSAbbreviationSettings } from './reader/TTSAbbreviationSettings';
import { LexiconManager } from './reader/LexiconManager';
import { getDB } from '../db/db';
import { maintenanceService } from '../lib/MaintenanceService';
import { backupService } from '../lib/BackupService';
import { Trash2, Download } from 'lucide-react';

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
    const [backupStatus, setBackupStatus] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        providerId, setProviderId,
        apiKeys, setApiKey,
        silentAudioType, setSilentAudioType,
        whiteNoiseVolume, setWhiteNoiseVolume,
        voice, voices, setVoice,
        downloadVoice, deleteVoice, downloadProgress, downloadStatus, isDownloading, checkVoiceDownloaded
    } = useTTSStore();

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
        logs: genAILogs
    } = useGenAIStore();

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

    const handleDownloadGenAILogs = () => {
        const content = genAILogs.map(log =>
            `[${new Date(log.timestamp).toISOString()}] ${log.type.toUpperCase()} (${log.method})\n` +
            JSON.stringify(log.payload, null, 2) +
            `\n${'-'.repeat(40)}\n`
        ).join('\n');

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `genai_logs_${new Date().toISOString()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                    <Button variant={activeTab === 'genai' ? 'secondary' : 'ghost'} className="w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0" onClick={() => setActiveTab('genai')}>
                        Generative AI
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
                                                <SelectItem value="piper">Piper (High Quality Local)</SelectItem>
                                                <SelectItem value="google">Google Cloud TTS</SelectItem>
                                                <SelectItem value="openai">OpenAI</SelectItem>
                                                <SelectItem value="lemonfox">LemonFox.ai</SelectItem>
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

                                    {providerId === 'piper' && (
                                        <div className="space-y-4 pt-4 border-t">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Select Voice</label>
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                <Select value={voice?.id} onValueChange={(val: any) => {
                                                    const v = voices.find(v => v.id === val);
                                                    setVoice(v || null);
                                                }}>
                                                    <SelectTrigger><SelectValue placeholder="Select a voice" /></SelectTrigger>
                                                    <SelectContent>
                                                        {voices.map(v => (
                                                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {voice && (
                                                <div className="space-y-3 p-3 bg-muted/50 rounded-md">
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-sm font-medium">Voice Data</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {isVoiceReady ? "Downloaded" : "Not Downloaded"}
                                                            </span>
                                                        </div>

                                                        {isDownloading ? (
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between text-xs">
                                                                     <span>{downloadStatus}</span>
                                                                     <span>{Math.round(downloadProgress)}%</span>
                                                                </div>
                                                                <div className="h-2 bg-secondary rounded overflow-hidden">
                                                                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    onClick={() => downloadVoice(voice.id)}
                                                                    variant={isVoiceReady ? "outline" : "default"}
                                                                    disabled={isVoiceReady}
                                                                    size="sm"
                                                                    className="flex-1"
                                                                >
                                                                    {isVoiceReady ? "Ready to Use" : "Download Voice Data"}
                                                                </Button>
                                                                {isVoiceReady && (
                                                                    <Button
                                                                        onClick={() => {
                                                                            if (confirm('Delete downloaded voice data?')) {
                                                                                deleteVoice(voice.id).then(() => {
                                                                                    setIsVoiceReady(false);
                                                                                });
                                                                            }
                                                                        }}
                                                                        variant="destructive"
                                                                        size="icon"
                                                                        title="Delete Voice Data"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
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
                                    {providerId === 'lemonfox' && (
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">LemonFox API Key</label>
                                            <Input
                                                type="password"
                                                value={apiKeys.lemonfox}
                                                onChange={(e) => setApiKey('lemonfox', e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'genai' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium mb-4">Generative AI Configuration</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    Enable advanced features powered by Google Gemini (e.g., smart TOC, pronunciation guides).
                                </p>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label htmlFor="genai-toggle" className="text-sm font-medium">Enable AI Features</label>
                                            <p className="text-xs text-muted-foreground">
                                                Allows the app to send content to the AI provider.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-toggle"
                                            checked={isGenAIEnabled}
                                            onCheckedChange={setGenAIEnabled}
                                        />
                                    </div>

                                    {isGenAIEnabled && (
                                        <>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Gemini API Key</label>
                                                <Input
                                                    type="password"
                                                    value={genAIApiKey}
                                                    onChange={(e) => setGenAIApiKey(e.target.value)}
                                                    placeholder="Enter your Google Gemini API Key"
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    Your key is stored locally on this device.
                                                </p>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Model</label>
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                <Select value={genAIModel} onValueChange={(val: any) => setGenAIModel(val)}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Recommended)</SelectItem>
                                                        <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                                                        <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                                                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="pt-4 border-t space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-medium">Debug Logs</h4>
                                                    <Button variant="outline" size="sm" onClick={handleDownloadGenAILogs} disabled={genAILogs.length === 0}>
                                                        <Download className="h-4 w-4 mr-2" />
                                                        Download Logs
                                                    </Button>
                                                </div>
                                                <div className="bg-muted p-2 rounded-md h-40 overflow-y-auto font-mono text-xs">
                                                    {genAILogs.length === 0 ? (
                                                        <span className="text-muted-foreground">No logs available.</span>
                                                    ) : (
                                                        genAILogs.slice().reverse().map(log => (
                                                            <div key={log.id} className="mb-2 border-b last:border-0 pb-2">
                                                                <div className="font-semibold text-primary">
                                                                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.type.toUpperCase()} - {log.method}
                                                                </div>
                                                                <div className="whitespace-pre-wrap truncate line-clamp-2">
                                                                    {JSON.stringify(log.payload)}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </>
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
