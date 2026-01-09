import React, { useEffect, useState } from 'react';
import { reprocessBook } from '../../lib/ingestion';
import { useLibraryStore } from '../../store/useLibraryStore';

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
    const fetchBooks = useLibraryStore(state => state.fetchBooks);

    useEffect(() => {
        if (!isOpen || !bookId) return;

        const runReprocessing = async () => {
            setProgress('processing');
            try {
                await reprocessBook(bookId);
                // Refresh store to get updated metadata
                await fetchBooks();
                onComplete();
            } catch (e) {
                console.error("Reprocessing failed", e);
                setError(e instanceof Error ? e.message : 'Unknown error');
                setProgress('error');
            }
        };

        runReprocessing();
    }, [isOpen, bookId, fetchBooks, onComplete]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-lg shadow-lg p-6 max-w-sm w-full space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Upgrading Book...</h3>

                {progress === 'processing' && (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
                             <button
                                onClick={onClose}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
