import { getDB } from '../../db/db';
import type { LexiconRule } from '../../types/db';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for managing pronunciation lexicon rules.
 * Handles CRUD operations for rules stored in IndexedDB and applies them to text.
 */
export class LexiconService {
  private static instance: LexiconService;

  private constructor() {}

  /**
   * Retrieves the singleton instance of the LexiconService.
   *
   * @returns The singleton instance.
   */
  static getInstance(): LexiconService {
    if (!LexiconService.instance) {
      LexiconService.instance = new LexiconService();
    }
    return LexiconService.instance;
  }

  /**
   * Retrieves all rules applicable to a specific book (Global + Book Specific).
   *
   * @param bookId - Optional ID of the book to filter by.
   * @returns A Promise that resolves to an array of LexiconRule objects.
   */
  async getRules(bookId?: string): Promise<LexiconRule[]> {
    const db = await getDB();
    const allRules = await db.getAll('lexicon');

    const filtered = allRules.filter(rule =>
      !rule.bookId || (bookId && rule.bookId === bookId)
    );

    return filtered.sort((a, b) => {
      // Priority Group:
      // 1. Book rules with applyBeforeGlobal=true
      // 2. Global rules
      // 3. Book rules with applyBeforeGlobal=false/undefined
      const getGroup = (r: LexiconRule) => {
        if (!r.bookId) return 2; // Global
        return r.applyBeforeGlobal ? 1 : 3;
      };

      const groupA = getGroup(a);
      const groupB = getGroup(b);
      if (groupA !== groupB) return groupA - groupB;

      // Primary: Order (Ascending) within group
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;

      // Secondary: Length (Descending) - legacy/default
      return b.original.length - a.original.length;
    });
  }

  /**
   * Adds or updates a lexicon rule in the database.
   *
   * @param rule - The rule object to save (excluding ID and created date).
   * @returns A Promise that resolves when the rule is saved.
   */
  async saveRule(rule: Omit<LexiconRule, 'id' | 'created'> & { id?: string }): Promise<void> {
    const db = await getDB();
    const newRule: LexiconRule = {
      id: rule.id || uuidv4(),
      original: rule.original,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      bookId: rule.bookId,
      applyBeforeGlobal: rule.applyBeforeGlobal,
      order: rule.order,
      created: Date.now(),
    };
    await db.put('lexicon', newRule);
  }

  /**
   * Updates the order of multiple rules.
   *
   * @param updates - Array of objects with rule ID and new order.
   */
  async reorderRules(updates: { id: string; order: number }[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('lexicon', 'readwrite');
    const store = tx.objectStore('lexicon');

    for (const { id, order } of updates) {
      const rule = await store.get(id);
      if (rule) {
        rule.order = order;
        await store.put(rule);
      }
    }
    await tx.done;
  }

  /**
   * Deletes a lexicon rule by its ID.
   *
   * @param id - The unique identifier of the rule to delete.
   * @returns A Promise that resolves when the rule is deleted.
   */
  async deleteRule(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('lexicon', id);
  }

  /**
   * Applies the applicable lexicon rules to the provided text.
   * Performs replacement based on string matching or regular expressions.
   *
   * @param text - The original text.
   * @param rules - The list of rules to apply.
   * @returns The text with replacements applied.
   */
  applyLexicon(text: string, rules: LexiconRule[]): string {
    let processedText = text;

    // Rules are applied in the order they are provided.
    // It is expected that the caller provides them in the correct order (e.g. from getRules()).

    for (const rule of rules) {
        if (!rule.original || !rule.replacement) continue;

        try {
            let regex: RegExp;

            if (rule.isRegex) {
                // Use original string directly as regex
                regex = new RegExp(rule.original, 'gi');
            } else {
                // Escape special regex characters in the original string
                const escapedOriginal = rule.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Check if start/end are word characters to determine if \b is appropriate
                const startIsWord = /^\w/.test(rule.original);
                const endIsWord = /\w$/.test(rule.original);

                const regexStr = `${startIsWord ? '\\b' : ''}${escapedOriginal}${endIsWord ? '\\b' : ''}`;
                regex = new RegExp(regexStr, 'gi');
            }

            processedText = processedText.replace(regex, rule.replacement);
        } catch (e) {
            console.warn(`Invalid regex for lexicon rule: ${rule.original}`, e);
        }
    }

    return processedText;
  }

  /**
   * Generates a hash of the rules to use for cache invalidation.
   * This ensures that cached audio is invalidated if the lexicon rules change.
   *
   * @param rules - The list of rules to hash.
   * @returns A Promise that resolves to the SHA-256 hash string.
   */
  async getRulesHash(rules: LexiconRule[]): Promise<string> {
      if (rules.length === 0) return '';

      // Sort to ensure deterministic order
      const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
      const data = sorted.map(r => `${r.original}:${r.replacement}`).join('|');

      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
