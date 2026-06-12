/**
 * epubcfiShim — the ONE module allowed to import `epubjs/src/epubcfi`
 * (phase5-tts-strangler.md §5c.4). Everything else in the kernel (and the
 * rest of the tree) goes through these typed wrappers, so the
 * `@ts-expect-error`'d epubjs internals are quarantined to a single file.
 * `cfi.kernel-boundary.test.ts` pins this as an invariant.
 *
 * Kernel admission (master plan §2 rule 1): no internal imports — epubjs is
 * an external package, and we import the CFI class from its submodule so the
 * DOM-heavy Book/Rendition code stays out of the TTS worker bundle (the
 * submodule's type mapping lives in src/types/epubjs-epubcfi.d.ts).
 */
import EpubCFI from 'epubjs/src/epubcfi';

/**
 * An epubjs-parsed CFI point, opaque to callers. Produced by
 * {@link parseCfiPoint}; consumed by {@link CfiComparator.compare}.
 */
export interface ParsedCfiPoint {
    /** Brand only — never reach inside; the shim owns the representation. */
    readonly __cfiPoint: unknown;
}

/** Parse a CFI string into an epubjs CFI object. Throws on invalid input. */
export function parseCfiPoint(cfi: string): ParsedCfiPoint {
    return new EpubCFI(cfi) as unknown as ParsedCfiPoint;
}

/** Parse a CFI string, returning null instead of throwing on invalid input. */
export function tryParseCfiPoint(cfi: string): ParsedCfiPoint | null {
    try {
        return parseCfiPoint(cfi);
    } catch {
        return null;
    }
}

/**
 * Document-order comparison of CFI points. Wraps epubjs `EpubCFI.compare`,
 * which accepts pre-parsed CFI objects despite its string-only type
 * signature — the `@ts-expect-error` lives here and nowhere else.
 */
export class CfiComparator {
    private readonly comparer = new EpubCFI();

    /** Negative when a < b, 0 when equal, positive when a > b (document order). */
    compare(a: ParsedCfiPoint, b: ParsedCfiPoint): number {
        // @ts-expect-error epubjs compare accepts EpubCFI objects despite strict string types
        return this.comparer.compare(a, b);
    }

    /** Convenience: parse-and-compare two CFI strings. Throws on invalid input. */
    compareStrings(a: string, b: string): number {
        return this.compare(parseCfiPoint(a), parseCfiPoint(b));
    }
}

/**
 * Generates a CFI string for a DOM Range relative to a base component
 * (the part before `!`). Used by decoupled extraction and sentence snapping.
 */
export function cfiFromRange(range: Range, baseComponent: string): string {
    return new EpubCFI(range, baseComponent).toString();
}
