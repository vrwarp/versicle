import React, { useRef } from 'react';
import { ThemeSelector } from '../ThemeSelector';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';

export type ThemeType = 'light' | 'dark' | 'sepia';

export interface GeneralSettingsTabProps {
    // Theme
    currentTheme: ThemeType;
    onThemeChange: (theme: ThemeType) => void;
    // Import state
    isImporting: boolean;
    importProgress: number;
    importStatus: string;
    uploadProgress: number;
    uploadStatus: string;
    // Handlers
    onBatchImport: (files: FileList) => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
    currentTheme,
    onThemeChange,
    isImporting,
    importProgress,
    importStatus,
    uploadProgress,
    uploadStatus,
    onBatchImport
}) => {
    const zipImportRef = useRef<HTMLInputElement>(null);
    const folderImportRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onBatchImport(e.target.files);
        }
        e.target.value = '';
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-4">Appearance</h3>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">Theme</h4>
                        <ThemeSelector
                            currentTheme={currentTheme}
                            onThemeChange={onThemeChange}
                            className="w-full sm:w-[400px]"
                        />
                        <p className="text-sm text-muted-foreground pt-1">
                            Choose the application theme.
                        </p>
                    </div>
                </div>
            </div>

            <div className="border-t pt-6">
                <h3 className="text-lg font-medium mb-4">Advanced Import</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Tools for importing multiple books at once.
                </p>
                <div className="flex flex-col gap-2">
                    <Button
                        variant="outline"
                        onClick={() => zipImportRef.current?.click()}
                        disabled={isImporting}
                    >
                        Import ZIP Archive
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => folderImportRef.current?.click()}
                        disabled={isImporting}
                    >
                        Import Folder
                    </Button>
                </div>
                <input
                    type="file"
                    ref={zipImportRef}
                    accept=".zip"
                    className="hidden"
                    onChange={handleFileChange}
                    data-testid="zip-import-input"
                />
                <input
                    type="file"
                    ref={folderImportRef}
                    // @ts-expect-error webkitdirectory is non-standard
                    webkitdirectory=""
                    directory=""
                    className="hidden"
                    onChange={handleFileChange}
                    data-testid="folder-import-input"
                />

                {isImporting && (
                    <div className="flex flex-col items-center justify-center space-y-3 mt-4 p-4 bg-muted/30 rounded-lg">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />

                        <div className="w-full flex flex-col items-center space-y-1">
                            <p className="text-sm text-muted-foreground">{uploadStatus || 'Processing files...'}</p>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary/70 transition-all duration-300 ease-out"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>

                        {(importProgress > 0 || uploadProgress >= 100) && (
                            <div className="w-full flex flex-col items-center space-y-1 mt-2">
                                <p className="text-muted-foreground font-medium">{importStatus || 'Importing books...'}</p>
                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-300 ease-out"
                                        style={{ width: `${importProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
