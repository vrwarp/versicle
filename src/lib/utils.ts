import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS classes with clsx for conditional class names.
 *
 * @param inputs - A variable number of class names or conditional class objects.
 * @returns A merged string of class names with conflicting Tailwind classes resolved.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function containsCJK(text: string): boolean {
  if (!text) return false;
  // Matches standard CJK Unified Ideographs
  return /[\u4E00-\u9FFF]/.test(text);
}

export function isCJKLanguageCode(code?: string): boolean {
  if (!code) return false;
  const lowerCode = code.toLowerCase();
  return lowerCode.startsWith('zh') || lowerCode.startsWith('ja') || lowerCode.startsWith('ko');
}

/**
 * Best-effort right-to-left detection from a BCP-47 language code. Used to
 * mirror the paginated page-turn rails — the leading ("next page") edge sits on
 * the LEFT in RTL scripts. Note: a book's OPF page-progression-direction can in
 * principle differ from its language; this is the language heuristic until that
 * spine metadata is surfaced through the engine port.
 */
export function isRtlLanguage(code?: string): boolean {
  if (!code) return false;
  const base = code.toLowerCase().split(/[-_]/)[0];
  return ['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'].includes(base);
}
