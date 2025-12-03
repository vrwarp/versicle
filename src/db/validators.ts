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
