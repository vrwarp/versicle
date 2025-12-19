import React, { useEffect, useState, useMemo } from 'react';
import { Modal, ModalContent } from './ui/Modal';
import { dbService } from '../db/DBService';
import type { ReadingListEntry } from '../types/db';
import { ArrowUpDown } from 'lucide-react';

interface ReadingListDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const ReadingListDialog: React.FC<ReadingListDialogProps> = ({ open, onOpenChange }) => {
    const [entries, setEntries] = useState<ReadingListEntry[]>([]);
    const [sortField, setSortField] = useState<keyof ReadingListEntry>('lastUpdated');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        if (open) {
            dbService.getReadingList().then(list => setEntries(list || []));
        }
    }, [open]);

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

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden sm:rounded-lg">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-xl font-bold">Reading List</h2>
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
                                </tr>
                            </thead>
                            <tbody>
                                {sortedEntries.map((entry) => (
                                    <tr key={entry.filename} className="border-b hover:bg-muted/20 transition-colors">
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
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="p-4 border-t bg-muted/10">
                    <p className="text-xs text-muted-foreground">
                        {entries.length} books in list. Entries are managed via Sync logic.
                    </p>
                </div>
            </ModalContent>
        </Modal>
    );
};
