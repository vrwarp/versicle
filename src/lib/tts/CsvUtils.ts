import type { LexiconRule } from '../../types/db';

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
   * Supports quoted values containing commas and escaped quotes using double-double quotes ("").
   *
   * @param text - The raw CSV string to parse.
   * @returns An array of objects containing `original`, `replacement`, and `isRegex`.
   *          Properties `id`, `created`, and `bookId` are excluded as they are generated/managed by the system.
   */
  parse(text: string): Omit<LexiconRule, 'id' | 'created' | 'bookId'>[] {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return []; // Header only or empty

    const result: Omit<LexiconRule, 'id' | 'created' | 'bookId'>[] = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV regex for parsing: matches "quoted" or unquoted
        // Handles escaped quotes ("") inside quoted strings
        const matches = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);

        if (matches) {
           const clean = matches.map(m => {
               // Remove leading comma if present (from the regex group start)
               let s = m.replace(/^,/, '');
               // Unquote if it's a quoted string
               if (s.startsWith('"') && s.endsWith('"')) {
                   s = s.slice(1, -1).replace(/""/g, '"');
               }
               return s;
           });

           // We need at least original and replacement
           if (clean.length >= 2) {
               result.push({
                   original: clean[0],
                   replacement: clean[1],
                   // Default to false if missing
                   isRegex: clean[2]?.toLowerCase() === 'true' || clean[2] === '1'
               });
           }
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
