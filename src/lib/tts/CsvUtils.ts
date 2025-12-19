import type { LexiconRule } from '../../types/db';
import Papa from 'papaparse';

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
    const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
    const rawRows = result.data;

    if (rawRows.length < 2) return []; // Header only or empty

    const parsedRules: Omit<LexiconRule, 'id' | 'created' | 'bookId'>[] = [];

    // Skip header (index 0)
    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];

        // We need at least original and replacement
        if (row.length >= 2) {
             parsedRules.push({
                 original: row[0],
                 replacement: row[1],
                 // Default to false if missing
                 isRegex: row[2]?.toLowerCase() === 'true' || row[2] === '1',
                 applyBeforeGlobal: row[3]?.toLowerCase() === 'true' || row[3] === '1'
             });
        }
    }
    return parsedRules;
  },

  /**
   * Generates a CSV string from an array of LexiconRule objects.
   *
   * Outputs a header row "original,replacement,isRegex,applyBeforeGlobal".
   * Automatically escapes quotes by doubling them and wraps all string fields in quotes.
   *
   * @param rules - The array of lexicon rules to serialize.
   * @returns A string representing the CSV content.
   */
  generate(rules: LexiconRule[]): string {
    const header = "original,replacement,isRegex,applyBeforeGlobal";
    if (rules.length === 0) {
        return header;
    }

    const rows = rules.map(r => [
        r.original || '',
        r.replacement || '',
        !!r.isRegex,
        !!r.applyBeforeGlobal
    ]);

    const csv = Papa.unparse(rows, {
        quotes: [true, true, false, false],
        newline: '\n'
    });

    return header + '\n' + csv;
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
