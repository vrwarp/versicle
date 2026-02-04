
import { describe, it, expect } from 'vitest';
import { TextScanningTrie } from './TextScanningTrie';
import { SeededRandom, DEFAULT_FUZZ_SEED } from '../../test/fuzz-utils';

describe('TextScanningTrie Fuzz Testing', () => {
    const prng = new SeededRandom(DEFAULT_FUZZ_SEED);

    it('matches inserted strings correctly (Forward)', () => {
        const trie = new TextScanningTrie();
        const words = ['apple', 'banana', 'cherry', 'date'];
        words.forEach(w => trie.insert(w, false));

        for (let i = 0; i < 1000; i++) {
            const word = prng.nextElement(words);
            const noise = prng.nextString(10);

            // Should match "word + boundary"
            expect(trie.matchesStart(word + " " + noise)).toBe(true);
            expect(trie.matchesStart(word + "." + noise)).toBe(true);

            // Should match even with leading whitespace
            expect(trie.matchesStart("   " + word + " ")).toBe(true);

            // Should NOT match if prefix
            // e.g. "apple" in trie, text is "applepie"
            expect(trie.matchesStart(word + "x" + noise)).toBe(false);
        }
    });

    it('matches inserted strings correctly (Reverse)', () => {
        const trie = new TextScanningTrie();
        const words = ['apple', 'banana', 'cherry', 'date'];
        words.forEach(w => trie.insert(w, true));

        for (let i = 0; i < 1000; i++) {
            const word = prng.nextElement(words);
            const noise = prng.nextString(10);

            // Should match "noise + word" (matchesEnd checks end of string)
            // e.g. "hello apple"
            expect(trie.matchesEnd(noise + " " + word)).toBe(word);

            // Should match with trailing whitespace
            expect(trie.matchesEnd(noise + " " + word + "   ")).toBe(word);

            // Should NOT match if suffix of another word (boundary check)
            // e.g. "apple" in trie, text is "crabapple"
            // boundary check requires char before "apple" to be space/punct
            expect(trie.matchesEnd(noise + "x" + word)).toBeNull();
        }
    });

    it('handles random insertions and queries robustly', () => {
        const trie = new TextScanningTrie();
        const inserted = new Set<string>();

        // Insert 500 random words
        for (let i = 0; i < 500; i++) {
            const word = prng.nextString(prng.nextInt(3, 10)).trim();
            if (word.length > 0) {
                trie.insert(word, false);
                inserted.add(word.toLowerCase());
            }
        }

        // Fuzz check matchesStart
        for (let i = 0; i < 1000000; i++) {
            const text = prng.nextString(20);
            // We can't easily verify correctness against a Set without re-implementing logic,
            // but we can ensure it doesn't crash.
            // And we can check basic properties.
            const result = trie.matchesStart(text);
            expect(typeof result).toBe('boolean');
        }
    });
});
