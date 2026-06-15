import type { SearchSection, DetailedSearchResult, SearchBatchResult } from '~types/search';

/**
 * Build a context excerpt around a match, sliced from the ORIGINAL string with
 * the ORIGINAL match offsets (so excerpts stay aligned even when lowercasing
 * would change length — the Turkish-İ hazard). Shared (Increment cleanup #10a)
 * by {@link SearchEngine.searchDetailed} (the regex path) and the search-side
 * semantic ranker (semanticRank.ts), which previously kept a verbatim copy.
 *
 * @param text - The full text the match was found in.
 * @param index - The start index of the match.
 * @param length - The length of the match.
 * @param context - Chars of context on each side (default 40).
 */
export function getExcerpt(text: string, index: number, length: number, context = 40): string {
    const start = Math.max(0, index - context);
    const end = Math.min(text.length, index + length + context);
    return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}

/**
 * In-memory full-text scan over a book's plain text (one entry per spine
 * section). Matching is a case-insensitive escaped-literal scan against the
 * ORIGINAL string (Phase 7 PR-S2): an escaped literal cannot backtrack — the
 * historical ReDoS concern applied to query-derived *patterns*, which this
 * engine never builds — and original-string offsets mean excerpts and
 * `charOffset` stay aligned even when lowercasing changes string length
 * (the Turkish-İ misalignment of the old lowercase-then-slice approach).
 *
 * Runs in the search worker (Comlink-exposed) or directly in tests.
 */
export class SearchEngine {
    // Stores content as: BookID -> (Href -> {text, title})
    private books = new Map<string, Map<string, { text: string; title?: string }>>();

    /** Default scan cap per query; the result says when it was hit. */
    static readonly DEFAULT_LIMIT = 50;

    /**
     * Initializes an empty storage for a book, clearing any previous data.
     *
     * @param bookId - The unique identifier of the book.
     */
    initIndex(bookId: string) {
        this.books.set(bookId, new Map());
    }

    /**
     * Adds documents (sections) to the store for a book.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections to add.
     */
    addDocuments(bookId: string, sections: SearchSection[]) {
        let bookStore = this.books.get(bookId);
        if (!bookStore) {
            bookStore = new Map();
            this.books.set(bookId, bookStore);
        }

        // Check if the number of documents being added is excessively large
        const LARGE_INDEX_THRESHOLD = 2000;
        if (sections.length > LARGE_INDEX_THRESHOLD) {
            console.warn(`Search Index Warning: Adding ${sections.length} documents. Index size may impact performance.`);
        }

        sections.forEach(section => {
            const text = section.text;
            if (text) {
                bookStore.set(section.href, { text, title: section.title });
            }
        });
    }

    /**
     * Indexes a book's sections for searching.
     * Replaces existing data for the book.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections containing text and location data to be indexed.
     */
    indexBook(bookId: string, sections: SearchSection[]) {
        this.initIndex(bookId);
        this.addDocuments(bookId, sections);
    }

    /**
     * Per-occurrence search (Phase 7 §F): every hit carries `charOffset`,
     * `matchLength` and a per-section `occurrence` ordinal so navigation can
     * land on the EXACT match; `truncated` replaces the silent result cap.
     */
    searchDetailed(
        bookId: string,
        query: string,
        opts: { limit?: number } = {},
    ): SearchBatchResult {
        const bookStore = this.books.get(bookId);
        const trimmed = query.trim();
        if (!bookStore || !trimmed) return { results: [], truncated: false };

        const limit = opts.limit ?? SearchEngine.DEFAULT_LIMIT;
        // Escaped LITERAL: user input is never interpreted as a pattern.
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'giu');

        const results: DetailedSearchResult[] = [];
        let truncated = false;

        outer: for (const [href, section] of bookStore.entries()) {
            pattern.lastIndex = 0;
            let occurrence = 0;
            let match: RegExpExecArray | null;

            while ((match = pattern.exec(section.text)) !== null) {
                // Escaped non-empty literals cannot match zero-width, but the
                // guard keeps the loop structurally safe.
                if (match[0].length === 0) {
                    pattern.lastIndex += 1;
                    continue;
                }
                occurrence += 1;

                if (results.length >= limit) {
                    truncated = true;
                    break outer;
                }

                results.push({
                    href,
                    sectionTitle: section.title,
                    excerpt: getExcerpt(section.text, match.index, match[0].length),
                    charOffset: match.index,
                    matchLength: match[0].length,
                    occurrence,
                });
            }
        }

