import React, { useEffect, useState, useMemo } from 'react';
import { Modal, ModalContent } from './ui/Modal';
import { Button } from './ui/Button';
import { dbService } from '../db/DBService';
import type { ReadingListEntry } from '../types/db';
import { ArrowUpDown, Trash2, Edit2, Download, CheckSquare, Square } from 'lucide-react';
import { EditReadingListEntryDialog } from './EditReadingListEntryDialog';

interface ReadingListDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog for managing the user's reading list.
 * Supports sorting, selection, batch deletion, and CSV export.
 * Also provides access to individual entry editing.
 */
export const ReadingListDialog: React.FC<ReadingListDialogProps> = ({ open, onOpenChange }) => {
    const [entries, setEntries] = useState<ReadingListEntry[]>([]);
    const [sortField, setSortField] = useState<keyof ReadingListEntry>('lastUpdated');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
    const [editEntry, setEditEntry] = useState<ReadingListEntry | null>(null);

    useEffect(() => {
        if (open) {
            refreshEntries();
        } else {
            // Reset selection when closed
            setSelectedEntries(new Set());
        }
    }, [open]);

    const refreshEntries = () => {
        dbService.getReadingList().then(list => setEntries(list || []));
    };

    /**
     * Memoized list of sorted entries based on current sort field and direction.
     * Handles undefined values by placing them at the end.
     */
    const sortedEntries = useMemo(() => {
        return [...entries].sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];

            if (aVal === undefined && bVal === undefined) return 0;
            if (aVal === undefined) return 1;
            if (bVal === undefined) return -1;

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [entries, sortField, sortDirection]);

    const handleSort = (field: keyof ReadingListEntry) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc'); // Default to desc for new field
        }
    };

    /**
     * Toggles selection state of a single entry.
     */
    const toggleSelection = (filename: string) => {
        const newSelection = new Set(selectedEntries);
        if (newSelection.has(filename)) {
            newSelection.delete(filename);
        } else {
            newSelection.add(filename);
        }
        setSelectedEntries(newSelection);
    };

    /**
     * Toggles selection of all entries.
     * If all are selected, deselects all. Otherwise, selects all.
     */
    const toggleSelectAll = () => {
        if (selectedEntries.size === entries.length) {
            setSelectedEntries(new Set());
        } else {
            setSelectedEntries(new Set(entries.map(e => e.filename)));
        }
    };

    const handleDelete = async (filename: string) => {
        if (confirm('Are you sure you want to delete this entry?')) {
            await dbService.deleteReadingListEntry(filename);
            setSelectedEntries(prev => {
                const newSet = new Set(prev);
                newSet.delete(filename);
                return newSet;
            });
            refreshEntries();
        }
    };

    const handleBatchDelete = async () => {
        if (confirm(`Are you sure you want to delete ${selectedEntries.size} entries?`)) {
            await dbService.deleteReadingListEntries(Array.from(selectedEntries));
            setSelectedEntries(new Set());
            refreshEntries();
        }
    };

    /**
     * Exports selected entries to a CSV file.
     * Escapes quotes in fields to ensure valid CSV format.
     */
    const handleExportCSV = () => {
        const entriesToExport = entries.filter(e => selectedEntries.has(e.filename));
        if (entriesToExport.length === 0) return;

        const headers = ['Title', 'Author', 'Status', 'Progress', 'Rating', 'Last Read', 'ISBN'];
        const csvContent = [
            headers.join(','),
            ...entriesToExport.map(e => [
                `"${e.title.replace(/"/g, '""')}"`,
                `"${e.author.replace(/"/g, '""')}"`,
                e.status || '',
                `${Math.round(e.percentage * 100)}%`,
                e.rating || '',
                new Date(e.lastUpdated).toISOString(),
                `"${(e.isbn || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'reading_list.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleEditSave = async (updatedEntry: ReadingListEntry) => {
        await dbService.upsertReadingListEntry(updatedEntry);
        refreshEntries();
    };

    return (
        <>
            <Modal open={open} onOpenChange={onOpenChange}>
                <ModalContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden sm:rounded-lg">
                    <div className="flex items-center justify-between p-4 border-b">
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-bold">Reading List</h2>
                            {selectedEntries.size > 0 && (
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={handleBatchDelete} className="text-destructive hover:text-destructive">
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete ({selectedEntries.size})
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={handleExportCSV}>
                                        <Download className="w-4 h-4 mr-2" />
                                        Export CSV
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                        {entries.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                Reading list is empty.
                            </div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs uppercase bg-muted/50 sticky top-0 backdrop-blur-sm z-10">
                                    <tr>
                                        <th className="px-4 py-3 w-[40px]">
                                            <div
                                                className="cursor-pointer flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                                                onClick={toggleSelectAll}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        toggleSelectAll();
                                                    }
                                                }}
                                                role="checkbox"
                                                aria-checked={entries.length > 0 && selectedEntries.size === entries.length}
                                                aria-label="Select all"
                                                tabIndex={0}
                                            >
                                                {entries.length > 0 && selectedEntries.size === entries.length ? (
                                                    <CheckSquare className="w-4 h-4" />
                                                ) : (
                                                    <Square className="w-4 h-4" />
                                                )}
                                            </div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('title')}>
                                            <div className="flex items-center gap-1">Title <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('author')}>
                                             <div className="flex items-center gap-1">Author <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('status')}>
                                             <div className="flex items-center gap-1">Status <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('percentage')}>
                                             <div className="flex items-center gap-1">Progress <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('rating')}>
                                             <div className="flex items-center gap-1">Rating <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('lastUpdated')}>
                                             <div className="flex items-center gap-1">Last Read <ArrowUpDown className="w-3 h-3"/></div>
                                        </th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEntries.map((entry) => (
                                        <tr key={entry.filename} className={`border-b hover:bg-muted/20 transition-colors ${selectedEntries.has(entry.filename) ? 'bg-muted/30' : ''}`}>
                                            <td className="px-4 py-3 text-center">
                                                <div
                                                    className="cursor-pointer flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                                                    onClick={() => toggleSelection(entry.filename)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            toggleSelection(entry.filename);
                                                        }
                                                    }}
                                                    role="checkbox"
                                                    aria-checked={selectedEntries.has(entry.filename)}
                                                    aria-label={`Select ${entry.title}`}
                                                    tabIndex={0}
                                                >
                                                    {selectedEntries.has(entry.filename) ? (
                                                        <CheckSquare className="w-4 h-4" />
                                                    ) : (
                                                        <Square className="w-4 h-4" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-medium">{entry.title}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{entry.author}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs border ${
                                                    entry.status === 'read' ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' :
                                                    entry.status === 'currently-reading' ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' :
                                                    'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                                                }`}>
                                                    {entry.status === 'currently-reading' ? 'Reading' :
                                                     entry.status === 'to-read' ? 'To Read' : 'Read'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {Math.round(entry.percentage * 100)}%
                                            </td>
                                            <td className="px-4 py-3 text-yellow-500">
                                                {entry.rating ? '★'.repeat(entry.rating) : <span className="text-muted-foreground">-</span>}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                                {new Date(entry.lastUpdated).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
                                                        onClick={() => setEditEntry(entry)}
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                        <span className="sr-only">Edit</span>
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                                        onClick={() => handleDelete(entry.filename)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        <span className="sr-only">Delete</span>
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className="p-4 border-t bg-muted/10 flex justify-between items-center">
                        <p className="text-xs text-muted-foreground">
                            {entries.length} books in list. Entries are managed via Sync logic.
                        </p>
                    </div>
                </ModalContent>
            </Modal>

            <EditReadingListEntryDialog
                open={!!editEntry}
                onOpenChange={(open) => !open && setEditEntry(null)}
                entry={editEntry}
                onSave={handleEditSave}
            />
        </>
    );
};
