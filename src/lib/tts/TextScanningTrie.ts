
interface TrieNode {
    [key: number]: TrieNode | boolean | undefined;
    _end?: boolean;
}

/**
 * A specialized Trie implementation for fast string matching without allocations.
 * Optimized for case-insensitive matching and specific text segmentation needs.
 * Uses character codes (number) as keys to avoid string allocations during traversal.
 */
export class TextScanningTrie {
    private root: TrieNode = {};

    // ASCII Case Folding Constants
    private static readonly ASCII_A = 65;
    private static readonly ASCII_Z = 90;
    // Adding 32 to an uppercase ASCII char converts it to lowercase (e.g., 'A' (65) + 32 = 'a' (97))
    private static readonly ASCII_TO_LOWER_OFFSET = 32;
    private static readonly MAX_ASCII = 127;

    // Cache for non-ASCII case folding to avoid expensive String.fromCharCode().toLowerCase() allocations
    private static readonly caseFoldCache = new Map<number, number>();

    // Optimized Punctuation Lookup Table (128 bytes)
    // 0 = False, 1 = True
    private static readonly PUNCTUATION_FLAGS = new Uint8Array(128);

    static {
        // Initialize punctuation flags
        const p = TextScanningTrie.PUNCTUATION_FLAGS;
        p[34] = 1; // "
        p[39] = 1; // '
        p[40] = 1; // (
        p[41] = 1; // )
        p[91] = 1; // [
        p[93] = 1; // ]
        p[60] = 1; // <
        p[62] = 1; // >
        p[123] = 1; // {
        p[125] = 1; // }
        p[46] = 1; // .
        p[44] = 1; // ,
        p[33] = 1; // !
        p[63] = 1; // ?
        p[59] = 1; // ;
        p[58] = 1; // :
    }

