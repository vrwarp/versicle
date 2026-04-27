/**
 * Crypto utilities for secure random generation.
 */

/**
 * Generates a cryptographically secure random ID.
 *
 * Priority:
 * 1. crypto.randomUUID() (Modern browsers)
 * 2. crypto.getRandomValues() (Older browsers)
 * 3. Math.random() + Date.now() (Ultimate fallback - NOT secure, but better than pure Math.random)
 *
 * @param prefix - Optional prefix for the ID
 * @param separator - Separator between prefix and random part (default: '_')
 * @returns A secure random ID string
 */
export const generateSecureId = (prefix?: string, separator: string = '_'): string => {
  let id: string;

  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    // Format as a simple hex string to be safe and consistent
    id = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Ultimate fallback for very old environments
    // Note: Math.random() is NOT cryptographically secure.
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    id = `${timestamp}-${random}`;
  }

  return prefix ? `${prefix}${separator}${id}` : id;
};
