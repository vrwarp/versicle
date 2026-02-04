
import { describe, it, expect } from 'vitest';
import { TextScanningTrie } from './TextScanningTrie';

describe('TextScanningTrie', () => {
    describe('insert & matchesEnd (Reverse Trie)', () => {
        const trie = new TextScanningTrie();
        trie.insert('Mr.', true);
        trie.insert('e.g.', true);
        trie.insert('et al.', true);

        it('matches simple abbreviations at the end', () => {
            expect(trie.matchesEnd('Hello Mr.')).toBe('Mr.');
            expect(trie.matchesEnd('See e.g.')).toBe('e.g.');
        });

        it('matches multi-word abbreviations at the end', () => {
            expect(trie.matchesEnd('Authors et al.')).toBe('et al.');
        });

        it('matches case-insensitively', () => {
            expect(trie.matchesEnd('HELLO MR.')).toBe('MR.');
            expect(trie.matchesEnd('hello mr.')).toBe('mr.');
        });

        it('skips trailing whitespace', () => {
            expect(trie.matchesEnd('Hello Mr.   ')).toBe('Mr.');
        });

        it('respects boundaries (must be preceded by space/punctuation/start)', () => {
            expect(trie.matchesEnd('Hammer.')).toBeNull(); // "mer." ends with "r." but "Mr." is not matched? No wait, "Mr."
            // "Hammer." ends in "r.", but we inserted "Mr.".
            // "Hammer." does NOT end in "Mr.".
        });

        it('respects boundaries (boundary check logic)', () => {
            // "Dr." is not in trie, "Mr." is.
            // "MMr." -> should match?
            // The boundary check in matchesEnd checks if char before match is whitespace/punctuation/start.
            // If text is "AMr.", match start is at index 1 ('M'). prev char is 'A'. Not boundary. Should fail.
            expect(trie.matchesEnd('AMr.')).toBeNull();
            expect(trie.matchesEnd(' Mr.')).toBe('Mr.');
        });
    });

    describe('insert & matchesStart (Forward Trie)', () => {
        const trie = new TextScanningTrie();
        trie.insert('He', false);
        trie.insert('She', false);
        trie.insert('The', false);

        it('matches words at the start', () => {
            expect(trie.matchesStart('He is here')).toBe(true);
            expect(trie.matchesStart('The end')).toBe(true);
        });

        it('matches case-insensitively', () => {
            expect(trie.matchesStart('he is here')).toBe(true);
            expect(trie.matchesStart('SHE matches')).toBe(true);
        });

        it('skips leading whitespace', () => {
            expect(trie.matchesStart('   He is here')).toBe(true);
        });

        it('respects boundaries (must be followed by space/punctuation/end)', () => {
            expect(trie.matchesStart('Hello')).toBe(false); // Starts with "He", but followed by 'l'
            expect(trie.matchesStart('He.')).toBe(true);
            expect(trie.matchesStart('He')).toBe(true);
        });
    });

    describe('Static Helpers', () => {
        it('identifies whitespace correctly', () => {
            expect(TextScanningTrie.isWhitespace(32)).toBe(true); // Space
            expect(TextScanningTrie.isWhitespace(160)).toBe(true); // NBSP
            expect(TextScanningTrie.isWhitespace(65)).toBe(false); // 'A'
        });

        it('identifies punctuation correctly', () => {
            expect(TextScanningTrie.isPunctuation(46)).toBe(true); // '.'
            expect(TextScanningTrie.isPunctuation(34)).toBe(true); // '"'
            expect(TextScanningTrie.isPunctuation(65)).toBe(false); // 'A'
        });
    });
});
