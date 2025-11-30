import { getDB } from '../../db/db';
import type { LexiconRule } from '../../types/db';
import { v4 as uuidv4 } from 'uuid';

export class LexiconService {
  private static instance: LexiconService;

  private constructor() {}

  static getInstance(): LexiconService {
    if (!LexiconService.instance) {
      LexiconService.instance = new LexiconService();
    }
    return LexiconService.instance;
  }

  /**
   * Retrieves all rules applicable to a specific book (Global + Book Specific).
   */
  async getRules(bookId?: string): Promise<LexiconRule[]> {
    const db = await getDB();
    const allRules = await db.getAll('lexicon');

    return allRules.filter(rule =>
      !rule.bookId || (bookId && rule.bookId === bookId)
    );
  }

  /**
   * Adds or updates a rule.
   */
  async saveRule(rule: Omit<LexiconRule, 'id' | 'created'> & { id?: string }): Promise<void> {
    const db = await getDB();
    const newRule: LexiconRule = {
      id: rule.id || uuidv4(),
      original: rule.original,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      bookId: rule.bookId,
      created: Date.now(),
    };
    await db.put('lexicon', newRule);
  }

  /**
   * Deletes a rule by ID.
   */
  async deleteRule(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('lexicon', id);
  }

  /**
   * Applies the given rules to the text.
   * Performs a case-insensitive match but preserves the case of the replacement.
   */
  applyLexicon(text: string, rules: LexiconRule[]): string {
    let processedText = text;

    // Sort rules by length of 'original' (descending) to prevent substring collisions
    const sortedRules = [...rules].sort((a, b) => b.original.length - a.original.length);

    for (const rule of sortedRules) {
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
