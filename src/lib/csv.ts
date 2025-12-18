import type { ReadingListEntry } from '../types/db';

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
 * - Fields are escaped to handle special characters.
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
    ].join(',');

    const rows = entries.map(entry => {
        const title = escapeCSV(entry.title);
        const author = escapeCSV(entry.author);
        // Force Excel to treat ISBN as string to prevent scientific notation,
        // but only if it's present.
        const isbn = entry.isbn ? `="${entry.isbn}"` : '';
        const rating = entry.rating || '';

        let shelf = 'to-read';
        if (entry.status) {
             shelf = entry.status;
        } else if (entry.percentage >= 0.98) {
             shelf = 'read';
        } else if (entry.percentage > 0) {
             shelf = 'currently-reading';
        }

        const dateRead = (shelf === 'read' && entry.lastUpdated) ? new Date(entry.lastUpdated).toISOString().split('T')[0] : '';
        const filename = escapeCSV(entry.filename);
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
        ].join(',');
    });

    return [headerRow, ...rows].join('\n');
}

/**
 * Escapes a CSV field value.
 * - Wraps in quotes if it contains a comma, quote, or newline.
 * - Escapes existing quotes by doubling them.
 *
 * @param field - The raw field string.
 * @returns The escaped string ready for CSV insertion.
 */
function escapeCSV(field: string): string {
    if (!field) return '';
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

/**
 * Parses a CSV string into ReadingListEntry objects.
 *
 * Capabilities:
 * - Dynamic header mapping: Detects column positions from the header row.
 * - Robust parsing: Handles quoted fields and newlines within fields (via parseCSVLine).
 * - Fallbacks: Generates filenames from ISBN or Title/Author if missing (crucial for importing Goodreads exports).
 * - Normalization: Normalizes percentage (0-100 -> 0-1) and status.
 * - Cleaning: Removes Excel-style `="..."` formatting from ISBNs.
 *
 * @param csv - The raw CSV string content.
 * @returns An array of parsed ReadingListEntry objects.
 */
export function parseReadingListCSV(csv: string): ReadingListEntry[] {
    const lines = csv.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim());

    // Map headers to indices to support arbitrary column ordering
    const indices: {[key: string]: number} = {};
    headers.forEach((h, i) => indices[h] = i);

    const getIdx = (key: string) => indices[key.toLowerCase()];

    const entries: ReadingListEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values = parseCSVLine(line);

        if (values.length < 2) continue; // Skip empty/invalid lines

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

        let percentage = 0;
        if (percentageStr) {
            percentage = parseFloat(percentageStr);
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

        entries.push({
            filename: finalFilename,
            title,
            author,
            isbn,
            percentage,
            lastUpdated: dateRead ? new Date(dateRead).getTime() : Date.now(),
            status,
            rating: ratingStr ? parseInt(ratingStr) : undefined
        });
    }

    return entries;
}

/**
 * Parses a single CSV line into values, handling quoted fields correctly.
 *
 * Logic:
 * - Iterates character by character.
 * - Toggles `inQuotes` state when encountering a double quote.
 * - Commas are treated as separators only when NOT `inQuotes`.
 * - Double quotes inside a quoted field ("") are escaped to a single quote.
 *
 * @param line - The raw CSV line string.
 * @returns An array of string values for the line.
 */
function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i+1] === '"') {
                // Handle escaped quote ("") inside a quoted field
                currentValue += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            values.push(currentValue);
            currentValue = '';
        } else {
            currentValue += char;
        }
    }
    values.push(currentValue);
    return values;
}
