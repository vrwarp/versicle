import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SearchEngine } from './search-engine';

/**
 * The legacy `search()` shape ({href, excerpt}, silent 50-cap) died with the
 * reader-side SearchSession adoption; these suites scan through
 * `searchDetailed` — the per-occurrence results carry the same href/excerpt
 * fields the historical assertions pin.
 */
const search = (engine: SearchEngine, bookId: string, query: string) =>
    engine.searchDetailed(bookId, query).results;

describe('SearchEngine', () => {
    let engine: SearchEngine;

    beforeEach(() => {
        engine = new SearchEngine();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should index and search a book', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Call me Ishmael.' },
            { id: '2', href: 'chap2.html', text: 'The white whale swam.' }
        ];

        engine.indexBook('moby-dick', sections);

        const results = search(engine, 'moby-dick', 'Ishmael');

        expect(results).toHaveLength(1);
        expect(results[0].href).toBe('chap1.html');
        expect(results[0].excerpt).toContain('Ishmael');
    });

    it('should return empty array for unknown book', () => {
        const results = search(engine, 'unknown', 'query');
        expect(results).toEqual([]);
    });

    it('should handle case-insensitive search', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'This is a TEST.' }
        ];
        engine.indexBook('test-book', sections);

        const results = search(engine, 'test-book', 'test');
        expect(results).toHaveLength(1);
    });

    it('should generate excerpts', () => {
         const text = "A long time ago in a galaxy far, far away.... It is a period of civil war.";
         const sections = [
            { id: '1', href: 'starwars.html', text }
        ];
        engine.indexBook('sw', sections);

        const results = search(engine, 'sw', 'galaxy');
        expect(results[0].excerpt).toContain('galaxy');
        // Check context
        expect(results[0].excerpt).toContain('far away');
    });

    it('should handle regex special characters in query', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Why? Because I said so. (Parentheses) [Brackets] +Plus *Star.' }
        ];
        engine.indexBook('special-chars', sections);

        let results = search(engine, 'special-chars', 'Why?');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('Why?');

        results = search(engine, 'special-chars', '(Parentheses)');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('(Parentheses)');

        results = search(engine, 'special-chars', '[Brackets]');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('[Brackets]');

        results = search(engine, 'special-chars', '+Plus');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('+Plus');

        results = search(engine, 'special-chars', '*Star');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('*Star');
    });

    it('should handle unicode characters', () => {
        const sections = [
            { id: '1', href: 'unicode.html', text: 'Thé quick bröwn föx jumps över the lazy dögs. 💩' }
        ];
        engine.indexBook('unicode', sections);

        let results = search(engine, 'unicode', 'Thé');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('Thé');

        results = search(engine, 'unicode', 'bröwn');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('bröwn');

        results = search(engine, 'unicode', '💩');
        expect(results).toHaveLength(1);
        expect(results[0].excerpt).toContain('💩');
    });

    it('should return empty array when no match found in existing book', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Just some normal text.' }
        ];
        engine.indexBook('no-match', sections);

        const results = search(engine, 'no-match', 'missing');
        expect(results).toHaveLength(0);
    });

    it('should find multiple matches in the same section', () => {
        const sections = [
            { id: '1', href: 'chap1.html', text: 'Apple banana apple orange Apple.' }
        ];
        engine.indexBook('multiple', sections);

        const results = search(engine, 'multiple', 'apple');
        expect(results).toHaveLength(3); // Apple, apple, Apple
        expect(results[0].excerpt).toContain('Apple');
        expect(results[1].excerpt).toContain('apple');
        expect(results[2].excerpt).toContain('Apple');
    });

    it('should cap results at 50', () => {
        const word = "repeat ";
        const text = word.repeat(100);
        const sections = [
            { id: '1', href: 'limit.html', text: text }
        ];
        engine.indexBook('limit', sections);

        const results = search(engine, 'limit', 'repeat');
        expect(results).toHaveLength(50);
    });

    it('should handle multiple sections', () => {
        const sections = [
             { id: '1', href: 'chap1.html', text: 'First chapter text.' },
             { id: '2', href: 'chap2.html', text: 'Second chapter text.' }
        ];
        engine.indexBook('multi-section', sections);

        const results = search(engine, 'multi-section', 'chapter');
        expect(results).toHaveLength(2);
        expect(results[0].href).toBe('chap1.html');
        expect(results[1].href).toBe('chap2.html');
    });

    // The old "zero-width RegExp match" test was deleted in the Phase 7
    // search consolidation (PR-0c): the engine scans with String#indexOf, so
    // the test mocked a global the engine never touches and asserted nothing
    // (`toBeDefined` on an array) — a vacuous pin (search.md Debt list;
    // phase7-library-google.md PR-0c).

    describe('regression: edge placement and unicode (absorbed from search-engine.comprehensive.test.ts)', () => {
        it('handles bracketed/braced literals as plain text', () => {
            const text = 'This has a (parenthesis) and a [bracket] and a {brace}.';
            engine.indexBook('test-book', [{ id: '1', href: 'chap1.html', text }]);

            expect(search(engine, 'test-book', '(parenthesis)')).toHaveLength(1);
            expect(search(engine, 'test-book', '[bracket]')).toHaveLength(1);
            expect(search(engine, 'test-book', '{brace}')).toHaveLength(1);
            expect(search(engine, 'test-book', '(parenthesis)')[0].excerpt).toContain('(parenthesis)');
        });

        it('correctly handles matches at the very beginning', () => {
            engine.indexBook('start', [{ id: '1', href: 'start.html', text: 'Start of the text.' }]);
            const results = search(engine, 'start', 'Start');
            expect(results[0].excerpt.trim()).toMatch(/^Start/);
        });

        it('correctly handles matches at the very end', () => {
            engine.indexBook('end', [{ id: '1', href: 'end.html', text: 'End of the text' }]);
            const results = search(engine, 'end', 'text');
            expect(results[0].excerpt).toContain('text');
            expect(results[0].excerpt.endsWith('text')).toBe(true);
        });

        it('finds matches after length-changing lowercase mappings when context absorbs the drift', () => {
            // "İ" (U+0130) lowercases to "i̇" (2 code units) — small drifts stay
            // inside the ±40-char excerpt window.
            engine.indexBook('unicode', [{ id: '1', href: 'unicode.html', text: 'AİB matching text' }]);
            const results = search(engine, 'unicode', 'matching');
            expect(results).toHaveLength(1);
            expect(results[0].excerpt).toContain('matching');
        });
    });

    describe('regression: case-fold excerpt misalignment (pinned broken at PR-0c; FIXED by PR-S2)', () => {
        it('keeps the match inside the excerpt even when length-changing characters precede it', () => {
            // 45 × "İ" lowercase to 90 code units. The old lowercase-then-slice
            // scan found the match at the LOWERCASED index (+45 drift) and
            // sliced the original string there, losing the match from its own
            // excerpt — pinned as documented-current-behavior at the entry
            // gate. PR-S2's original-string matching flips this deliberately.
            const text = 'İ'.repeat(45) + 'target';
            engine.indexBook('turkish', [{ id: '1', href: 'i.html', text }]);

            const results = search(engine, 'turkish', 'target');
            expect(results).toHaveLength(1);
            expect(results[0].excerpt).toContain('target');
        });
    });

    describe('searchDetailed (Phase 7 §F: per-occurrence offsets + honest truncation)', () => {
        it('reports charOffset/matchLength/occurrence against the ORIGINAL string', () => {
            const text = 'Apple banana apple orange Apple.';
            engine.indexBook('occ', [{ id: '1', href: 'chap1.html', text, title: 'Fruit' }]);

            const { results, truncated } = engine.searchDetailed('occ', 'apple');

            expect(truncated).toBe(false);
            expect(results.map((r) => r.occurrence)).toEqual([1, 2, 3]);
            expect(results.map((r) => r.charOffset)).toEqual([0, 13, 26]);
            for (const r of results) {
                expect(text.substring(r.charOffset, r.charOffset + r.matchLength).toLowerCase()).toBe('apple');
                expect(r.sectionTitle).toBe('Fruit');
                expect(r.cfi).toBeUndefined(); // CFI is resolved lazily, never by the engine
            }
        });

        it('sets truncated instead of silently capping', () => {
            engine.indexBook('cap', [{ id: '1', href: 'limit.html', text: 'repeat '.repeat(100) }]);

            const capped = engine.searchDetailed('cap', 'repeat');
            expect(capped.results).toHaveLength(50);
            expect(capped.truncated).toBe(true);

            const generous = engine.searchDetailed('cap', 'repeat', { limit: 200 });
            expect(generous.results).toHaveLength(100);
            expect(generous.truncated).toBe(false);
        });

        it('treats the query as an escaped literal (regex metacharacters inert)', () => {
            engine.indexBook('lit', [{ id: '1', href: 'c.html', text: 'a (b) c .* d' }]);
            expect(engine.searchDetailed('lit', '.*').results).toHaveLength(1);
            expect(engine.searchDetailed('lit', '(b)').results).toHaveLength(1);
            expect(engine.searchDetailed('lit', 'x+').results).toHaveLength(0);
        });
    });

    describe('int8 quantize/cosine compute (Increment B §2.3/§4.4 pure helpers)', () => {
        /** Reference float32 cosine for the recall-tolerance comparison. */
        const floatCosine = (a: Float32Array, b: Float32Array): number => {
            let dot = 0;
            let aSq = 0;
            let bSq = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                aSq += a[i] * a[i];
                bSq += b[i] * b[i];
            }
            if (aSq === 0 || bSq === 0) return 0;
            return dot / (Math.sqrt(aSq) * Math.sqrt(bSq));
        };

        it('quantize/dequantize round-trips within one int8 step', () => {
            const vec = new Float32Array([0.5, -0.25, 1.0, -1.0, 0.1, 0.0]);
            const { vectors, scale } = engine.quantizeInt8PerVector(vec);

            // scale = max(|v|)/127 = 1.0/127, so the dequantized value is
            // within ±scale (half-step rounding) of the original.
            expect(scale).toBeCloseTo(1.0 / 127, 12);
            for (let i = 0; i < vec.length; i++) {
                expect(Math.abs(vectors[i] * scale - vec[i])).toBeLessThanOrEqual(scale);
            }
            // The max-magnitude component maps to the int8 extreme.
            expect(vectors[2]).toBe(127);
            expect(vectors[3]).toBe(-127);
        });

        it('treats an all-zero vector as scale 0 with a zero int8 row', () => {
            const { vectors, scale } = engine.quantizeInt8PerVector(new Float32Array([0, 0, 0]));
            expect(scale).toBe(0);
            expect(Array.from(vectors)).toEqual([0, 0, 0]);
        });

        it('int8 cosine ≈ reference float32 cosine within recall tolerance', () => {
            const cases: [number[], number[]][] = [
                [[1, 0, 0, 0], [1, 0, 0, 0]], // identical unit vectors → 1
                [[1, 0, 0, 0], [0, 1, 0, 0]], // orthogonal → 0
                [[1, 1, 0, 0], [1, 0, 0, 0]], // 45° → ~0.707
                [[0.2, -0.7, 0.5, 0.1], [0.1, -0.6, 0.55, 0.3]], // near, non-unit
                [[-3, 4, 0, 0], [3, -4, 0, 0]], // anti-parallel → -1
            ];

            for (const [aArr, bArr] of cases) {
                const a = Float32Array.from(aArr);
                const b = Float32Array.from(bArr);
                const qa = engine.quantizeInt8PerVector(a);
                const qb = engine.quantizeInt8PerVector(b);

                const reference = floatCosine(a, b);
                // int8Cosine returns the BEST cosine; non-negative cases match
                // directly. Anti-parallel collapses to 0 (best of a single
                // negative row) — assert the sign-aware single-row formula
                // instead by checking against a clamped reference.
                const got = engine.int8Cosine(qa.vectors, qa.scale, qb.vectors, qb.scale, a.length);
                const expected = Math.max(0, reference);
                expect(Math.abs(got - expected)).toBeLessThan(0.02);
            }
        });

        it('returns the BEST cosine across a packed multi-row corpus', () => {
            const dims = 3;
            // Two packed query candidate rows: one orthogonal, one identical.
            const target = Float32Array.from([1, 0, 0]);
            const qt = engine.quantizeInt8PerVector(target);

            const orthogonal = engine.quantizeInt8PerVector(Float32Array.from([0, 1, 0]));
            const identical = engine.quantizeInt8PerVector(Float32Array.from([1, 0, 0]));

            const packed = new Int8Array(dims * 2);
            packed.set(orthogonal.vectors, 0);
            packed.set(identical.vectors, dims);
            // A single shared scale is fine here (both rows are unit-magnitude).
            const best = engine.int8Cosine(packed, identical.scale, qt.vectors, qt.scale, dims);
            expect(best).toBeCloseTo(1, 2);
        });

        it('treats a zero-scale operand as a cosine of 0', () => {
            const a = engine.quantizeInt8PerVector(Float32Array.from([0, 0, 0]));
            const b = engine.quantizeInt8PerVector(Float32Array.from([1, 2, 3]));
            expect(engine.int8Cosine(a.vectors, a.scale, b.vectors, b.scale, 3)).toBe(0);
            expect(engine.int8Cosine(b.vectors, b.scale, a.vectors, a.scale, 3)).toBe(0);
        });

        describe('rankInt8 (Increment D §2: search-side top-k cosine ranking)', () => {
            it('ranks packed rows by cosine, top-k descending, matching a float reference', () => {
                const dims = 4;
                // Corpus rows in deliberately scrambled relevance order vs the query.
                const corpus = [
                    Float32Array.from([0, 1, 0, 0]),       // orthogonal → 0
                    Float32Array.from([0.9, 0.1, 0, 0]),   // near the query → high
                    Float32Array.from([1, 0, 0, 0]),       // identical → best
                    Float32Array.from([0.4, 0.6, 0.2, 0]), // middling
                ];
                const query = Float32Array.from([1, 0, 0, 0]);

                const packed = new Int8Array(corpus.length * dims);
                const scales = new Float32Array(corpus.length);
                corpus.forEach((vec, i) => {
                    const { vectors, scale } = engine.quantizeInt8PerVector(vec);
                    packed.set(vectors, i * dims);
                    scales[i] = scale;
                });
                const q = engine.quantizeInt8PerVector(query);

                const ranked = engine.rankInt8(packed, scales, q.vectors, q.scale, dims, 3);

                // Reference float ranking: row 2 (identical) > row 1 (near) > row 3.
                // Row 0 is orthogonal (cosine ~0) → excluded from the top-3.
                expect(ranked.map((r) => r.row)).toEqual([2, 1, 3]);

                // Each returned cosine ≈ the float reference within the int8 tolerance
                // the existing int8Cosine test uses (<0.02).
                for (const { row, cosine } of ranked) {
                    const reference = floatCosine(corpus[row], query);
                    expect(Math.abs(cosine - Math.max(0, reference))).toBeLessThan(0.02);
                }
            });

            it('respects the limit and drops zero-cosine rows', () => {
                const dims = 3;
                const corpus = [
                    Float32Array.from([1, 0, 0]),  // identical
                    Float32Array.from([0, 1, 0]),  // orthogonal → 0, dropped
                    Float32Array.from([0.7, 0.7, 0]),
                ];
                const query = Float32Array.from([1, 0, 0]);
                const packed = new Int8Array(corpus.length * dims);
                const scales = new Float32Array(corpus.length);
                corpus.forEach((vec, i) => {
                    const { vectors, scale } = engine.quantizeInt8PerVector(vec);
                    packed.set(vectors, i * dims);
                    scales[i] = scale;
                });
                const q = engine.quantizeInt8PerVector(query);

                // limit 1 keeps only the best row.
                expect(engine.rankInt8(packed, scales, q.vectors, q.scale, dims, 1).map((r) => r.row)).toEqual([0]);

                // limit 10: the orthogonal row (cosine 0) is excluded, so only 2 survive.
                const all = engine.rankInt8(packed, scales, q.vectors, q.scale, dims, 10);
                expect(all.map((r) => r.row)).toEqual([0, 2]);
            });

            it('returns [] for a zero-scale query or a non-positive limit/dims', () => {
                const dims = 3;
                const corpus = engine.quantizeInt8PerVector(Float32Array.from([1, 0, 0]));
                const q = engine.quantizeInt8PerVector(Float32Array.from([1, 0, 0]));
                expect(engine.rankInt8(corpus.vectors, Float32Array.from([corpus.scale]), q.vectors, 0, dims, 5)).toEqual([]);
                expect(engine.rankInt8(corpus.vectors, Float32Array.from([corpus.scale]), q.vectors, q.scale, dims, 0)).toEqual([]);
                expect(engine.rankInt8(corpus.vectors, Float32Array.from([corpus.scale]), q.vectors, q.scale, 0, 5)).toEqual([]);
            });
        });
    });

    describe('regression: linear-scan throughput budget (absorbed from search-engine.perf.test.ts)', () => {
        it('scans a 2M-char no-match corpus within budget', () => {
            // No matches: early returns would hide the full-scan cost.
            const sections = Array.from({ length: 200 }, (_, i) => ({
                id: `sec-${i}`,
                href: `sec-${i}.xhtml`,
                text: 'abcdefghi '.repeat(1000),
            }));
            engine.initIndex('perf-book');
            engine.addDocuments('perf-book', sections);

            const start = performance.now();
            const results = search(engine, 'perf-book', 'APPLE');
            const duration = performance.now() - start;

            expect(results).toHaveLength(0);
            // Generous CI budget — the old file logged the number and asserted
            // nothing. An indexOf scan of 2M chars sits well under 100ms; a
            // 3s breach means the scan went accidentally quadratic.
            expect(duration).toBeLessThan(3000);
        });
    });
});
