import React, { useRef } from 'react';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';

export interface DataManagementTabProps {
    // Reading List
    readingListCount: number;
    onViewReadingList: () => void;
    onExportReadingList: () => void;
    onImportReadingList: (file: File) => void;
    // Backup
    backupStatus: string | null;
    onExportFull: () => void;
    onExportWizard: () => void;
    onExportLight: () => void;
    onRestoreBackup: (file: File) => void;
    // Maintenance
    isScanning: boolean;
    orphanScanResult: string | null;
    onRepairDB: () => void;
    isRegenerating: boolean;
    regenerationProgress: string | null;
    regenerationPercent: number;
    onRegenerateMetadata: () => void;
    // Danger Zone
    onClearAllData: () => void;
}

export const DataManagementTab: React.FC<DataManagementTabProps> = ({
    readingListCount,
    onViewReadingList,
    onExportReadingList,
    onImportReadingList,
    backupStatus,
    onExportFull,
    onExportWizard,
    onExportLight,
    onRestoreBackup,
    isScanning,
    orphanScanResult,
    onRepairDB,
    isRegenerating,
    regenerationProgress,
    regenerationPercent,
    onRegenerateMetadata,
    onClearAllData
}) => {
    const csvInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImportReadingList(file);
        }
        e.target.value = '';
    };

    const handleBackupChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onRestoreBackup(file);
        }
        e.target.value = '';
    };

    return (
        <div className="space-y-6">
            {/* Reading List Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium">Reading List & Sync</h3>
                <p className="text-sm text-muted-foreground">
                    Manage your reading history separately from book files. Syncs with Goodreads CSV.
                </p>
                <div className="p-3 bg-muted/50 rounded-md flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Entries in Reading List</span>
                    <span className="text-sm">{readingListCount}</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={onViewReadingList} variant="default" className="flex-1">
                        View List
                    </Button>
                    <Button onClick={onExportReadingList} variant="outline" className="flex-1">
                        Export to CSV
                    </Button>
                    <Button onClick={() => csvInputRef.current?.click()} variant="outline" className="flex-1">
                        Import CSV
                    </Button>
                    <input
                        type="file"
                        ref={csvInputRef}
                        className="hidden"
                        accept=".csv"
                        onChange={handleCsvChange}
                        data-testid="reading-list-csv-input"
                    />
                </div>
            </div>

            {/* Backup & Restore Section */}
            <div className="border-t pt-4 space-y-4">
                <h3 className="text-lg font-medium">Backup & Restore</h3>
                <p className="text-sm text-muted-foreground">
                    Export your library and settings to a file, or restore from a previous backup.
                </p>
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button onClick={onExportFull} variant="outline" className="flex-1">
                            Export Full Backup (ZIP)
                        </Button>
                        <Button onClick={onExportWizard} variant="outline" className="flex-1" data-testid="export-wizard-btn">
                            Export Wizard (JSON)
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button onClick={onExportLight} variant="ghost" className="text-xs text-muted-foreground">
                            Quick JSON Export (Legacy)
                        </Button>
                    </div>
                    <Button onClick={() => fileInputRef.current?.click()} variant="default" className="w-full">
                        Restore Backup
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept=".zip,.json,.vbackup"
                        onChange={handleBackupChange}
                        data-testid="backup-file-input"
                    />
                    {backupStatus && (
                        <p className="text-sm text-blue-600 dark:text-blue-400 font-medium animate-pulse">
                            {backupStatus}
                        </p>
                    )}
                </div>
            </div>

            {/* Maintenance Section */}
            <div className="border-t pt-4 space-y-4">
                <h3 className="text-lg font-medium">Maintenance</h3>
                <p className="text-sm text-muted-foreground">
                    Tools to keep the database healthy.
                </p>
                <div className="flex flex-col gap-2">
                    <Button onClick={onRepairDB} variant="outline" disabled={isScanning}>
                        {isScanning ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Scanning...
                            </>
                        ) : (
                            "Check & Repair Database"
                        )}
                    </Button>
                    {orphanScanResult && (
                        <p className="text-sm text-muted-foreground">{orphanScanResult}</p>
                    )}
                    <Button onClick={onRegenerateMetadata} variant="outline" disabled={isRegenerating}>
                        {isRegenerating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Regenerating...
                            </>
                        ) : (
                            "Regenerate All Metadata"
                        )}
                    </Button>
                    {isRegenerating && (
                        <div className="w-full flex flex-col items-center space-y-1 mt-2">
                            <p className="text-xs text-muted-foreground">{regenerationProgress}</p>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${regenerationPercent}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {regenerationProgress && !isRegenerating && (
                        <p className="text-sm text-muted-foreground">{regenerationProgress}</p>
                    )}
                </div>
            </div>

            {/* Danger Zone */}
            <div className="border-t pt-4 space-y-4">
                <h3 className="text-lg font-medium text-destructive">Danger Zone</h3>
                <Button variant="destructive" onClick={onClearAllData}>
                    Clear All Data
                </Button>
            </div>
        </div>
    );
};
