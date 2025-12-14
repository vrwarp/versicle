import type { BookMetadata } from '../types/db';

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
 * Sanitizes a string by trimming and enforcing a maximum length.
 * @param input - The string to sanitize.
 * @param maxLength - The maximum allowed length (default: 255).
 * @returns The sanitized string.
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
    if (typeof input !== 'string') return '';
    return input.trim().slice(0, maxLength);
}

/**
 * Sanitizes book metadata.
 * Returns null if invalid, or a new object with sanitized strings.
 * @param data - The raw data to sanitize.
 * @returns Sanitized BookMetadata or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeBookMetadata(data: any): BookMetadata | null {
    if (!validateBookMetadata(data)) return null;

    return {
        ...data,
        title: sanitizeString(data.title, 500),
        author: sanitizeString(data.author, 255),
        description: data.description ? sanitizeString(data.description, 2000) : undefined,
    };
}