        return { results, truncated };
    }

    /**
     * §2.3/§4.4 pure-compute helpers consumed by the Phase-C worker cosine
     * ranking. They operate ONLY over transferred typed arrays (no IDB, no
     * store/yjs/zustand edge), so the worker stays pure: all embedding I/O is
     * main-thread via the repos, and the worker only ever receives the packed
     * vectors. Quantization is per-vector: `scale = max(|v|)/127`, so each row
     * keeps its own dynamic range and the cosine is a single int32 dot product
     * rescaled by the two float32 scales once.
     */

    /**
     * Quantize a float32 embedding to int8 with a single per-vector scale.
     * `q[i] = round(v[i] / scale)` where `scale = max(|v|) / 127`; a zero (or
     * all-zero) vector yields a zero int8 row and `scale === 0`.
     */
    quantizeInt8PerVector(vec: Float32Array): { vectors: Int8Array; scale: number } {
        let maxAbs = 0;
        for (let i = 0; i < vec.length; i++) {
            const a = Math.abs(vec[i]);
            if (a > maxAbs) maxAbs = a;
        }
        const vectors = new Int8Array(vec.length);
        if (maxAbs === 0) {
            return { vectors, scale: 0 };
        }
        const scale = maxAbs / 127;
        for (let i = 0; i < vec.length; i++) {
            // round-half-away-from-zero, clamped to the signed-int8 range.
            let q = Math.round(vec[i] / scale);
            if (q > 127) q = 127;
            else if (q < -128) q = -128;
            vectors[i] = q;
        }
        return { vectors, scale };
    }

    /**
     * Cosine similarity between a query int8 vector and a packed corpus of
     * int8 rows. `aVecs` packs one or more `dims`-length rows back-to-back;
     * each row's dot product with `bVec` is accumulated as an int32 (a plain
     * JS number stays exact well within ±2^53), then multiplied by
     * `aScale * bScale` ONCE — never per element. Returns the BEST (max)
     * cosine across the packed rows. A zero-scale (zero vector) row contributes
     * a cosine of 0.
     */
    int8Cosine(
        aVecs: Int8Array,
        aScale: number,
        bVec: Int8Array,
        bScale: number,
        dims: number,
    ): number {
        if (dims <= 0 || bScale === 0 || aScale === 0) return 0;

        // |b| in the dequantized space: scale * sqrt(Σ q_b²). Computed once.
        let bSq = 0;
        for (let i = 0; i < dims; i++) bSq += bVec[i] * bVec[i];
        const bNorm = bScale * Math.sqrt(bSq);
        if (bNorm === 0) return 0;

        const rows = Math.floor(aVecs.length / dims);
        let best = 0;
        for (let r = 0; r < rows; r++) {
            const base = r * dims;
            let dot = 0; // int8·int8 accumulated as an exact int32-range number
            let aSq = 0;
            for (let i = 0; i < dims; i++) {
                const av = aVecs[base + i];
                dot += av * bVec[i];
                aSq += av * av;
            }
            if (aSq === 0) continue; // zero row → cosine 0
            // Apply the two float32 scales once: the scales cancel in the
            // cosine ratio's numerator/denominator, but keeping them explicit
            // mirrors the §4.4 formula and stays exact for non-unit vectors.
            const aNorm = aScale * Math.sqrt(aSq);
            const cosine = (aScale * bScale * dot) / (aNorm * bNorm);
            if (cosine > best) best = cosine;
        }
        return best;
    }

    /**
     * Rank the packed int8 corpus rows by cosine against an int8 query vector,
     * returning the top-`limit` rows as `{ row, cosine }` descending (Increment
     * D §2, the search-side semantic ranking). `packedVecs` packs one
     * `dims`-length int8 row per chunk back-to-back; `scales[r]` is row `r`'s
     * per-vector float32 scale. Each row's cosine is computed via the SAME
     * {@link int8Cosine} formula on a single-row view — so int8Cosine gains a
     * real production consumer (it was previously only self-tested) and the two
     * code paths can never drift.
     *
     * Pure compute over typed arrays only (no IDB/store edge): it crosses the
     * Comlink worker seam exactly like {@link searchDetailed}.
     */
    rankInt8(
        packedVecs: Int8Array,
        scales: Float32Array,
        queryVec: Int8Array,
        queryScale: number,
        dims: number,
        limit: number,
    ): { row: number; cosine: number }[] {
        if (dims <= 0 || limit <= 0 || queryScale === 0) return [];

        const rows = Math.floor(packedVecs.length / dims);
        const scored: { row: number; cosine: number }[] = [];
        for (let r = 0; r < rows; r++) {
            const base = r * dims;
            // A single-row view so int8Cosine ranks exactly this chunk (its
            // "best across packed rows" reduces to the one row's cosine).
            const rowView = packedVecs.subarray(base, base + dims);
            const cosine = this.int8Cosine(rowView, scales[r] ?? 0, queryVec, queryScale, dims);
            if (cosine > 0) scored.push({ row: r, cosine });
        }

        scored.sort((a, b) => b.cosine - a.cosine);
        return scored.slice(0, limit);
    }
}