    /**
     * Checks if a character code represents a whitespace character.
     * Covers common ASCII and Unicode whitespace to match Regex `\s`.
     */
    public static isWhitespace(code: number): boolean {
        // Optimization: Fast path for common ASCII space
        if (code === 0x0020) return true;

        // Optimization: Fast path for common non-whitespace (ASCII printable)
        // 0x0020 (32) is handled above.
        // 0x00A0 (160) is the next whitespace code point.
        // So if code > 32 and code < 160, it is guaranteed NOT to be whitespace.
        // This covers a-z, A-Z, 0-9, and common punctuation.
        if (code > 0x0020 && code < 0x00A0) return false;

        return (code >= 0x0009 && code <= 0x000D) || // Tab, LF, VT, FF, CR
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
        // Optimization: Use lookup table for ASCII range
        if (code < 128) {
            return !!TextScanningTrie.PUNCTUATION_FLAGS[code];
        }
        return false;
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
                const code = this.toLowerCaseCode(normalized.charCodeAt(i));
                if (!node[code]) {
                    node[code] = {};
                }
                node = node[code] as TrieNode;
            }
        } else {
            for (let i = 0; i < len; i++) {
                const code = this.toLowerCaseCode(normalized.charCodeAt(i));
                if (!node[code]) {
                    node[code] = {};
                }
                node = node[code] as TrieNode;
            }
        }
        node._end = true;
    }

    /**
     * Checks if the text ends with any string in the Trie.
     * Scans backwards from the end of the text, skipping trailing whitespace.
     * Optimized to avoid string allocations.
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
            let code = text.charCodeAt(i);

            // Optimization: Manual case folding for ASCII to avoid .toLowerCase() allocation
            if (code >= TextScanningTrie.ASCII_A && code <= TextScanningTrie.ASCII_Z) {
                code += TextScanningTrie.ASCII_TO_LOWER_OFFSET;
            } else if (code > TextScanningTrie.MAX_ASCII) {
                // Check cache first to avoid expensive String.fromCharCode().toLowerCase()
                let lower = TextScanningTrie.caseFoldCache.get(code);
                if (lower === undefined) {
                    lower = String.fromCharCode(code).toLowerCase().charCodeAt(0);
                    TextScanningTrie.caseFoldCache.set(code, lower);
                }
                code = lower;
            }

            if (!node[code]) {
                break;
            }
            node = node[code] as TrieNode;

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
     * Checks if the text ends with any string in the Trie.
     * Scans backwards from the end of the text, skipping trailing whitespace.
     * Returns true immediately upon finding a valid match (shortest suffix).
     * Optimized to avoid string allocations.
     *
     * @param text - The text to check.
     * @returns True if a match is found, false otherwise.
     */
    hasMatchEnd(text: string): boolean {
        let i = text.length - 1;
        // Skip trailing whitespace
        while (i >= 0 && TextScanningTrie.isWhitespace(text.charCodeAt(i))) {
            i--;
        }
        if (i < 0) return false;

        let node = this.root;

        // Scan backwards through the text
        while (i >= 0) {
            let code = text.charCodeAt(i);

            // Optimization: Manual case folding for ASCII to avoid .toLowerCase() allocation
            if (code >= TextScanningTrie.ASCII_A && code <= TextScanningTrie.ASCII_Z) {
                code += TextScanningTrie.ASCII_TO_LOWER_OFFSET;
            } else if (code > TextScanningTrie.MAX_ASCII) {
                // Check cache first to avoid expensive String.fromCharCode().toLowerCase()
                let lower = TextScanningTrie.caseFoldCache.get(code);
                if (lower === undefined) {
                    lower = String.fromCharCode(code).toLowerCase().charCodeAt(0);
                    TextScanningTrie.caseFoldCache.set(code, lower);
                }
                code = lower;
            }

            if (!node[code]) {
                return false; // No path
            }
            node = node[code] as TrieNode;

            // If we found a potential match in the Trie
            if (node._end) {
                // Verify boundary: Previous char must be Punctuation, Whitespace, or Start
                const prevIndex = i - 1;
                const isBoundary = prevIndex < 0 ||
                                   TextScanningTrie.isWhitespace(text.charCodeAt(prevIndex)) ||
                                   TextScanningTrie.isPunctuation(text.charCodeAt(prevIndex));

                if (isBoundary) {
                    return true;
                }
            }
            i--;
        }

        return false;
    }

    /**
     * Checks if the text starts with any string in the Trie.
     * Scans forward from the start of the text, skipping leading whitespace.
     * Optimized to avoid string allocations.
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
            let code = text.charCodeAt(i);

            // Optimization: Manual case folding for ASCII to avoid .toLowerCase() allocation
            if (code >= TextScanningTrie.ASCII_A && code <= TextScanningTrie.ASCII_Z) {
                code += TextScanningTrie.ASCII_TO_LOWER_OFFSET;
            } else if (code > TextScanningTrie.MAX_ASCII) {
                // Check cache first to avoid expensive String.fromCharCode().toLowerCase()
                let lower = TextScanningTrie.caseFoldCache.get(code);
                if (lower === undefined) {
                    lower = String.fromCharCode(code).toLowerCase().charCodeAt(0);
                    TextScanningTrie.caseFoldCache.set(code, lower);
                }
                code = lower;
            }

            if (!node[code]) {
                return false; // No path
            }
            node = node[code] as TrieNode;

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

    /**
     * Helper to get lower case code, using manual ASCII folding or cache.
     */
    private toLowerCaseCode(code: number): number {
        if (code >= TextScanningTrie.ASCII_A && code <= TextScanningTrie.ASCII_Z) {
            return code + TextScanningTrie.ASCII_TO_LOWER_OFFSET;
        } else if (code > TextScanningTrie.MAX_ASCII) {
            let lower = TextScanningTrie.caseFoldCache.get(code);
            if (lower === undefined) {
                lower = String.fromCharCode(code).toLowerCase().charCodeAt(0);
                TextScanningTrie.caseFoldCache.set(code, lower);
            }
            return lower;
        }
        return code;
    }
}
