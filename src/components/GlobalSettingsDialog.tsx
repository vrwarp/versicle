import { useState } from 'react';
import { useUIStore } from '../store/useUIStore';
import { useTTSStore } from '../store/useTTSStore';
import { Modal, ModalContent } from './ui/Modal';
import { Button } from './ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Input } from './ui/Input';
import { TTSAbbreviationSettings } from './reader/TTSAbbreviationSettings';
import { LexiconManager } from './reader/LexiconManager';
import { getDB } from '../db/db';
import { maintenanceService } from '../lib/MaintenanceService';

export const GlobalSettingsDialog = () => {
    const { isGlobalSettingsOpen, setGlobalSettingsOpen } = useUIStore();
    const [activeTab, setActiveTab] = useState('general');
    const [isLexiconOpen, setIsLexiconOpen] = useState(false);
    const [orphanScanResult, setOrphanScanResult] = useState<string | null>(null);

    const {
        providerId, setProviderId,
        apiKeys, setApiKey
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
