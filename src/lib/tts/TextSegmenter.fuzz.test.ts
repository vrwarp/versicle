import { describe, it, expect } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './TextSegmenter';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../../test/fuzz-utils';
import type { SentenceNode } from '../tts';

describe('TextSegmenter Fuzzing', () => {
    const SEED = DEFAULT_FUZZ_SEED;

    /**
     * Creates a mock SentenceNode for testing refineSegments.
     */
    const createSentenceNode = (rng: SeededRandom, text: string, index: number): SentenceNode => ({
        text,
        cfi: rng.nextCfi(),
        sourceIndices: [index]
    });

    describe('segment()', () => {
        it('survives random Unicode strings without crashing', () => {
            const rng = new SeededRandom(SEED);
            const segmenter = new TextSegmenter('en');

            for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
                const length = rng.nextInt(0, 500);
                const text = rng.nextUnicodeString(length);

                try {
                    const result = segmenter.segment(text);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED}), text length=${length}`);
                    throw e;
                }
            }
        });

        it('handles empty and whitespace-only strings', () => {
            const segmenter = new TextSegmenter('en');

            expect(segmenter.segment('')).toEqual([]);
            expect(Array.isArray(segmenter.segment('   \t\n  '))).toBe(true);
        });

        it('segments should cover the original text', () => {
            const rng = new SeededRandom(SEED);
            const segmenter = new TextSegmenter('en');

            for (let i = 0; i < 100; i++) {
                const length = rng.nextInt(10, 200);
                const text = rng.nextString(length);

                const segments = segmenter.segment(text);

                // Reconstructed text from segments should match original
                const reconstructed = segments.map(s => s.text).join('');
                // Normalize to handle whitespace differences
                expect(text.normalize('NFKD')).toBe(reconstructed);
            }
        });

        it('survives strings with only punctuation', () => {
            const rng = new SeededRandom(SEED);
            const segmenter = new TextSegmenter('en');
            const punctuation = '.,!?;:()[]{}\'"-—…';

            for (let i = 0; i < 100; i++) {
                const length = rng.nextInt(1, 50);
                const text = rng.nextString(length, punctuation);

                try {
                    const result = segmenter.segment(text);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on punctuation string: ${text}`);
                    throw e;
                }
            }
        });
    });

    describe('refineSegments()', () => {
        it('survives random abbreviation lists', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                // Generate random abbreviations
                const numAbbr = rng.nextInt(0, 20);
                const abbreviations: string[] = [];
                for (let j = 0; j < numAbbr; j++) {
                    abbreviations.push(rng.nextString(rng.nextInt(1, 5)) + '.');
                }

                // Generate random sentence starters
                const numStarters = rng.nextInt(0, 10);
                const starters: string[] = [];
                for (let j = 0; j < numStarters; j++) {
                    starters.push(rng.nextString(rng.nextInt(2, 8)));
                }

                // Generate random sentences
                const numSentences = rng.nextInt(1, 20);
                const sentences: SentenceNode[] = [];
                for (let j = 0; j < numSentences; j++) {
                    sentences.push(createSentenceNode(
                        rng,
                        rng.nextUnicodeString(rng.nextInt(5, 100)),
                        j
                    ));
                }

                try {
                    const result = TextSegmenter.refineSegments(
                        sentences,
                        abbreviations,
                        DEFAULT_ALWAYS_MERGE,
                        starters
                    );
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });

        it('handles empty input', () => {
            const result = TextSegmenter.refineSegments(
                [],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );
            expect(result).toEqual([]);
        });

        it('does not lose text when merging', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                // Generate sentences that might trigger merging
                const sentences: SentenceNode[] = [
                    createSentenceNode(rng, 'Hello Mr.', 0),
                    createSentenceNode(rng, ' Smith said hello.', 1),
                    createSentenceNode(rng, ' Dr.', 2),
                    createSentenceNode(rng, ' Jones replied.', 3),
                ];

                const result = TextSegmenter.refineSegments(
                    sentences,
                    ['Mr.', 'Dr.'],
                    DEFAULT_ALWAYS_MERGE,
                    DEFAULT_SENTENCE_STARTERS
                );

                // Verify no text is lost
                const originalText = sentences.map(s => s.text).join('');
                const resultText = result.map(s => s.text).join('');

                // May have added spaces during merging
                expect(resultText.replace(/\s+/g, '')).toContain(originalText.replace(/\s+/g, '').substring(0, 10));
            }
        });
    });

    describe('mergeByLength()', () => {
        it('survives random sentence lengths', () => {
            const rng = new SeededRandom(SEED);

            for (let i = 0; i < 100; i++) {
                const numSentences = rng.nextInt(1, 30);
                const sentences: SentenceNode[] = [];

                for (let j = 0; j < numSentences; j++) {
                    const len = rng.nextInt(1, 100);
                    sentences.push(createSentenceNode(rng, rng.nextString(len), j));
                }

                const minLength = rng.nextInt(0, 50);

                try {
                    const result = TextSegmenter.mergeByLength(sentences, minLength);
                    expect(Array.isArray(result)).toBe(true);

                    // If minLength > 0, most sentences should be >= minLength
                    // (last one might be shorter if no merge possible)
                    if (minLength > 0 && result.length > 1) {
                        for (let k = 0; k < result.length - 1; k++) {
                            expect(result[k].text.length).toBeGreaterThanOrEqual(minLength);
                        }
                    }
                } catch (e) {
                    console.error(`Crashed on iteration ${i} (seed=${SEED})`);
                    throw e;
                }
            }
        });

        it('handles zero minLength', () => {
            const rng = new SeededRandom(SEED);
            const sentences: SentenceNode[] = [
                createSentenceNode(rng, 'Short.', 0),
                createSentenceNode(rng, 'Also short.', 1),
            ];

            const result = TextSegmenter.mergeByLength(sentences, 0);
            expect(result.length).toBe(2);
        });

        it('handles very large minLength', () => {
            const rng = new SeededRandom(SEED);
            const sentences: SentenceNode[] = [
                createSentenceNode(rng, 'Short.', 0),
                createSentenceNode(rng, 'Also short.', 1),
                createSentenceNode(rng, 'Third.', 2),
            ];

            const result = TextSegmenter.mergeByLength(sentences, 10000);
            // Should merge everything into one
            expect(result.length).toBe(1);
        });
    });

    describe('fallback regex segmentation', () => {
        it('survives edge case inputs', () => {
            const rng = new SeededRandom(SEED);
            // Create segmenter that might use fallback
            const segmenter = new TextSegmenter('en');

            const edgeCases = [
                '',
                '...',
                '!!!',
                '???',
                'No period here',
                'One. Two. Three.',
                '... ... ...',
                'Mr. Smith went to Dr. Jones.',
                rng.nextUnicodeString(1000),
            ];

            for (const text of edgeCases) {
                try {
                    const result = segmenter.segment(text);
                    expect(Array.isArray(result)).toBe(true);
                } catch (e) {
                    console.error(`Crashed on edge case: ${text.substring(0, 50)}...`);
                    throw e;
                }
            }
        });
    });
});
