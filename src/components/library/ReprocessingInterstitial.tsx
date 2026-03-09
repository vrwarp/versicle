import React, { useEffect, useState } from 'react';
import { reprocessBook } from '../../lib/ingestion';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';

interface ReprocessingInterstitialProps {
    isOpen: boolean;
    bookId: string | null;
    onComplete: () => void;
    onClose: () => void;
}

export const ReprocessingInterstitial: React.FC<ReprocessingInterstitialProps> = ({
    isOpen,
    bookId,
    onComplete,
    onClose
}) => {
    const [progress, setProgress] = useState<'idle' | 'processing' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !bookId) return;

        const runReprocessing = async () => {
            setProgress('processing');
            try {
                await reprocessBook(bookId);
                // Refresh store to get updated metadata (especially schemaVersion)
                await useLibraryStore.getState().hydrateStaticMetadata();
                onComplete();
            } catch (e) {
                console.error("Reprocessing failed", e);
                setError(e instanceof Error ? e.message : 'Unknown error');
                setProgress('error');
            }
        };

        runReprocessing();
    }, [isOpen, bookId, onComplete]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-lg shadow-lg p-6 max-w-sm w-full space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Upgrading Book...</h3>

                {progress === 'processing' && (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                        <p className="text-sm text-muted-foreground text-center">
                            We're updating this book to the latest format to improve performance and features.
                        </p>
                    </div>
                )}

                {progress === 'error' && (
                    <div className="space-y-4">
                        <p className="text-sm text-destructive">
                            Failed to upgrade book: {error}
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="secondary"
                                onClick={onClose}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
