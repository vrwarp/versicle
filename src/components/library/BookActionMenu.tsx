import React, { forwardRef, useImperativeHandle } from 'react';
import { Trash2, CloudOff, RefreshCw } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { cn } from '../../lib/utils';

interface BookActionMenuProps {
    book: BookMetadata;
    /** The trigger element to be wrapped by the menu trigger (usually an icon button). */
    children: React.ReactNode;
    onDelete: () => void;
    onOffload: () => void;
    onRestore: () => void;
}

/**
 * Handle interface for accessing component methods via ref.
 * Primarily used to trigger the restore action from parent components (e.g., BookCard click).
 */
export interface BookActionMenuHandle {
    /** Triggers the restore action. */
    triggerRestore: () => void;
}

/**
 * BookActionMenu encapsulates the "More Options" dropdown logic for book items.
 *
 * It is now a lightweight stateless trigger that delegates actions to the parent coordinator.
 */
export const BookActionMenu = forwardRef<BookActionMenuHandle, BookActionMenuProps>(({ book, children, onDelete, onOffload, onRestore }, ref) => {
    // Expose triggerRestore to allow parents (like BookCard) to initiate restore on card click
    useImperativeHandle(ref, () => ({
        triggerRestore: () => {
            onRestore();
        }
    }));

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete();
    };

    const handleOffloadClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onOffload();
    };

    const handleRestoreClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onRestore();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Prevent key events from bubbling to parent (e.g. BookCard opening on Enter)
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div
                    onClick={(e) => {
                        // Prevent click from bubbling to parent (e.g. opening the book)
                        e.stopPropagation();
                    }}
                    onPointerDown={(e) => {
                        // Stop propagation to prevent scrolling/swiping interference in list views.
                        // Default Radix DropdownMenuTrigger pointer-down behavior can capture scroll events.
                        e.stopPropagation();
                    }}
                    onKeyDown={handleKeyDown}
                    role="button"
                    tabIndex={0}
                    aria-label="Book actions"
                    className={cn(
                        "inline-block rounded-md",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
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
});

BookActionMenu.displayName = "BookActionMenu";
