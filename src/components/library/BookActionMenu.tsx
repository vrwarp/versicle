import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { Trash2, CloudOff, RefreshCw } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import type { BookMetadata } from '../../types/db';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

interface BookActionMenuProps {
    book: BookMetadata;
    /** The trigger element to be wrapped by the menu trigger (usually an icon button). */
    children: React.ReactNode;
}

/**
 * Handle interface for accessing component methods via ref.
 * Primarily used to trigger the file restoration input from parent components (e.g., BookCard click).
 */
export interface BookActionMenuHandle {
    /** Triggers the hidden file input click to start the restore process. */
    triggerRestore: () => void;
}

/**
 * BookActionMenu encapsulates the "More Options" dropdown logic for book items.
 *
 * It handles:
 * - Delete and Offload/Restore actions with confirmation dialogs.
 * - File input management for restoring offloaded books.
 * - Custom event handling to prevent menu interaction from interfering with list scrolling/swiping.
 * - Exposing restoration trigger via ref for card-level interactions.
 */
export const BookActionMenu = forwardRef<BookActionMenuHandle, BookActionMenuProps>(({ book, children }, ref) => {
    const { removeBook, offloadBook, restoreBook } = useLibraryStore();
    const showToast = useToastStore(state => state.showToast);

    const [open, setOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isOffloadDialogOpen, setIsOffloadDialogOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Expose triggerRestore to allow parents (like BookCard) to initiate restore on card click
    useImperativeHandle(ref, () => ({
        triggerRestore: () => {
            fileInputRef.current?.click();
        }
    }));

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await removeBook(book.id);
        showToast(`Deleted "${book.title}"`, 'success');
        setIsDeleteDialogOpen(false);
    };

    const handleOffloadClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        setIsOffloadDialogOpen(true);
    };

    const confirmOffload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await offloadBook(book.id);
        showToast(`Offloaded "${book.title}"`, 'success');
        setIsOffloadDialogOpen(false);
    };

    const handleRestoreClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.target.files && e.target.files[0]) {
            try {
                await restoreBook(book.id, e.target.files[0]);
                showToast(`Restored "${book.title}"`, 'success');
            } catch (error) {
                console.error("Restore failed", error);
                showToast("Failed to restore book", "error");
            }
        }
        if (e.target.value) {
            e.target.value = '';
        }
    };

    return (
        <>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".epub"
                className="hidden"
                data-testid={`restore-input-${book.id}`}
                onClick={(e) => e.stopPropagation()}
            />

            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <div
                        onClick={(e) => {
                            // Prevent click from bubbling to parent (e.g. opening the book)
                            e.stopPropagation();
                            setOpen((prev) => !prev);
                        }}
                        onPointerDown={(e) => {
                            // Stop propagation to prevent scrolling/swiping interference in list views.
                            // Default Radix DropdownMenuTrigger pointer-down behavior can capture scroll events.
                            e.stopPropagation();
                        }}
                        role="button"
                        aria-label="Book actions"
                        className="inline-block"
                    >
                        {children}
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {!book.isOffloaded ? (
                        <DropdownMenuItem onClick={handleOffloadClick} data-testid="menu-offload" className="cursor-pointer gap-2 text-amber-600 focus:text-amber-700">
                            <CloudOff className="w-4 h-4" />
                            <span>Offload File</span>
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onClick={handleRestoreClick} data-testid="menu-restore" className="cursor-pointer gap-2">
                            <RefreshCw className="w-4 h-4" />
                            <span>Restore File</span>
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={handleDeleteClick} className="text-destructive focus:text-destructive cursor-pointer gap-2" data-testid="menu-delete">
                        <Trash2 className="w-4 h-4" />
                        <span>Delete</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog
                isOpen={isOffloadDialogOpen}
                onClose={() => setIsOffloadDialogOpen(false)}
                title="Offload Book"
                description={`Offload "${book.title}"? This will delete the local file to save space but keep your reading progress and annotations.`}
                footer={
                    <>
                        <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setIsOffloadDialogOpen(false); }}>
                            Cancel
                        </Button>
                        <Button
                            variant="default"
                            onClick={confirmOffload}
                            data-testid="confirm-offload"
                        >
                            Offload
                        </Button>
                    </>
                }
            />

            <Dialog
                isOpen={isDeleteDialogOpen}
                onClose={() => setIsDeleteDialogOpen(false)}
                title="Delete Book"
                description={`Are you sure you want to delete "${book.title}"? This cannot be undone.`}
                footer={
                    <>
                        <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setIsDeleteDialogOpen(false); }}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmDelete}
                            data-testid="confirm-delete"
                        >
                            Delete
                        </Button>
                    </>
                }
            />
        </>
    );
});

BookActionMenu.displayName = "BookActionMenu";
