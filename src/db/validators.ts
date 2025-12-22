import type { BookMetadata } from '../types/db';
import { sanitizeMetadata } from '../lib/sanitizer';

/**
 * Validates if an object conforms to the BookMetadata interface.
 * Logs warnings for missing required fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateBookMetadata(data: any): data is BookMetadata {
  if (!data || typeof data !== 'object') {
    console.warn('DB Validation: Invalid record (not an object)', data);
    return false;
  }

  const missingFields: string[] = [];

  if (typeof data.id !== 'string' || data.id.trim() === '') {
    missingFields.push('id');
  }

  // Ingestion sets default title/author, but we should strictly check they exist as strings
  if (typeof data.title !== 'string') {
    missingFields.push('title');
  }

  if (typeof data.author !== 'string') {
    missingFields.push('author');
  }

  if (typeof data.addedAt !== 'number') {
    missingFields.push('addedAt');
  }

  if (missingFields.length > 0) {
    console.warn(`DB Validation: Record missing required fields: ${missingFields.join(', ')}`, data);
    return false;
  }

  return true;
}

/**
 * Sanitizes a string by stripping HTML, trimming, and enforcing a maximum length.
 * Uses DOMPurify (via sanitizer lib) for robust cleaning.
 *
 * @param input - The string to sanitize.
 * @param maxLength - The maximum allowed length (default: 255).
 * @returns The sanitized string.
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
    if (typeof input !== 'string') return '';

    // Use the robust DOMPurify-based sanitizer
    const text = sanitizeMetadata(input);

    // Fallback if sanitizer returns empty but input wasn't (unlikely for plain text, but possible if it was all tags)
    // If input was "<b>bold</b>", text is "bold".

    return text.trim().slice(0, maxLength);
}

export interface SanitizationResult {
    sanitized: BookMetadata;
    wasModified: boolean;
    modifications: string[];
}

/**
 * Checks book metadata for sanitization needs and returns the sanitized version with a report of changes.
 * Returns null if the input is invalid.
 * @param data - The raw data to sanitize.
 * @returns SanitizationResult or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSanitizedBookMetadata(data: any): SanitizationResult | null {
    if (!validateBookMetadata(data)) return null;

    const modifications: string[] = [];

    const titleSanitized = sanitizeString(data.title, 500);
    if (titleSanitized !== data.title) {
        modifications.push(`Title sanitized (HTML removed or truncated by ${data.title.length - titleSanitized.length} characters)`);
    }

    const authorSanitized = sanitizeString(data.author, 255);
    if (authorSanitized !== data.author) {
        modifications.push(`Author sanitized (HTML removed or truncated by ${data.author.length - authorSanitized.length} characters)`);
    }

    let descriptionSanitized = data.description;
    if (typeof data.description === 'string') {
        descriptionSanitized = sanitizeString(data.description, 2000);
        if (descriptionSanitized !== data.description) {
            modifications.push(`Description sanitized (HTML removed or truncated by ${data.description.length - descriptionSanitized.length} characters)`);
        }
    }

    const sanitized: BookMetadata = {
        ...data,
        title: titleSanitized,
        author: authorSanitized,
        description: descriptionSanitized,
    };

    return {
        sanitized,
        wasModified: modifications.length > 0,
        modifications
    };
}
