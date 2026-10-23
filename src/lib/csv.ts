import type { ReadingListEntry } from '~types/user-data';
import Papa from 'papaparse';

/**
 * Column headers used in the CSV.
 * Includes standard Goodreads headers for compatibility and custom Versicle headers for full state restoration.
 */
const HEADERS = {
    TITLE: 'Title',
    AUTHOR: 'Author',
    ISBN: 'ISBN',
    RATING: 'My Rating',
    SHELF: 'Exclusive Shelf',
    DATE_READ: 'Date Read',
    FILENAME: 'Filename',
    PERCENTAGE: 'Percentage'
};

/**
 * Exports a list of reading entries to a CSV formatted string.
 *
 * The output includes:
 * - Standard metadata: Title, Author, ISBN, Rating, Shelf (Status), Date Read
 * - Versicle specific: Filename, Percentage
 *
 * Logic:
 * - 'shelf' is mapped from status ('read', 'currently-reading', 'to-read').
 * - 'date read' is only populated if the status is 'read'.
 * - Fields are escaped to handle special characters (handled by PapaParse).
 *
 * @param entries - The list of reading entries to export.
 * @returns The generated CSV string.
 */
export function exportReadingListToCSV(entries: ReadingListEntry[]): string {
    const headerRow = [
        HEADERS.TITLE,
        HEADERS.AUTHOR,
        HEADERS.ISBN,
        HEADERS.RATING,
        HEADERS.SHELF,
        HEADERS.DATE_READ,
        HEADERS.FILENAME,
        HEADERS.PERCENTAGE
    ];

    const rows = entries.map(entry => {
        const title = entry.title || '';
        const author = entry.author || '';
        // Force Excel to treat ISBN as string to prevent scientific notation,
        // but only if it's present.
        const isbn = entry.isbn ? `="${entry.isbn}"` : '';
        const rating = entry.rating ? entry.rating.toString() : '';

        let shelf = 'to-read';
        if (entry.status) {
             shelf = entry.status;
        } else if (entry.percentage >= 0.98) {
             shelf = 'read';
        } else if (entry.percentage > 0) {
             shelf = 'currently-reading';
        }

        // toISOString() throws RangeError on an invalid (NaN) timestamp.
        const dateRead = (shelf === 'read' && Number.isFinite(entry.lastUpdated) && entry.lastUpdated)
            ? new Date(entry.lastUpdated).toISOString().split('T')[0]
            : '';
        const filename = entry.filename || '';
        const percentage = entry.percentage.toFixed(4);

        return [
            title,
            author,
            isbn,
            rating,
            shelf,
            dateRead,
            filename,
            percentage
        ];
    });

    return Papa.unparse([headerRow, ...rows], { newline: '\n' });
}

/**
 * Parses a CSV string into ReadingListEntry objects.
 *
 * Capabilities:
 * - Dynamic header mapping: Detects column positions from the header row.
 * - Robust parsing: Handles quoted fields and newlines within fields (via PapaParse).
 * - Fallbacks: Generates filenames from ISBN or Title/Author if missing (crucial for importing Goodreads exports).
 * - Normalization: Normalizes percentage (0-100 -> 0-1) and status.
 * - Cleaning: Removes Excel-style `="..."` formatting from ISBNs.
 *
 * @param csv - The raw CSV string content.
 * @returns An array of parsed ReadingListEntry objects.
 */
export function parseReadingListCSV(csv: string): ReadingListEntry[] {
    const result = Papa.parse<string[]>(csv, { skipEmptyLines: true });
    const lines = result.data;

    if (lines.length === 0) return [];

    const headerLine = lines[0];
    const headers = headerLine.map(h => h.toLowerCase().trim());

    // Map headers to indices to support arbitrary column ordering
    const indices: {[key: string]: number} = {};
    headers.forEach((h, i) => indices[h] = i);

    const getIdx = (key: string) => indices[key.toLowerCase()];

    const entries: ReadingListEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i];

        if (values.length < 2) continue; // Skip empty/invalid lines (though skipEmptyLines helps)

        // Extract fields using dynamic indices
        const title = values[getIdx(HEADERS.TITLE)] || 'Unknown Title';
        const author = values[getIdx(HEADERS.AUTHOR)] || 'Unknown Author';

        // Remove =" and " wrapper if present for ISBN (Excel export artifact)
        let isbn = values[getIdx(HEADERS.ISBN)];
        if (isbn) {
            isbn = isbn.replace(/^="|"$/g, '').replace(/"/g, '');
        }

        const filename = values[getIdx(HEADERS.FILENAME)];
        const percentageStr = values[getIdx(HEADERS.PERCENTAGE)];
        const shelf = values[getIdx(HEADERS.SHELF)];
        const dateRead = values[getIdx(HEADERS.DATE_READ)];
        const ratingStr = values[getIdx(HEADERS.RATING)];

        // Filename Strategy:
        // 1. Use explicit Filename column if present (Versicle export).
        // 2. Fallback to ISBN-based ID.
        // 3. Fallback to Title-Author-based ID.
        let finalFilename = filename;
        if (!finalFilename) {
             if (isbn) finalFilename = `isbn-${isbn}`;
             else finalFilename = `${title}-${author}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        }

        // An unparseable value (e.g. "n/a") is treated like a missing one so NaN never reaches the store.
        const parsedPercentage = percentageStr ? parseFloat(percentageStr) : NaN;
        let percentage = 0;
        if (Number.isFinite(parsedPercentage)) {
            percentage = parsedPercentage;
            // Normalize percentage to 0.0 - 1.0 range if it appears to be 0-100
            if (percentage > 1.0 && percentage <= 100) percentage = percentage / 100;
        } else {
            // Infer percentage from shelf status if missing
            if (shelf === 'read') percentage = 1.0;
        }

        let status: 'read' | 'currently-reading' | 'to-read' = 'to-read';
        if (shelf === 'read') status = 'read';
        else if (shelf === 'currently-reading') status = 'currently-reading';

        // Correct status based on percentage if shelf is missing or ambiguous
        if (!shelf) {
            if (percentage >= 0.98) status = 'read';
            else if (percentage > 0) status = 'currently-reading';
        }

        // Invalid dates / ratings must not leak NaN into the persisted entry (a NaN
        // lastUpdated would also make a later export throw).
        const parsedDate = dateRead ? new Date(dateRead).getTime() : NaN;
        const parsedRating = ratingStr ? parseInt(ratingStr, 10) : NaN;

        entries.push({
            filename: finalFilename,
            title,
            author,
            isbn,
            percentage,
            lastUpdated: Number.isNaN(parsedDate) ? Date.now() : parsedDate,
            status,
            rating: Number.isNaN(parsedRating) ? undefined : parsedRating
        });
    }

    return entries;
}
