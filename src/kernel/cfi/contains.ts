/**
 * Canonical CFI containment — THE separator set and the two canonical
 * primitives (`cfiContains`, `stripCfiWrapper` in ./parse) that replace the
 * divergent inline copies that lived in AudioContentPipeline (`['/', '!',
 * ':']` — missing `[` and `,`, a live mis-grouping bug for assertion-bracket
 * children) and TableAdaptationProcessor (phase5-tts-strangler.md §5c.4,
 * content debt D9 / S17).
 *
 * `getParentCfi` is ported verbatim from src/lib/cfi-utils.ts; its
 * string-prefix fast path is pinned against the parsed-component oracle in
 * cfi.equivalence.fuzz.test.ts.
 */
import { parseCfiRange, stripCfiWrapper, parseCfiTokens, serializeCfiTokens, preprocessBlockRoots } from './parse';
import type { CfiToken, PreprocessedRoot } from './parse';

/**
 * THE canonical step-boundary separator set (the `getParentCfi` set —
 * cfi-utils.ts:127 at the Phase 5 design pin). A string-prefix match is a
 * containment only when the next character is one of these (or the end of
 * the string): child step (`/`), indirection (`!`), assertion bracket (`[`),
 * range component (`,`), or character offset (`:`).
 */
const CFI_STEP_SEPARATORS: ReadonlyArray<string> = ['/', '!', '[', ',', ':'];

/**
 * True when `child` is `parent` itself or a structural descendant of it
 * (same path extended by steps, an assertion, an offset, or range
 * components). Accepts wrapped (`epubcfi(...)`) or bare CFIs on either side.
 *
 * String semantics: prefix match at a step boundary using
 * {@link CFI_STEP_SEPARATORS}. Conservative by design — a parent that elides
 * a mid-path assertion the child spells out does not match (the parsed
 * oracle in the equivalence suite documents this as the fast path declining,
 * never diverging).
 */
export function cfiContains(parent: string, child: string): boolean {
    if (!parent || !child) return false;
    const p = stripCfiWrapper(parent);
    const c = stripCfiWrapper(child);
    if (!c.startsWith(p)) return false;
    if (c.length === p.length) return true;
    return CFI_STEP_SEPARATORS.includes(c[p.length]);
}

/**
 * Parsed-component containment — the reference implementation
 * {@link cfiContains}'s fast path is tested against. Returns null when
 * either side fails to tokenize (the oracle declines un-CFI-like input).
 *
 * Token semantics: parent's token sequence must be a prefix of child's,
 * where the FINAL parent step may elide an assertion the child spells out
 * (`/4/2` contains `/4/2[id]` — exactly what the string fast path accepts
 * via the `[` separator).
 */
export function cfiContainsParsed(parent: string, child: string): boolean | null {
    const p = parseCfiTokens(parent);
    const c = parseCfiTokens(child);
    if (!p || !c) return null;
    if (p.length > c.length) return false;
    for (let i = 0; i < p.length; i++) {
        const isLast = i === p.length - 1;
        if (!tokensMatch(p[i], c[i], isLast)) return false;
    }
    return true;
}

function tokensMatch(parent: CfiToken, child: CfiToken, parentIsLast: boolean): boolean {
    if (parent.kind !== child.kind) return false;
    switch (parent.kind) {
        case 'step': {
            const c = child as typeof parent;
            if (parent.index !== c.index) return false;
            if (parent.assertion === c.assertion) return true;
            // The last parent step may omit an assertion the child has.
            return parentIsLast && parent.assertion === undefined && c.assertion !== undefined;
        }
        case 'offset': {
            const c = child as typeof parent;
            return parent.value === c.value && (parent.assertion === c.assertion ||
                (parentIsLast && parent.assertion === undefined && c.assertion !== undefined));
        }
        case 'indirection':
        case 'rangeComma':
            return true;
    }
}

/**
 * Parsed-component parent derivation — the oracle `getParentCfi`'s string
 * fast path is tested against. For a range CFI: the range parent component.
 * For a point CFI: the path with the terminal offset and the leaf step
 * dropped. Returns null when the input fails to tokenize.
 */
