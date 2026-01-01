import React, { useState } from 'react';
import { Trash2, CloudOff, RefreshCw } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/DropdownMenu';

interface BookActionMenuProps {
    book: BookMetadata;
    /** The trigger element to be wrapped by the menu trigger (usually an icon button). */
    children: React.ReactNode;
    onDelete: (book: BookMetadata) => void;
    onOffload: (book: BookMetadata) => void;
    onRestore: (book: BookMetadata) => void;
}

/**
 * BookActionMenu encapsulates the "More Options" dropdown logic for book items.
 *
 * It handles:
 * - Triggering actions (Delete, Offload, Restore) via callbacks.
 * - Custom event handling to prevent menu interaction from interfering with list scrolling/swiping.
 */
export const BookActionMenu: React.FC<BookActionMenuProps> = ({ book, children, onDelete, onOffload, onRestore }) => {
    const [open, setOpen] = useState(false);

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        onDelete(book);
    };

    const handleOffloadClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        onOffload(book);
    };

    const handleRestoreClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
        onRestore(book);
    };

    return (
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
    );
};
