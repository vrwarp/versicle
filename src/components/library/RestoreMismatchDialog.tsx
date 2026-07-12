import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Loader2, AlertTriangle } from 'lucide-react';

interface RestoreMismatchDialogProps {
    isOpen: boolean;
    bookTitle: string;
    /** Dismiss without restoring — the default (safe) action. */
    onCancel: () => void;
    /** Restore anyway, accepting the content-hash mismatch. */
    onProceed: () => Promise<void>;
}

/**
 * Second-chance warning shown when the file chosen to restore an offloaded
 * book does NOT match its stored content hash. Instead of failing outright,
 * we let the user proceed — the intended path when they've deliberately
 * updated the EPUB. Cancel is the emphasized default action; "Proceed
 * Anyway" is the de-emphasized secondary that carries the warning sign.
 */
export const RestoreMismatchDialog: React.FC<RestoreMismatchDialogProps> = ({
    isOpen,
    bookTitle,
    onCancel,
    onProceed,
}) => {
    const [isProceeding, setIsProceeding] = useState(false);

    const handleProceed = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isProceeding) return;
        setIsProceeding(true);
        try {
            await onProceed();
        } finally {
            setIsProceeding(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => {
                if (!isProceeding) onCancel();
            }}
            title="Content Doesn't Match"
            description={`The file you picked doesn't match the original content of "${bookTitle}".`}
            footer={
                <>
                    <Button
                        variant="outline"
                        onClick={handleProceed}
                        disabled={isProceeding}
                        data-testid="restore-mismatch-proceed"
                        className="gap-2"
                    >
                        {isProceeding && (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                <span className="sr-only" aria-live="polite">Restoring...</span>
                            </>
                        )}
                        <span aria-hidden={isProceeding}>
                            {isProceeding ? 'Restoring...' : '⚠️ Proceed Anyway'}
                        </span>
                    </Button>
                    <Button
                        variant="default"
                        onClick={(e) => { e.stopPropagation(); onCancel(); }}
                        disabled={isProceeding}
                        data-testid="restore-mismatch-cancel"
                    >
                        Cancel
                    </Button>
                </>
            }
        >
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-1 text-sm">
                    <p className="font-medium text-amber-600">This isn't the same file</p>
                    <p className="text-xs text-muted-foreground">
                        This is expected if you've updated the EPUB. Proceeding loads the
                        new file and rebuilds this book's content from it. Your reading
                        progress and notes are kept.
                    </p>
                </div>
            </div>
        </Dialog>
    );
};
