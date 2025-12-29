import React, { useState, useRef } from 'react';
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
    children: React.ReactNode;
}

export const BookActionMenu: React.FC<BookActionMenuProps> = ({ book, children }) => {
    const { removeBook, offloadBook, restoreBook } = useLibraryStore();
    const showToast = useToastStore(state => state.showToast);

    const [open, setOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isOffloadDialogOpen, setIsOffloadDialogOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                            e.stopPropagation();
                            setOpen((prev) => !prev);
                        }}
                        onPointerDown={(e) => {
                            // Stop propagation to prevent scrolling/swiping interference
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
};
