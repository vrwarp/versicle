import React, { useRef } from 'react';
import { ThemeSelector } from '../ThemeSelector';
import { Button } from '../ui/Button';
import { ImportProgressUI } from '../library/ImportProgressUI';

export type ThemeType = 'light' | 'dark' | 'sepia';

export interface GeneralSettingsTabProps {
    // Theme
    currentTheme: ThemeType;
    onThemeChange: (theme: ThemeType) => void;
    // Import state
    isImporting: boolean;
    // Handlers
    onBatchImport: (files: FileList) => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
    currentTheme,
    onThemeChange,
    isImporting,
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
                    <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                        <ImportProgressUI />
                    </div>
                )}
            </div>

            <div className="border-t pt-6 space-y-4">
                <div>
                    <h3 className="text-lg font-medium mb-2">Credits & Licenses</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Versicle is built on the shoulders of giants. We are incredibly grateful to the open-source community for providing the core technologies and datasets that power this local-first, privacy-focused reader.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="text-sm">
                        <span className="font-semibold block text-foreground mb-0.5">CC-CEDICT Dictionary</span>
                        <p className="text-muted-foreground leading-normal">
                            Our offline Chinese-English translation features are powered by the{' '}
                            <a 
                                href="https://cc-cedict.org/" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                CC-CEDICT
                            </a>{' '}
                            dictionary database compiled and maintained by{' '}
                            <a 
                                href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                MDBG
                            </a>
                            . The database is licensed under the{' '}
                            <a 
                                href="https://creativecommons.org/licenses/by-sa/4.0/" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                CC BY-SA 4.0
                            </a>
                            . Modified dictionary structured assets remain subject to the same terms.
                        </p>
                    </div>

                    <div className="text-sm">
                        <span className="font-semibold block text-foreground mb-0.5">Piper WASM (Offline Text-to-Speech)</span>
                        <p className="text-muted-foreground leading-normal">
                            High-quality, local, and private offline voice generation is powered by the open-source{' '}
                            <a 
                                href="https://github.com/rhasspy/piper" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                Piper
                            </a>{' '}
                            text-to-speech engine (MIT License) and its web-optimized{' '}
                            <a 
                                href="https://github.com/thewh1teagle/piper-wasm" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                piper-wasm
                            </a>{' '}
                            port.
                        </p>
                    </div>

                    <div className="text-sm">
                        <span className="font-semibold block text-foreground mb-0.5">OpenCC (Chinese Conversion)</span>
                        <p className="text-muted-foreground leading-normal">
                            Simplified-to-Traditional character translation utilizes the web-optimized{' '}
                            <a 
                                href="https://github.com/skishore/opencc-js" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                opencc-js
                            </a>{' '}
                            converter (Apache License 2.0).
                        </p>
                    </div>

                    <div className="text-sm">
                        <span className="font-semibold block text-foreground mb-0.5">Epub.js (EPUB Layout Engine)</span>
                        <p className="text-muted-foreground leading-normal">
                            High-fidelity rendering of book layouts and flow navigation is powered by{' '}
                            <a 
                                href="https://github.com/futurepress/epub.js" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                                epub.js
                            </a>{' '}
                            (BSD 2-Clause License).
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
