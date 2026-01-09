import { getDB } from '../../db/db';
import type { LexiconRule } from '../../types/db';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for managing pronunciation lexicon rules.
 * Handles CRUD operations for rules stored in IndexedDB and applies them to text.
 * Refactored to use 'user_overrides' store in v18.
 */
export class LexiconService {
  private static instance: LexiconService;
  private regexCache = new Map<string, RegExp>();

  private constructor() {}

  static getInstance(): LexiconService {
    if (!LexiconService.instance) {
      LexiconService.instance = new LexiconService();
    }
    return LexiconService.instance;
  }

  /**
   * Retrieves all rules applicable to a specific book (Global + Book Specific).
   * In v18, rules are stored in `user_overrides` grouped by bookId.
   */
  async getRules(bookId?: string): Promise<LexiconRule[]> {
    const db = await getDB();

    // Fetch Global Rules
    const globalOverrides = await db.get('user_overrides', 'global');
    let rules: LexiconRule[] = globalOverrides?.lexicon.map(r => ({
        id: r.id,
        original: r.original,
        replacement: r.replacement,
        isRegex: r.isRegex,
        bookId: undefined,
        created: r.created,
        applyBeforeGlobal: r.applyBeforeGlobal, // Explicitly load per-rule setting
        order: undefined
    })) || [];

    // Fetch Book Specific Rules
    if (bookId) {
        const bookOverrides = await db.get('user_overrides', bookId);
        if (bookOverrides) {
            // Legacy support: Check for old global config if per-rule setting is missing
            const legacyDefault = bookOverrides.lexiconConfig?.applyBefore;

            const bookRules: LexiconRule[] = bookOverrides.lexicon.map(r => ({
                id: r.id,
                original: r.original,
                replacement: r.replacement,
                isRegex: r.isRegex,
                bookId: bookId,
                created: r.created,
                // Fallback to legacy config if undefined
                applyBeforeGlobal: r.applyBeforeGlobal ?? legacyDefault
            }));

            // Merge logic: Per-rule priority
            const beforeRules = bookRules.filter(r => r.applyBeforeGlobal);
            const afterRules = bookRules.filter(r => !r.applyBeforeGlobal);

            rules = [...beforeRules, ...rules, ...afterRules];
        }
    }

    return rules;
  }

  async saveRule(rule: Omit<LexiconRule, 'id' | 'created'> & { id?: string }): Promise<void> {
    const db = await getDB();
    const id = rule.id || uuidv4();
    const bookId = rule.bookId || 'global';

    const tx = db.transaction('user_overrides', 'readwrite');
    const store = tx.objectStore('user_overrides');

    const overrides = await store.get(bookId) || { bookId, lexicon: [] };

    // Check if updating existing
    const existingIdx = overrides.lexicon.findIndex(r => r.id === id);

    const newRuleItem = {
        id,
        original: rule.original.normalize('NFKD'),
        replacement: rule.replacement.normalize('NFKD'),
        isRegex: rule.isRegex,
        created: Date.now(),
        // Save the per-rule setting
        applyBeforeGlobal: rule.applyBeforeGlobal
    };

    if (existingIdx >= 0) {
        // Merge updates carefully
        overrides.lexicon[existingIdx] = {
             ...overrides.lexicon[existingIdx],
             ...newRuleItem
        };
    } else {
        overrides.lexicon.push(newRuleItem);
    }

    // Note: We no longer update lexiconConfig, but we preserve it for legacy rules that haven't been updated yet.

    await store.put(overrides);
    await tx.done;
  }

  async reorderRules(updates: { id: string; order: number }[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('user_overrides', 'readwrite');
    const store = tx.objectStore('user_overrides');

    // Getting all override keys
    const keys = await store.getAllKeys();

    for (const key of keys) {
        const overrides = await store.get(key);
        if (!overrides) continue;

        const currentIds = new Set(overrides.lexicon.map(r => r.id));
        const relevantUpdates = updates.filter(u => currentIds.has(u.id));

        if (relevantUpdates.length > 0) {
            // Assign temporary order
            const items = overrides.lexicon.map(r => {
                const update = relevantUpdates.find(u => u.id === r.id);
                return { ...r, _tempOrder: update ? update.order : (Number.MAX_SAFE_INTEGER) };
            });

            // Sort
            items.sort((a, b) => a._tempOrder - b._tempOrder);

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            overrides.lexicon = items.map(({ _tempOrder, ...r }) => r);
            await store.put(overrides);
        }
    }

    await tx.done;
  }

  async deleteRule(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('user_overrides', 'readwrite');
    const store = tx.objectStore('user_overrides');

    // Search and destroy
    let cursor = await store.openCursor();
    while (cursor) {
        const overrides = cursor.value;
        const idx = overrides.lexicon.findIndex(r => r.id === id);
        if (idx !== -1) {
            overrides.lexicon.splice(idx, 1);
            await cursor.update(overrides);
            break; // Found and deleted
        }
        cursor = await cursor.continue();
    }
    await tx.done;
  }

  async deleteRules(ids: string[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('user_overrides', 'readwrite');
    const store = tx.objectStore('user_overrides');
    const idSet = new Set(ids);

    let cursor = await store.openCursor();
    while (cursor) {
        const overrides = cursor.value;
        const initialLen = overrides.lexicon.length;
        overrides.lexicon = overrides.lexicon.filter(r => !idSet.has(r.id));
        if (overrides.lexicon.length !== initialLen) {
            await cursor.update(overrides);
        }
        cursor = await cursor.continue();
    }
    await tx.done;
  }

  applyLexicon(text: string, rules: LexiconRule[]): string {
    let processedText = text.normalize('NFKD');
    for (const rule of rules) {
        if (!rule.original || !rule.replacement) continue;
        const normalizedOriginal = rule.original.normalize('NFKD');
        const normalizedReplacement = rule.replacement.normalize('NFKD');

        try {
            const cacheKey = `${rule.id}-${normalizedOriginal}-${rule.isRegex}`;
            let regex = this.regexCache.get(cacheKey);

            if (!regex) {
                if (rule.isRegex) {
                    regex = new RegExp(normalizedOriginal, 'gi');
                } else {
                    const escapedOriginal = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const startIsWord = /^\w/.test(normalizedOriginal);
                    const endIsWord = /\w$/.test(normalizedOriginal);
                    const regexStr = `${startIsWord ? '\\b' : ''}${escapedOriginal}${endIsWord ? '\\b' : ''}`;
                    regex = new RegExp(regexStr, 'gi');
                }
                this.regexCache.set(cacheKey, regex);
            }
            processedText = processedText.replace(regex, normalizedReplacement);
        } catch (e) {
            console.warn(`Invalid regex for lexicon rule: ${normalizedOriginal}`, e);
        }
    }
    return processedText;
  }

  async getRulesHash(rules: LexiconRule[]): Promise<string> {
      if (rules.length === 0) return '';
      const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
      const data = sorted.map(r => `${r.original.normalize('NFKD')}:${r.replacement.normalize('NFKD')}`).join('|');
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