export function getParentCfiParsed(cfi: string): string | null {
    const tokens = parseCfiTokens(cfi);
    if (!tokens || tokens.length === 0) return null;

    const firstComma = tokens.findIndex(t => t.kind === 'rangeComma');
    if (firstComma !== -1) {
        // Range CFI: the parent is everything before the first range comma.
        return `epubcfi(${serializeCfiTokens(tokens.slice(0, firstComma))})`;
    }

    // Point CFI: drop the terminal offset, then the leaf step. The legacy
    // string path strips the leaf only on the CONTENT side of the last `!`
    // (spine steps are never stripped), so mirror that: find the last
    // indirection and only drop steps after it.
    let end = tokens.length;
    if (end > 0 && tokens[end - 1].kind === 'offset') end--;
    const lastIndirection = tokens.slice(0, end).map(t => t.kind).lastIndexOf('indirection');
    if (end > 0 && tokens[end - 1].kind === 'step' && end - 1 > lastIndirection) end--;
    return `epubcfi(${serializeCfiTokens(tokens.slice(0, end))})`;
}

/**
 * Extracts the parent block-level CFI from a given CFI string.
 * This handles both range CFIs and point/standard CFIs.
 *
 * @param cfi The CFI string (range or standard).
 * @param knownBlockRoots Optional list of CFI strings that are known block roots (e.g. tables). If the CFI is a descendant of one of these, it will be snapped to that root.
 * @returns The parent CFI or 'unknown' if extraction fails.
 */
export function getParentCfi(cfi: string, knownBlockRoots: string[] | PreprocessedRoot[] = []): string {
    if (!cfi) return 'unknown';

    // 1. Check known block roots (e.g. Tables) - Priority over Range CFI parsing
    if (knownBlockRoots.length > 0) {
        let roots: PreprocessedRoot[];

        // Check if already preprocessed (duck typing or simply by type if generic)
        if (typeof knownBlockRoots[0] === 'string') {
            // Slow path: Preprocess on the fly (includes sorting)
            roots = preprocessBlockRoots(knownBlockRoots as string[]);
        } else {
            // Fast path: Use preprocessed roots
            roots = knownBlockRoots as PreprocessedRoot[];
        }

        // Pre-clean the target CFI once
        const cleanCfi = stripCfiWrapper(cfi);

        for (const { original, clean } of roots) {
            if (cleanCfi.startsWith(clean)) {
                // Ensure boundary match: if cleanCfi is exactly equal to clean, it's a
                // match; if longer, the next char must be a separator from THE set
                // (comma supports Range CFIs as target, e.g. /6/24!/4/2/4 matches
                // /6/24!/4/2/4,/1:0,…).
                const nextChar = cleanCfi[clean.length];
                if (!nextChar || CFI_STEP_SEPARATORS.includes(nextChar)) {
                    return original;
                }
            }
        }
    }

    // 2. Try parsing as a Range CFI (epubcfi(parent, start, end))
    const parsed = parseCfiRange(cfi);
    if (parsed) {
        return `epubcfi(${parsed.parent})`;
    }

    // 3. Fallback: Try handling as a Standard/Point CFI (epubcfi(/.../!/...))
    if (cfi.startsWith('epubcfi(')) {
        try {
            // Optimization: Avoid regex replace and array splitting
            const content = cfi.slice(8, -1);
            const spineSepIndex = content.indexOf('!');

            if (spineSepIndex !== -1) {
                const spine = content.substring(0, spineSepIndex);
                const path = content.substring(spineSepIndex + 1);

                if (path) {
                    // Find the last slash to strip the leaf component (e.g. /4/2/1:0 -> /4/2)
                    // Note: path usually starts with /, so we look for the last one
                    let lastSlash = path.lastIndexOf('/');

                    // Handle edge case where path ends with slash (unlikely but safe to handle)
                    if (lastSlash === path.length - 1) {
                        lastSlash = path.lastIndexOf('/', lastSlash - 1);
                    }

                    if (lastSlash > 0) {
                        // Return everything up to the last slash
                        return `epubcfi(${spine}!${path.substring(0, lastSlash)})`;
                    } else if (lastSlash === 0) {
                        // Only one slash at start (e.g. /4), stripping it leaves empty path
                        return `epubcfi(${spine}!)`;
                    }

                    // No slash found in path (unlikely for valid CFI path), return as is or fallback to spine
                    // If path is "1:0" (no leading slash), stripping it means empty.
                    return `epubcfi(${spine}!)`;
                }

                return `epubcfi(${spine}!)`;
            } else {
                // No separator found. Treat content as spine.
                return `epubcfi(${content}!)`;
            }
        } catch (e) {
            console.warn("Failed to extract parent CFI", e);
        }
    }

    // Return original if we can't parse it (or 'unknown' based on preference, but original might be safer for grouping)
    return cfi;
}
