/**
 * Canonical CFI parsing — the parsed-component reference model plus the
 * string-level helpers ported verbatim from src/lib/cfi-utils.ts
 * (phase5-tts-strangler.md §5c.4).
 *
 * The component model ({@link parseCfiTokens}) is the ORACLE for every
 * string fast path in this kernel: `cfi.equivalence.fuzz.test.ts` pins
 * fast-path agreement against it over a structured CFI arbitrary. Fast
 * paths may be conservative (decline / fall back), never divergent.
 */

export interface CfiRangeData {
    parent: string;
    start: string;
    end: string;
    rawStart: string;
    rawEnd: string;
    fullStart: string;
    fullEnd: string;
}

export interface PreprocessedRoot {
    original: string;
    clean: string;
}

/** `epubcfi(X)` → `X`; anything else is returned unchanged. */
export function stripCfiWrapper(cfi: string): string {
    if (cfi.startsWith('epubcfi(') && cfi.endsWith(')')) {
        return cfi.slice(8, -1);
    }
    return cfi;
}

/**
 * Pre-processes a list of block roots (e.g. table CFIs) for efficient repeated querying.
 * Sorts by length descending and pre-calculates the clean root path.
 */
export function preprocessBlockRoots(roots: string[]): PreprocessedRoot[] {
    return roots
        .map(root => {
            let cleanRoot = root;
            const range = parseCfiRange(root);
            if (range && range.parent) {
                cleanRoot = range.parent;
            } else {
                cleanRoot = stripCfiWrapper(cleanRoot);
            }
            return { original: root, clean: cleanRoot };
        })
        .sort((a, b) => b.clean.length - a.clean.length);
}

export function parseCfiRange(range: string): CfiRangeData | null {
    if (!range || !range.startsWith('epubcfi(') || !range.endsWith(')')) return null;

    // Optimization: Early check for comma to avoid unnecessary string operations for Point CFIs
    if (range.indexOf(',') === -1) return null;

    const content = range.slice(8, -1); // remove epubcfi( and )
    const parts = content.split(',');

    if (parts.length === 3) {
        const parent = parts[0];
        const start = parts[1];
        const end = parts[2];
        return {
            parent,
            start,
            end,
            rawStart: parent + start,
            rawEnd: parent + end,
            fullStart: `epubcfi(${parent}${start})`,
            fullEnd: `epubcfi(${parent}${end})`
        };
    }
    return null;
}

// --- The parsed-component reference model ---

/** One `/N[assertion]` step in a CFI path. */
export interface CfiStepToken {
    kind: 'step';
    index: number;
    assertion?: string;
}

/** The `!` indirection separator between document levels. */
interface CfiIndirectionToken {
    kind: 'indirection';
}

/** A `:N[assertion]` character-offset terminal. */
interface CfiOffsetToken {
    kind: 'offset';
    value: number;
    assertion?: string;
}

/** A top-level `,` separating the parent / start / end components of a range CFI. */
interface CfiRangeCommaToken {
    kind: 'rangeComma';
}

export type CfiToken = CfiStepToken | CfiIndirectionToken | CfiOffsetToken | CfiRangeCommaToken;

/**
 * Tokenizes a CFI (wrapped or bare) into its component sequence. Handles
 * `^`-escaped characters inside `[...]` assertions per the EPUB CFI spec.
 * Returns null when the string is not structurally a CFI (unbalanced
 * assertion brackets, non-numeric steps, trailing garbage).
 */
export function parseCfiTokens(cfi: string): CfiToken[] | null {
    const content = stripCfiWrapper(cfi);
    if (content.length === 0) return null;

    const tokens: CfiToken[] = [];
    let i = 0;

    /** Reads a `[assertion]` if present at `i`; returns undefined when absent, null on malformed. */
    const readAssertion = (): string | undefined | null => {
        if (content[i] !== '[') return undefined;
        i++; // consume '['
        let out = '';
        while (i < content.length) {
            const ch = content[i];
            if (ch === '^') {
                // ^-escape: next char is literal
                if (i + 1 >= content.length) return null;
                out += content[i + 1];
                i += 2;
                continue;
            }
            if (ch === ']') {
                i++; // consume ']'
                return out;
            }
            out += ch;
            i++;
        }
        return null; // unbalanced
    };

    /** Reads an unsigned integer at `i`; returns null when absent. */
    const readNumber = (): number | null => {
        const start = i;
        while (i < content.length && content[i] >= '0' && content[i] <= '9') i++;
        if (i === start) return null;
        return Number(content.slice(start, i));
    };

    while (i < content.length) {
        const ch = content[i];
        if (ch === '/') {
            i++;
            const index = readNumber();
            if (index === null) return null;
            const assertion = readAssertion();
            if (assertion === null) return null;
            tokens.push(assertion === undefined ? { kind: 'step', index } : { kind: 'step', index, assertion });
        } else if (ch === '!') {
            i++;
            tokens.push({ kind: 'indirection' });
        } else if (ch === ':') {
            i++;
            const value = readNumber();
            if (value === null) return null;
            const assertion = readAssertion();
            if (assertion === null) return null;
            tokens.push(assertion === undefined ? { kind: 'offset', value } : { kind: 'offset', value, assertion });
        } else if (ch === ',') {
            i++;
            tokens.push({ kind: 'rangeComma' });
        } else {
            return null;
        }
    }

    return tokens;
}

/** Serializes a token sequence back to a bare (unwrapped) CFI string. */
export function serializeCfiTokens(tokens: ReadonlyArray<CfiToken>): string {
    let out = '';
    for (const t of tokens) {
        switch (t.kind) {
            case 'step':
                out += `/${t.index}${t.assertion !== undefined ? `[${escapeAssertion(t.assertion)}]` : ''}`;
                break;
            case 'indirection':
                out += '!';
                break;
            case 'offset':
                out += `:${t.value}${t.assertion !== undefined ? `[${escapeAssertion(t.assertion)}]` : ''}`;
                break;
            case 'rangeComma':
                out += ',';
                break;
        }
    }
    return out;
}

function escapeAssertion(assertion: string): string {
    return assertion.replace(/[\^[\](),;=]/g, c => `^${c}`);
}
