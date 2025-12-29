import React, { useRef, useState } from 'react';
import { MoreVertical, Trash2, HardDriveDownload, HardDriveUpload } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import type { BookMetadata } from '../../types/db';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

interface BookActionMenuProps {
    book: BookMetadata;
    className?: string; // For the trigger button
    variant?: 'list' | 'card';
    testId?: string;
}

export const BookActionMenu: React.FC<BookActionMenuProps> = ({ book, className, variant = 'list', testId }) => {
    const { removeBook, offloadBook, restoreBook } = useLibraryStore();
    const showToast = useToastStore(state => state.showToast);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isOffloadDialogOpen, setIsOffloadDialogOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDeleteDialogOpen(true);
        setIsMenuOpen(false);
    };

    const confirmDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await removeBook(book.id);
        showToast(`Deleted "${book.title}"`, 'success');
        setIsDeleteDialogOpen(false);
    };

    const handleOffloadClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOffloadDialogOpen(true);
        setIsMenuOpen(false);
    };

    const confirmOffload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await offloadBook(book.id);
        showToast(`Offloaded "${book.title}"`, 'success');
        setIsOffloadDialogOpen(false);
    };

    const handleRestoreClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        fileInputRef.current?.click();
        setIsMenuOpen(false);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                await restoreBook(book.id, e.target.files[0]);
                showToast(`Restored "${book.title}"`, 'success');
            } catch (error) {
                console.error("Restore failed", error);
            }
        }
        if (e.target.value) {
            e.target.value = '';
        }
    };

    // Card style trigger
    const cardTriggerClass = cn(
        "rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity",
        "h-11 w-11", // Minimum 44px touch target
        "opacity-100 md:opacity-0 md:group-hover:opacity-100", // Always visible on mobile
        "touch-manipulation",
        className
    );

    // List style trigger
    const listTriggerClass = cn(
        "p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors focus:opacity-100 touch-manipulation",
        "opacity-100 md:opacity-0 md:group-hover:opacity-100",
        className
    );

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={variant === 'card' ? "h-11 w-11" : undefined}
        >
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".epub"
                className="hidden"
                data-testid={`restore-input-${book.id}`}
            />
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={variant === 'card' ? cardTriggerClass : listTriggerClass}
                        data-testid={testId || `book-actions-${book.id}`}
                        aria-label="Book actions"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsMenuOpen((prev) => !prev);
                        }}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-popover text-popover-foreground border-border">
                    {!book.isOffloaded ? (
                        <DropdownMenuItem onClick={handleOffloadClick} className="cursor-pointer gap-2 text-amber-600 focus:text-amber-700" data-testid="menu-offload">
                             <HardDriveDownload className="w-4 h-4" />
                             <span>Offload File</span>
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onClick={handleRestoreClick} className="cursor-pointer gap-2" data-testid="menu-restore">
                            <HardDriveUpload className="w-4 h-4" />
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
        </div>
    );
};
