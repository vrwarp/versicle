
import { getDB } from '../../db/db';
import { useLexiconStore } from '../../store/useLexiconStore';
import { waitForYjsSync } from '../../store/yjs-provider';
import type { LexiconRule } from '../../types/db';
import { Logger } from '../logger';

/**
 * Migrates legacy lexicon rules from IndexedDB 'user_overrides' to Yjs store.
 * Should be called on app startup.
 */
export async function migrateLexicon() {
    await waitForYjsSync();

    const store = useLexiconStore.getState();
    const existingRules = Object.keys(store.rules);

    // If we already have rules in Yjs, assume migration is done or not needed.
    // (Or maybe we want to merge? Safest is to only migrate if empty to avoid duplicating)
    if (existingRules.length > 0) {
        return;
    }

    try {
        const db = await getDB();
        // Check if object store exists (it should)
        if (!db.objectStoreNames.contains('user_overrides')) {
            return;
        }

        const tx = db.transaction('user_overrides', 'readonly');
        const os = tx.objectStore('user_overrides');
        const keys = await os.getAllKeys();

        if (keys.length === 0) {
            return;
        }

        Logger.info('Migration', `Found ${keys.length} legacy override entries. Migrating...`);

        let rulesConverted = 0;

        for (const key of keys) {
            const entry = await os.get(key);
            if (!entry) continue;

            const bookId = key === 'global' ? undefined : (key as string);

            // Migrate Rules
            if (Array.isArray(entry.lexicon)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                entry.lexicon.forEach((legacyRule: any, index: number) => {
                    const rule: Omit<LexiconRule, 'id' | 'created' | 'order'> & { id?: string, created?: number, order?: number } = {
                        id: legacyRule.id, // Preserve ID
                        original: legacyRule.original,
                        replacement: legacyRule.replacement,
                        isRegex: legacyRule.isRegex,
                        bookId: bookId,
                        applyBeforeGlobal: legacyRule.applyBeforeGlobal,
                        created: legacyRule.created || Date.now(),
                        // Preserve order implicitly by index
                        order: legacyRule.order ?? index
                    };

                    // We can use addRule, but addRule generates new ID if not careful.
                    // Our store addRule generates new ID absolutely.
                    // But we want to preserve IDs if possible (though not strictly required for lexicon).
                    // Actually, useLexiconStore.addRule ignores 'id' in the argument and generates a new one!
                    // And it ignores 'order'.

                    // If we want to preserve IDs/Order, we should call 'set' on the map directly or add a 'bulkAdd' action?
                    // Or just use 'addRule' and let it generate new IDs.
                    // Preserving IDs is better for potential external references (unlikely for lexicon).

                    // But 'addRule' logic:
                    // const id = uuidv4();
                    // ...
                    // return { rules: { ...state.rules, [id]: newRule } };

                    // So we cannot preserve ID with current 'addRule'.
                    // Let's rely on 'addRule' to generate clean state.
                    // EXCEPT: 'addRule' implementation I wrote:
                    // const maxOrder = ...
                    // order: maxOrder + 1

                    // If we migrate multiple books, we want them ordered?
                    // Legacy 'user_overrides' had separate arrays per book.
                    // 'addRule' will flatten them.
                    // That's fine.

                    useLexiconStore.getState().addRule(rule);
                    rulesConverted++;
                });
            }

            // Migrate Settings (Bible Preferences)
            if (entry.settings && entry.settings.bibleLexiconEnabled) {
                if (bookId) { // Settings are usually per-book
                    useLexiconStore.getState().setBiblePreference(bookId, entry.settings.bibleLexiconEnabled as 'on' | 'off' | 'default');
                }
            }
        }

        Logger.info('Migration', `Successfully migrated ${rulesConverted} rules.`);

    } catch (e) {
        Logger.error('Migration', 'Failed to migrate lexicon:', e);
    }
}
