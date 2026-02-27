
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
    private static readonly CODE_HYPHEN = '-'.codePointAt(0)!;
    private static readonly CODE_SLASH = '/'.codePointAt(0)!;

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

    // Optimized Whitespace Lookup Table (256 bytes)
    // 0 = False, 1 = True
    private static readonly WHITESPACE_FLAGS = new Uint8Array(256);

    static {
        // Initialize punctuation flags
        const p = TextScanningTrie.PUNCTUATION_FLAGS;
        p[TextScanningTrie.CODE_QUOTE_DOUBLE] = 1;
        p[TextScanningTrie.CODE_QUOTE_SINGLE] = 1;
        p[TextScanningTrie.CODE_PAREN_OPEN] = 1;
        p[TextScanningTrie.CODE_PAREN_CLOSE] = 1;
        p[TextScanningTrie.CODE_BRACKET_OPEN] = 1;
        p[TextScanningTrie.CODE_BRACKET_CLOSE] = 1;
        p[TextScanningTrie.CODE_ANGLE_OPEN] = 1;
        p[TextScanningTrie.CODE_ANGLE_CLOSE] = 1;
        p[TextScanningTrie.CODE_BRACE_OPEN] = 1;
        p[TextScanningTrie.CODE_BRACE_CLOSE] = 1;
        p[TextScanningTrie.CODE_PERIOD] = 1;
        p[TextScanningTrie.CODE_COMMA] = 1;
        p[TextScanningTrie.CODE_EXCLAMATION] = 1;
        p[TextScanningTrie.CODE_QUESTION] = 1;
        p[TextScanningTrie.CODE_SEMICOLON] = 1;
        p[TextScanningTrie.CODE_COLON] = 1;
        p[TextScanningTrie.CODE_HYPHEN] = 1;
        p[TextScanningTrie.CODE_SLASH] = 1;

        // Initialize whitespace flags
        const w = TextScanningTrie.WHITESPACE_FLAGS;
        w[0x0020] = 1; // Space
        w[0x0009] = 1; // Tab
        w[0x000A] = 1; // LF
        w[0x000B] = 1; // VT
        w[0x000C] = 1; // FF
        w[0x000D] = 1; // CR
        w[0x00A0] = 1; // NBSP
    }

    /**
     * Checks if a character code represents a whitespace character.
     * Covers common ASCII and Unicode whitespace to match Regex `\s`.
     */
    public static isWhitespace(code: number): boolean {
        // Optimization: Fast path for common ASCII + Latin-1 space using lookup table
        if (code < 256) {
            return !!TextScanningTrie.WHITESPACE_FLAGS[code];
        }

        return (code === 0x1680) || // Ogham Space Mark
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
        // Check for Unicode Punctuation (General Punctuation block U+2000 - U+206F)
        // Covers En Dash (2013), Em Dash (2014), Ellipsis (2026), etc.
        return (code >= 0x2000 && code <= 0x206F);
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
