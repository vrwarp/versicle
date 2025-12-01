import type { LexiconRule } from '../../types/db';

/**
 * Helper to parse a standard CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), and newlines within quotes.
 */
function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let insideQuote = false;

    // Normalize newlines to \n to simplify logic (handle \r\n)
    // Actually, handling it in the loop is more efficient but this is cleaner.
    // Let's handle \r in the loop to avoid copying the whole string.

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (insideQuote) {
            if (char === '"') {
                if (nextChar === '"') {
                    currentField += '"';
                    i++; // Skip the second quote of the escape sequence
                } else {
                    insideQuote = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"' && currentField.length === 0) {
                // Start of a quoted field
                insideQuote = true;
            } else if (char === ',') {
                // End of field
                currentRow.push(currentField);
                currentField = '';
            } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                // End of row
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                if (char === '\r') i++; // Skip the \n
            } else if (char === '\r') {
                 // Handle \r by itself (Mac classic?) - or just treat as whitespace?
                 // Standard CSV is CRLF or LF. Let's treat raw \r as newline too if we want to be robust,
                 // or just ignore if it's not followed by \n (unlikely in modern context).
                 // But for safety let's treat it as newline.
                 currentRow.push(currentField);
                 rows.push(currentRow);
                 currentRow = [];
                 currentField = '';
            } else {
                currentField += char;
            }
        }
    }

    // Push the last row if there's any content pending
    // If the string ended with a newline, currentRow is empty and currentField is empty -> don't push
    // If string ended with text, currentField has content -> push
    // If string ended with comma, currentRow has content, currentField is empty -> push (empty field)
    if (currentRow.length > 0 || currentField.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

/**
 * Utilities for parsing and generating CSV data for the Pronunciation Lexicon.
 * Handles standard CSV escaping (RFC 4180-ish) for original/replacement pairs
 * and a boolean regex flag.
 */
export const LexiconCSV = {
  /**
   * Parses a CSV string into a list of partial LexiconRule objects.
   *
   * Expects a header row "original,replacement,isRegex" (though strict header validation is skipped).
   * Supports quoted values containing commas, newlines, and escaped quotes using double-double quotes ("").
   *
   * @param text - The raw CSV string to parse.
   * @returns An array of objects containing `original`, `replacement`, and `isRegex`.
   *          Properties `id`, `created`, and `bookId` are excluded as they are generated/managed by the system.
   */
  parse(text: string): Omit<LexiconRule, 'id' | 'created' | 'bookId'>[] {
    const rawRows = parseCSV(text.trim());
    if (rawRows.length < 2) return []; // Header only or empty

    const result: Omit<LexiconRule, 'id' | 'created' | 'bookId'>[] = [];

    // Skip header (index 0)
    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];

        // Skip empty rows (could happen if multiple newlines)
        if (row.length === 0 || (row.length === 1 && row[0].trim() === '')) continue;

        // We need at least original and replacement
        if (row.length >= 2) {
             result.push({
                 original: row[0], // Already unquoted by parseCSV
                 replacement: row[1],
                 // Default to false if missing
                 isRegex: row[2]?.toLowerCase() === 'true' || row[2] === '1'
             });
        }
    }
    return result;
  },

  /**
   * Generates a CSV string from an array of LexiconRule objects.
   *
   * Outputs a header row "original,replacement,isRegex".
   * Automatically escapes quotes by doubling them and wraps all string fields in quotes.
   *
   * @param rules - The array of lexicon rules to serialize.
   * @returns A string representing the CSV content.
   */
  generate(rules: LexiconRule[]): string {
    const headers = "original,replacement,isRegex";
    const rows = rules.map(r => {
        // Escape quotes by doubling them
        const original = (r.original || '').replace(/"/g, '""');
        const replacement = (r.replacement || '').replace(/"/g, '""');

        // Always wrap in quotes for simplicity and safety against commas
        return `"${original}","${replacement}",${!!r.isRegex}`;
    });
    return [headers, ...rows].join('\n');
  }
};

/**
 * Utilities for parsing and generating simple newline-separated lists masquerading as CSV.
 * Primarily used for Abbreviations and Sentence Starters settings.
 */
export const SimpleListCSV = {
  /**
   * Parses a simple string list, optionally skipping a specific header line.
   * This is not a robust CSV parser; it primarily splits by newline.
   *
   * @param text - The raw string content to parse.
   * @param expectedHeader - Optional. If the first non-empty line matches this (case-insensitive), it is skipped.
   * @returns An array of strings representing the lines (trimmed and non-empty).
   */
  parse(text: string, expectedHeader?: string): string[] {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line);

    // Remove header if it matches the expected header (case-insensitive)
    if (lines.length > 0 && expectedHeader) {
         if (lines[0].toLowerCase() === expectedHeader.toLowerCase()) {
            lines.shift();
         }
    }

    return lines;
  },

  /**
   * Generates a simple string list with a header.
   *
   * @param items - The list of strings to include.
   * @param header - The header line to prepend.
   * @returns A string containing the header followed by items, separated by newlines.
   */
  generate(items: string[], header: string): string {
    return `${header}\n` + items.join("\n");
  }
};
