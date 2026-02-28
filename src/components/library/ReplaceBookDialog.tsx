import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';

interface ReplaceBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    fileName: string;
}

export const ReplaceBookDialog: React.FC<ReplaceBookDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    fileName
}) => {
    const [isReplacing, setIsReplacing] = useState(false);

    const handleConfirm = async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (isReplacing) return;
        setIsReplacing(true);

        try {
            await onConfirm();
            onClose();
        } catch (error) {
            console.error("Failed to replace book:", error);
            // We keep the dialog open if there's an error so the user can try again or cancel
        } finally {
            setIsReplacing(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => {
                if (!isReplacing) onClose();
            }}
            title="Replace Book?"
            description={`"${fileName}" already exists in your library. Do you want to replace it?`}
            footer={
                <>
                    <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        disabled={isReplacing}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isReplacing}
                        data-testid="confirm-replace"
                        className="gap-2"
                    >
                        {isReplacing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isReplacing ? "Replacing..." : "Replace"}
                    </Button>
                </>
            }
        />
    );
};
