import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Label } from '../ui/Label';
import { Check, ChevronRight, Download, FileJson, Loader2, FileSpreadsheet } from 'lucide-react';
import { ExportImportService } from '../../lib/sync/ExportImportService';
import { useReadingListStore } from '../../store/useReadingListStore';
import { exportReadingListToCSV } from '../../lib/csv';
import type { ExportFormat } from '../../lib/sync/ExportImportService';
import { cn } from '../../lib/utils';
import type { ExportOptions } from '../../lib/sync/ExportImportService';

interface DataExportWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type WizardStep = 'select' | 'format' | 'download';

export const DataExportWizard: React.FC<DataExportWizardProps> = ({ open, onOpenChange }) => {
    const [step, setStep] = useState<WizardStep>('select');
    const [selection, setSelection] = useState<Omit<ExportOptions, 'prettyPrint' | 'includeReadingList'>>({
        includeLibrary: true,
        includeProgress: true,
        includeSettings: true,
        includeLexicon: true,
        includeAnnotations: true
    });
    const [format, setFormat] = useState<ExportFormat>('json');
    const [isGenerating, setIsGenerating] = useState(false);

    const handleClose = () => {
        onOpenChange(false);
        // Reset state after transition
        setTimeout(() => {
            setStep('select');
            // Reset selection to defaults
            setSelection({
                includeLibrary: true,
                includeProgress: true,
                includeSettings: true,
                includeLexicon: true,
                includeAnnotations: true
            });
            setFormat('json');
        }, 300);
    };

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            // Simulate generation delay for UX
            await new Promise(resolve => setTimeout(resolve, 800));
            setStep('download');
        } catch (error) {
            console.error("Export generation failed", error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = async () => {
        // Construct full options object
        const exportOptions: ExportOptions = {
            ...selection,
            includeReadingList: true, // Defaulting for now as UI doesn't expose it individually yet
            prettyPrint: true
        };

        if (format === 'json') {
            await ExportImportService.exportAndDownload(exportOptions);
        } else if (format === 'csv') {
            // CSV Export
            const entries = Object.values(useReadingListStore.getState().entries);
            const csvContent = exportReadingListToCSV(entries);
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const filename = `versicle-reading-list-${new Date().toISOString().split('T')[0]}.csv`;
            ExportImportService.downloadBlob(blob, filename);
        }
        handleClose();
    };

    const Footer = () => {
        if (step === 'select') {
            return (
                <div className="flex justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                    <Button onClick={() => setStep('format')}>
                        Next
                        <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            );
        }
        if (step === 'format') {
            return (
                <div className="flex justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={() => setStep('select')}>Back</Button>
                    <Button onClick={handleGenerate} disabled={isGenerating}>
                        {isGenerating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                Generate Export
                                <ChevronRight className="ml-2 h-4 w-4" />
                            </>
                        )}
                    </Button>
                </div>
            );
        }
        // Download step
        return (
            <div className="flex justify-end gap-2 w-full">
                <Button onClick={handleClose}>Done</Button>
            </div>
        );
    };

    return (
        <Dialog
            isOpen={open}
            onClose={handleClose}
            title={
                step === 'select' ? "Export Your Data" :
                    step === 'format' ? "Choose Format" :
                        "Download Export"
            }
            description={
                step === 'select' ? "Select what data you want to include in this backup." :
                    step === 'format' ? "Choose how you want to download your data." :
                        "Your synchronized data is ready for download."
            }
            footer={<Footer />}
        >
            <div className="py-4">
                {step === 'select' && (
                    <div className="grid gap-4">
                        <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="export-library">
                                    Library & Reading Progress
                                </Label>
                                <p id="export-library-desc" className="text-xs text-muted-foreground">
                                    Books, reading locations, time played, and completion status.
                                </p>
                            </div>
                            <Checkbox
                                id="export-library"
                                aria-describedby="export-library-desc"
                                checked={selection.includeLibrary}
                                onCheckedChange={(c) => setSelection(s => ({
                                    ...s,
                                    includeLibrary: !!c,
                                    includeProgress: !!c
                                }))}
                            />
                        </div>
                        <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="export-settings">
                                    Preferences & Settings
                                </Label>
                                <p id="export-settings-desc" className="text-xs text-muted-foreground">
                                    Themes, fonts, TTS settings, and app configuration.
                                </p>
                            </div>
                            <Checkbox
                                id="export-settings"
                                aria-describedby="export-settings-desc"
                                checked={selection.includeSettings}
                                onCheckedChange={(c) => setSelection(s => ({ ...s, includeSettings: !!c }))}
                            />
                        </div>
                        <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="export-annotations">
                                    Annotations & Lexicon
                                </Label>
                                <p id="export-annotations-desc" className="text-xs text-muted-foreground">
                                    Highlights, bookmarks, and pronunciation rules.
                                </p>
                            </div>
                            <Checkbox
                                id="export-annotations"
                                aria-describedby="export-annotations-desc"
                                checked={selection.includeAnnotations}
                                onCheckedChange={(c) => setSelection(s => ({
                                    ...s,
                                    includeAnnotations: !!c,
                                    includeLexicon: !!c
                                }))}
                            />
                        </div>
                    </div>
                )}

                {step === 'format' && (
                    <div className="grid gap-4">
                        <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Export format">
                            <button
                                type="button"
                                role="radio"
                                aria-checked={format === 'json'}
                                className={cn(
                                    "cursor-pointer rounded-lg border-2 p-4 hover:bg-muted/50 transition-colors text-left",
                                    format === 'json' ? "border-primary bg-muted/50" : "border-muted"
                                )}
                                onClick={() => setFormat('json')}
                            >
                                <FileJson className="mb-2 h-6 w-6" />
                                <div className="font-semibold">JSON</div>
                                <div className="text-xs text-muted-foreground">Machine readable. Best for backups.</div>
                            </button>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={format === 'csv'}
                                className={cn(
                                    "cursor-pointer rounded-lg border-2 p-4 hover:bg-muted/50 transition-colors text-left",
                                    format === 'csv' ? "border-primary bg-muted/50" : "border-muted"
                                )}
                                onClick={() => setFormat('csv')}
                                data-testid="format-csv-option"
                            >
                                <FileSpreadsheet className="mb-2 h-6 w-6" />
                                <div className="font-semibold">CSV</div>
                                <div className="text-xs text-muted-foreground">Spreadsheet compatible. Reading list only.</div>
                            </button>
                        </div>
                    </div>
                )}

                {step === 'download' && (
                    <div className="flex flex-col items-center justify-center space-y-4 py-8">
                        <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 dark:bg-green-900/20 dark:text-green-400">
                            <Check className="h-6 w-6" />
                        </div>
                        <h3 className="text-lg font-medium">Export Ready</h3>
                        <p className="text-center text-sm text-muted-foreground max-w-xs">
                            Your data has been packaged successfully. Click below to save the file.
                        </p>
                        <Button size="lg" className="w-full max-w-xs" onClick={handleDownload} data-testid="download-export-btn">
                            <Download className="mr-2 h-4 w-4" />
                            Download {format.toUpperCase()}
                        </Button>
                    </div>
                )}
            </div>
        </Dialog>
    );
};
