
interface TrieNode {
    [key: string]: TrieNode | boolean | undefined;
    _end?: boolean;
}

/**
 * A specialized Trie implementation for fast string matching without allocations.
 * Optimized for case-insensitive matching and specific text segmentation needs.
 */
export class TextScanningTrie {
    private root: TrieNode = {};

    private static readonly CODE_QUOTE_DOUBLE = '"'.codePointAt(0)!;
    private static readonly CODE_QUOTE_SINGLE = "'".codePointAt(0)!;
    private static readonly CODE_PAREN_OPEN = '('.codePointAt(0)!;
    private static readonly CODE_PAREN_CLOSE = ')'.codePointAt(0)!;
    private static readonly CODE_BRACKET_OPEN = '['.codePointAt(0)!;
    private static readonly CODE_BRACKET_CLOSE = ']'.codePointAt(0)!;
    private static readonly CODE_ANGLE_OPEN = '<'.codePointAt(0)!;
    private static readonly CODE_ANGLE_CLOSE = '>'.codePointAt(0)!;
    private static readonly CODE_BRACE_OPEN = '{'.codePointAt(0)!;
    private static readonly CODE_BRACE_CLOSE = '}'.codePointAt(0)!;
    private static readonly CODE_PERIOD = '.'.codePointAt(0)!;
    private static readonly CODE_COMMA = ','.codePointAt(0)!;
    private static readonly CODE_EXCLAMATION = '!'.codePointAt(0)!;
    private static readonly CODE_QUESTION = '?'.codePointAt(0)!;
    private static readonly CODE_SEMICOLON = ';'.codePointAt(0)!;
    private static readonly CODE_COLON = ':'.codePointAt(0)!;

    /**
     * Checks if a character code represents a whitespace character.
     * Covers common ASCII and Unicode whitespace to match Regex `\s`.
     */
    public static isWhitespace(code: number): boolean {
        return (code === 0x0020) || // Space
            (code >= 0x0009 && code <= 0x000D) || // Tab, LF, VT, FF, CR
            (code === 0x00A0) || // NBSP
            (code === 0x1680) || // Ogham Space Mark
            (code >= 0x2000 && code <= 0x200A) || // U+2000-U+200A (En Quad...Hair Space)
            (code === 0x2028) || (code === 0x2029) || // Line/Para Separator
            (code === 0x202F) || // Narrow No-Break Space
            (code === 0x205F) || // Medium Mathematical Space
            (code === 0x3000) || // Ideographic Space
            (code === 0xFEFF); // BOM
    }

    /**
     * Checks if a character code represents a common punctuation mark to strip.
     * Includes quotes, brackets, and sentence delimiters.
     */
    public static isPunctuation(code: number): boolean {
        return (code === TextScanningTrie.CODE_QUOTE_DOUBLE) || (code === TextScanningTrie.CODE_QUOTE_SINGLE) ||
            (code === TextScanningTrie.CODE_PAREN_OPEN) || (code === TextScanningTrie.CODE_PAREN_CLOSE) ||
            (code === TextScanningTrie.CODE_BRACKET_OPEN) || (code === TextScanningTrie.CODE_BRACKET_CLOSE) ||
            (code === TextScanningTrie.CODE_ANGLE_OPEN) || (code === TextScanningTrie.CODE_ANGLE_CLOSE) ||
            (code === TextScanningTrie.CODE_BRACE_OPEN) || (code === TextScanningTrie.CODE_BRACE_CLOSE) ||
            (code === TextScanningTrie.CODE_PERIOD) || (code === TextScanningTrie.CODE_COMMA) ||
            (code === TextScanningTrie.CODE_EXCLAMATION) || (code === TextScanningTrie.CODE_QUESTION) ||
            (code === TextScanningTrie.CODE_SEMICOLON) || (code === TextScanningTrie.CODE_COLON);
    }

    /**
     * Inserts a string into the Trie.
     * @param text - The text to insert.
     * @param reverse - Whether to insert the text in reverse order (for suffix matching).
     */
    insert(text: string, reverse: boolean = false) {
        const normalized = text.normalize('NFKD');
        let node = this.root;
        const len = normalized.length;

        if (reverse) {
            for (let i = len - 1; i >= 0; i--) {
                const char = normalized[i].toLowerCase();
                if (!node[char]) {
                    node[char] = {};
                }
                node = node[char] as TrieNode;
            }
        } else {
            for (let i = 0; i < len; i++) {
                const char = normalized[i].toLowerCase();
                if (!node[char]) {
                    node[char] = {};
                }
                node = node[char] as TrieNode;
            }
        }
        node._end = true;
    }

    /**
     * Checks if the text ends with any string in the Trie.
     * Scans backwards from the end of the text, skipping trailing whitespace.
     *
     * @param text - The text to check.
     * @returns The matching word if found, or null.
     */
    matchesEnd(text: string): string | null {
        let i = text.length - 1;
        // Skip trailing whitespace
        while (i >= 0 && TextScanningTrie.isWhitespace(text.charCodeAt(i))) {
            i--;
        }
        if (i < 0) return null;

        let node = this.root;
        const startScan = i;
        let lastMatch: string | null = null;

        // Scan backwards through the text
        while (i >= 0) {
            const char = text[i].toLowerCase();
            if (!node[char]) {
                break;
            }
            node = node[char] as TrieNode;

            // If we found a potential match in the Trie
            if (node._end) {
                // Verify boundary: Previous char must be Punctuation, Whitespace, or Start
                const prevIndex = i - 1;
                const isBoundary = prevIndex < 0 ||
                                   TextScanningTrie.isWhitespace(text.charCodeAt(prevIndex)) ||
                                   TextScanningTrie.isPunctuation(text.charCodeAt(prevIndex));

                if (isBoundary) {
                    // Valid match found.
                    // Note: We continue scanning to find the *longest* match if needed.
                    lastMatch = text.substring(i, startScan + 1);
                }
            }
            i--;
        }

        return lastMatch;
    }

    /**
     * Checks if the text starts with any string in the Trie.
     * Scans forward from the start of the text, skipping leading whitespace.
     *
     * @param text - The text to check.
     * @returns The matching word if found, or null.
     */
    matchesStart(text: string): boolean {
        let i = 0;
        const len = text.length;
        // Skip leading whitespace
        while (i < len && TextScanningTrie.isWhitespace(text.charCodeAt(i))) {
            i++;
        }
        if (i >= len) return false;

        let node = this.root;

        // Scan forward
        while (i < len) {
            const char = text[i].toLowerCase();
            if (!node[char]) {
                return false; // No path
            }
            node = node[char] as TrieNode;

            if (node._end) {
                // Verify boundary: Next char must be Punctuation, Whitespace, or End
                const nextIndex = i + 1;
                const isBoundary = nextIndex >= len ||
                                   TextScanningTrie.isWhitespace(text.charCodeAt(nextIndex)) ||
                                   TextScanningTrie.isPunctuation(text.charCodeAt(nextIndex));

                if (isBoundary) {
                    return true;
                }
            }
            i++;
        }
        return false;
    }
}
