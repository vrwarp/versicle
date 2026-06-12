/**
 * Consolidated TextSegmenter spec (Phase 5c-PR2; absorption ledger row 19:
 * 9 files -> 3). The six per-area suites survive below as named
 * `describe('regression: <file stem>')` blocks, verbatim; the fuzz/perf
 * companions stay as TextSegmenter.fuzz.test.ts / TextSegmenter.perf.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS,
    RE_LAST_WORD, RE_LAST_TWO_WORDS, RE_FIRST_WORD, RE_LEADING_PUNCTUATION,
    RE_TRAILING_PUNCTUATION, RE_SENTENCE_FALLBACK, RE_SINGLE_LETTER_OR_ROMAN_NUMERAL,
} from './TextSegmenter';
import type { SentenceNode } from './sentence-extraction';

describe('TextSegmenter', () => {
  it('handles CJK fallback regex', () => {
    // It doesn't use the CJK fallback out of the box because it uses Intl.Segmenter in Node.
    // But let's verify CJK punctuation is handled if we pass Chinese text.
    const segmenter = new TextSegmenter(); // English locale but CJK punctuation handled by Intl.Segmenter
    const chineseText = '你好。世界！这是一个测试？';
    const results = segmenter.segment(chineseText);
    expect(results.length).toBeGreaterThan(1);
  });
  it('segments simple sentences correctly using Intl.Segmenter', () => {
    const segmenter = new TextSegmenter();
    const text = "Hello world. This is a test.";
    const segments = segmenter.segment(text);

    expect(segments).toHaveLength(2);
    // Intl.Segmenter usually includes trailing spaces
    expect(segments[0].text).toBe("Hello world. ");
    expect(segments[1].text).toBe("This is a test.");
  });

  it('splits abbreviations like Mr. Smith in raw segmentation', () => {
    const segmenter = new TextSegmenter('en');
    const text = "Mr. Smith went to Washington.";
    const segments = segmenter.segment(text);

    // Raw segmentation splits at "Mr."
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].text.trim()).toBe("Mr.");
  });

  it('automatically treats single letters as abbreviations and merges them', () => {
    const sentences: SentenceNode[] = [
      { text: "A. ", cfi: "cfi1" },
      { text: "Smith went to Washington.", cfi: "cfi2" }
    ];

    // No abbreviations passed, but "A." should be auto-merged
    const refined = TextSegmenter.refineSegments(sentences, [], [], []);

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("A. Smith went to Washington.");
  });

  it('automatically treats roman numerals (1-9) as abbreviations and merges them', () => {
    const sentences: SentenceNode[] = [
      { text: "Part IV. ", cfi: "cfi1" },
      { text: "The Return.", cfi: "cfi2" }
    ];

    const refined = TextSegmenter.refineSegments(sentences, [], [], []);

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("Part IV. The Return.");
  });

  it('does not merge single letters/roman numerals if followed by a sentence starter', () => {
    const sentences: SentenceNode[] = [
      { text: "He finished Part IV. ", cfi: "cfi1" },
      { text: "Then he rested.", cfi: "cfi2" }
    ];

    // "Then" is a default starter, so it shouldn't merge
    const refined = TextSegmenter.refineSegments(sentences, [], [], DEFAULT_SENTENCE_STARTERS);

    expect(refined).toHaveLength(2);
    expect(refined[0].text).toBe("He finished Part IV. ");
    expect(refined[1].text).toBe("Then he rested.");
  });

  it('can refine abbreviations via refineSegments', () => {
    // Construct sentences simulating raw split (space attached to first segment)
    const sentences: SentenceNode[] = [
      { text: "Mr. ", cfi: "cfi1" },
      { text: "Smith went to Washington.", cfi: "cfi2" }
    ];

    const refined = TextSegmenter.refineSegments(
      sentences,
      ['Mr.'],
      DEFAULT_ALWAYS_MERGE,
      DEFAULT_SENTENCE_STARTERS
    );

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("Mr. Smith went to Washington.");
  });

  it('handles empty input', () => {
    const segmenter = new TextSegmenter();
    expect(segmenter.segment("")).toHaveLength(0);
  });

  describe('Fallback behavior', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let originalSegmenter: any;

      beforeEach(() => {
          originalSegmenter = Intl.Segmenter;
          // @ts-expect-error - Mocking Intl.Segmenter
          Intl.Segmenter = undefined;
      });

      afterEach(() => {
          (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = originalSegmenter;
      });

      it('segments using fallback regex when Intl.Segmenter is missing', () => {
          const segmenter = new TextSegmenter();

          const text = "Hello world. This is a test.";
          const segments = segmenter.segment(text);

          expect(segments).toHaveLength(2);
          // Fallback logic splits differently regarding whitespace
          expect(segments[0].text).toBe("Hello world.");
          expect(segments[1].text).toBe(" This is a test.");
      });

      it('fails on Mr. Smith with fallback regex', () => {
          const segmenter = new TextSegmenter();
          const text = "Mr. Smith went to Washington.";
          const segments = segmenter.segment(text);

          // Regex will split at "Mr."
          expect(segments.length).toBeGreaterThan(1);
          expect(segments[0].text).toBe("Mr.");
      });
  });

  describe('Manual Scanning Helpers (via refineSegments)', () => {
      it('handles Unicode whitespace correctly', () => {
          // "Mr." followed by Em Space (U+2003) and "Smith"
          const sentences: SentenceNode[] = [
              { text: "Hello Mr.\u2003", cfi: "1" },
              { text: "Smith went.", cfi: "2" }
          ];
          const abbreviations = ['Mr.'];
          const refined = TextSegmenter.refineSegments(
              sentences,
              abbreviations,
              [],
              []
          );

          // Should be merged because "Mr." is identified correctly despite Em Space
          expect(refined).toHaveLength(1);
          expect(refined[0].text).toContain("Mr.\u2003 Smith");
      });
  });

  describe('Merging Reliability', () => {
    it('should not add a leading dot when merging into a whitespace-only segment', () => {
        // Simulating a case where the first segment is just whitespace or empty
        // which might happen with some PDF text extractions or weird formatting
        const segments = [
            { text: '   ', cfi: 'cfi1', index: 0, length: 3 },
            { text: 'Hello world.', cfi: 'cfi2', index: 3, length: 12 }
        ];

        // Using mergeByLength with a minLength > 3 to force merge
        const merged = TextSegmenter.mergeByLength(segments, 10);

        expect(merged.length).toBe(1);
        expect(merged[0].text.trim()).toBe('Hello world.');
        expect(merged[0].text).not.toContain('. Hello');
    });

    it('should handle empty first segment gracefully', () => {
        const segments = [
            { text: '', cfi: 'cfi1', index: 0, length: 0 },
            { text: 'Start.', cfi: 'cfi2', index: 0, length: 6 }
        ];

        const merged = TextSegmenter.mergeByLength(segments, 5);
        expect(merged.length).toBe(1);
        expect(merged[0].text).toBe('Start.');
    });
  });

  describe('regression: NFKD normalization must not shift raw-text offsets (CFI drift on non-ASCII books)', () => {
    // segment() used to NFKD-normalize its input and return indices into the
    // normalized string. Every decomposable character (é → e+◌́, ﬁ → fi) before a
    // sentence start shifted the offsets that extractSentencesFromNode maps back
    // onto raw DOM text nodes, corrupting the persisted CFIs. The contract is:
    // index/length address the RAW input; only the outbound text is NFKD-normalized.
    const segmentAndCheckRoundTrip = (text: string) => {
      const segmenter = new TextSegmenter();
      const segments = segmenter.segment(text);
      for (const s of segments) {
        const rawSlice = text.slice(s.index, s.index + s.length);
        expect(s.text).toBe(rawSlice.normalize('NFKD'));
      }
      return segments;
    };

    it('keeps raw indices when precomposed accents (NFC é, à) precede a sentence', () => {
      const text = 'Le café est bon. Voilà le chat. Fin.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(3);
      // Pre-fix, NFKD lengthened "café"/"Voilà" so these indices were 1 and 2
      // characters too far right (18 and 34 instead of 17 and 32).
      expect(segments[1].index).toBe(text.indexOf('Voilà'));
      expect(segments[2].index).toBe(text.indexOf('Fin.'));
      expect(text.slice(segments[2].index, segments[2].index + segments[2].length)).toBe('Fin.');
    });

    it('keeps raw indices with combining-mark accents (e + U+0301)', () => {
      const text = 'Le cafe\u0301 est bon. Fin.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(2);
      expect(segments[1].index).toBe(text.indexOf('Fin.'));
    });

    it('keeps raw indices across ligatures (ﬁ) while still decomposing outbound text', () => {
      const text = 'The ﬁrst rule. The second rule.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(2);
      expect(segments[1].index).toBe(text.indexOf('The second'));
      expect(text.slice(segments[1].index, segments[1].index + segments[1].length)).toBe('The second rule.');
      // Outbound text is still NFKD-normalized: the ligature decomposes.
      expect(segments[0].text).toContain('first');
    });

    it('keeps raw indices for CJK text', () => {
      const text = '你好。世界！这是一个测试？';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments.length).toBeGreaterThan(1);
      expect(text.slice(segments[1].index, segments[1].index + segments[1].length)).toBe('世界！');
    });

    it('still normalizes the outbound segment text (nbsp → space)', () => {
      const text = 'Word1 Word2.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Word1 Word2.');
      // nbsp is length-preserving under NFKD, so raw length still matches.
      expect(segments[0].length).toBe(text.length);
    });

    describe('fallback regex path', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let originalSegmenter: any;

      beforeEach(() => {
          originalSegmenter = Intl.Segmenter;
          // @ts-expect-error - Mocking Intl.Segmenter
          Intl.Segmenter = undefined;
      });

      afterEach(() => {
          (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = originalSegmenter;
      });

      it('keeps raw indices and normalizes outbound text', () => {
          const segmenter = new TextSegmenter();
          const text = 'Le café est bon. Fin.';
          const segments = segmenter.segment(text);

          expect(segments).toHaveLength(2);
          for (const s of segments) {
              const rawSlice = text.slice(s.index, s.index + s.length);
              expect(s.text).toBe(rawSlice.normalize('NFKD'));
          }
          expect(segments[1].index).toBe(text.indexOf(' Fin.'));
      });
    });
  });
});

describe('regression: TextSegmenter.configurable', () => {
    describe('TextSegmenter with Custom Abbreviations', () => {
      const createSentences = (text: string): SentenceNode[] => {
          const segmenter = new TextSegmenter();
          return segmenter.segment(text).map(s => ({ text: s.text, cfi: 'cfi' }));
      };

      it('merges segments when abbreviation is provided via refineSegments', () => {
        // "MyAbbrev." is definitely not standard.
        const text = "This is MyAbbrev. Smith is here.";

        const raw = createSentences(text);

        // If it splits:
        if (raw.length > 1) {
            // Now test with custom abbrev
            const refined = TextSegmenter.refineSegments(
                raw,
                ['MyAbbrev.'],
                [], // alwaysMerge
                [] // sentenceStarters
            );

            expect(refined).toHaveLength(1);
            expect(refined[0].text).toBe("This is MyAbbrev. Smith is here.");
        }
      });

      it('respects passed abbreviations in refineSegments', () => {
          const text = "Dr. No is a movie.";
          const raw = createSentences(text);

          const refined = TextSegmenter.refineSegments(
              raw,
              ['Dr.', 'Prof.'],
              [],
              [] // Empty sentenceStarters ensures 'No' doesn't block merge
          );

          expect(refined).toHaveLength(1);
          expect(refined[0].text).toBe("Dr. No is a movie.");
      });

      it('disables sentence starter heuristic when empty list passed to refineSegments', () => {
          // By default "Dr." + "He" splits because "He" is a starter.
          // If we pass empty sentenceStarters, it should merge (because "Dr." is an abbreviation).
          const text = "I visited the Dr. He was nice.";
          const raw = createSentences(text);

          const refined = TextSegmenter.refineSegments(
              raw,
              ['Dr.'],
              [],
              [] // Empty starters -> always merge if abbreviation found
          );

          expect(refined).toHaveLength(1);
          expect(refined[0].text.trim()).toBe("I visited the Dr. He was nice.");
      });
    });
});


describe('regression: TextSegmenter.merge', () => {
    describe('TextSegmenter.mergeByLength', () => {
        const createNode = (text: string, cfi: string = ''): SentenceNode => ({
            text,
            cfi,
            index: 0,
            length: text.length
        } as SentenceNode);

        it('should return empty list for empty input', () => {
            expect(TextSegmenter.mergeByLength([], 10)).toEqual([]);
        });

        it('should return original list if all sentences are long enough', () => {
            const sentences = [
                createNode('This is a sufficiently long sentence.'),
                createNode('This is another long sentence.')
            ];
            expect(TextSegmenter.mergeByLength(sentences, 10)).toHaveLength(2);
            expect(TextSegmenter.mergeByLength(sentences, 10)[0].text).toBe(sentences[0].text);
        });

        it('should merge short sentence into next one', () => {
            const sentences = [
                createNode('Hi.'),
                createNode('This is a longer sentence.')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Hi. This is a longer sentence.');
        });

        it('should merge multiple consecutive short sentences', () => {
            const sentences = [
                createNode('A.'),
                createNode('B.'),
                createNode('C.'),
                createNode('Longer end sentence.')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('A. B. C. Longer end sentence.');
        });

        it('should push buffer if it accumulates enough length', () => {
            const sentences = [
                createNode('One.'),
                createNode('Two.'),
                createNode('Three four five.'), // 16 chars
                createNode('Six.')
            ];
            // Expected Logic:
            // 1. "One." (len 4) -> Buffer
            // 2. "One. Two." (len 9) < 10 -> Buffer
            // 3. "One. Two. Three four five." (len 25) >= 10 -> Push to results
            // 4. "Six." (len 4) < 10 -> Buffer
            // End: "Six." is too short, so it merges backward into the last result.
            // Final Result: "One. Two. Three four five. Six."

            const result = TextSegmenter.mergeByLength(sentences, 10);

            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('One. Two. Three four five. Six.');
        });

         it('should handle middle merges correctly', () => {
            const sentences = [
                createNode('First long sentence.'),
                createNode('Short.'),
                createNode('Second long sentence.')
            ];
            // Expected Logic:
            // 1. "First long sentence." (len > 10) -> Push to results
            // 2. "Short." (len < 10) -> Buffer
            // 3. "Short. Second long sentence." (len > 10) -> Push to results

            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(2);
            expect(result[0].text).toBe('First long sentence.');
            expect(result[1].text).toBe('Short. Second long sentence.');
        });

        it('should merge last trailing short sentence backward', () => {
            const sentences = [
                createNode('This is a long sentence.'),
                createNode('Short.')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('This is a long sentence. Short.');
        });

        it('should return the short sentence if it is the only one', () => {
            const sentences = [createNode('Hi.')];
            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Hi.');
        });

        it('should insert a period when merging segments without punctuation', () => {
            const sentences = [
                createNode('Title'),
                createNode('Subtitle')
            ];
            // minLength 100 to force merge
            const result = TextSegmenter.mergeByLength(sentences, 100);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Title. Subtitle');
        });

        it('should not insert double periods if punctuation exists', () => {
            const sentences = [
                createNode('Title.'),
                createNode('Subtitle')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 100);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Title. Subtitle');
        });

        it('should respect other punctuation', () => {
            const sentences = [
                createNode('Title!'),
                createNode('Subtitle')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 100);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Title! Subtitle');
        });

        it('should insert period in backward merge if missing', () => {
            const sentences = [
                createNode('Long sentence here'), // No period
                createNode('Short')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 10);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Long sentence here. Short');
        });

        it('should handle chain of merges with periods', () => {
            const sentences = [
                createNode('A'),
                createNode('B'),
                createNode('C')
            ];
            const result = TextSegmenter.mergeByLength(sentences, 100);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('A. B. C');
        });
    });
});


describe('regression: TextSegmenter.punctuation', () => {
    describe('TextSegmenter - Punctuation Handling', () => {
        // Common abbreviations
        const commonAbbreviations = ['Dr.', 'St.', 'Gov.', 'Capt.', 'Lt.', 'Col.', 'Maj.', 'Rev.', 'Sgt.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.'];

        // Christian literature abbreviations (Bible books, titles, etc.)
        const christianAbbreviations = [
            // Old Testament
            'Gen.', 'Ex.', 'Lev.', 'Num.', 'Deut.', 'Josh.', 'Judg.', 'Sam.', 'Kgs.', 'Chron.', 'Ezr.', 'Neh.', 'Esth.', 'Ps.', 'Prov.', 'Eccl.', 'Isa.', 'Jer.', 'Lam.', 'Ezek.', 'Dan.', 'Hos.', 'Obad.', 'Jon.', 'Mic.', 'Nah.', 'Hab.', 'Zeph.', 'Hag.', 'Zech.', 'Mal.',
            // New Testament
            'Matt.', 'Mk.', 'Lk.', 'Jn.', 'Rom.', 'Cor.', 'Gal.', 'Eph.', 'Phil.', 'Col.', 'Thess.', 'Tim.', 'Tit.', 'Phlm.', 'Heb.', 'Jas.', 'Pet.', 'Rev.',
            // Titles & Others
            'Fr.', 'Sr.', 'Br.', 'Bro.', 'Sis.', 'Eld.', 'Dcn.', 'Bp.', 'Abp.', 'Card.', 'v.', 'vv.', 'ch.'
        ];

        const allAbbreviations = [...commonAbbreviations, ...christianAbbreviations];

        // Helper to simulate raw segmentation
        const createSentences = (text: string): SentenceNode[] => {
            const segmenter = new TextSegmenter();
            return segmenter.segment(text).map(s => ({ text: s.text, cfi: 'cfi' }));
        };

        const refine = (text: string) => {
            const raw = createSentences(text);
            return TextSegmenter.refineSegments(raw, allAbbreviations, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS);
        };

        describe('General Punctuation Cases', () => {
            it('should handle "Mr." inside parentheses', () => {
                const text = 'I met (Mr. Smith) yesterday.';
                const refined = refine(text);
                expect(refined).toHaveLength(1);
                expect(refined[0].text).toBe('I met (Mr. Smith) yesterday.');
            });

            it('should handle "Mrs." inside brackets', () => {
                const text = 'I saw [Mrs. Robinson] today.';
                const refined = refine(text);
                expect(refined).toHaveLength(1);
                expect(refined[0].text).toBe('I saw [Mrs. Robinson] today.');
            });

            it('should handle "Ms." inside double quotes', () => {
                const text = 'He called "Ms. Jones" clearly.';
                const refined = refine(text);
                expect(refined).toHaveLength(1);
                expect(refined[0].text).toBe('He called "Ms. Jones" clearly.');
            });

            it('should handle "Prof." inside single quotes', () => {
                const text = "It was 'Prof. X' entering.";
                const refined = refine(text);
                expect(refined).toHaveLength(1);
                expect(refined[0].text).toBe("It was 'Prof. X' entering.");
            });
        });

        describe('Christian Literature Abbreviations', () => {
            christianAbbreviations.forEach(abbr => {
                it(`should handle "${abbr}" inside parentheses`, () => {
                    const text = `Ref (${abbr} 1:1) is valid.`;
                    const refined = refine(text);
                    expect(refined).toHaveLength(1);
                    expect(refined[0].text).toBe(text);
                });

                it(`should handle "${abbr}" inside brackets`, () => {
                    const text = `See [${abbr} 2:3] for details.`;
                    const refined = refine(text);
                    expect(refined).toHaveLength(1);
                    expect(refined[0].text).toBe(text);
                });
            });
        });
    });
});


describe('regression: TextSegmenter.refine', () => {
    describe('TextSegmenter.refineSegments', () => {
        it('should merge segments based on abbreviations', () => {
            const sentences: SentenceNode[] = [
                { text: 'Mr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
                { text: 'Smith goes to Washington.', cfi: 'epubcfi(/6/2!/4/1,:3,:28)' }
            ];

            const abbreviations = ['Mr.'];
            const alwaysMerge: string[] = [];
            const sentenceStarters: string[] = [];

            const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

            expect(refined).toHaveLength(1);
            expect(refined[0].text).toBe('Mr. Smith goes to Washington.');
            // Expected CFI logic:
            // rawStart: /6/2!/4/1:0
            // rawEnd: /6/2!/4/1:28
            // common: /6/2!/4/1
            // result: epubcfi(/6/2!/4/1,:0,:28)
            expect(refined[0].cfi).toBe('epubcfi(/6/2!/4/1,:0,:28)');
        });

        it('should NOT merge if abbreviation is not in list', () => {
            const sentences: SentenceNode[] = [
                { text: 'Mr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
                { text: 'Smith.', cfi: 'epubcfi(/6/2!/4/1,:3,:9)' }
            ];

            const abbreviations: string[] = []; // Empty
            const refined = TextSegmenter.refineSegments(sentences, abbreviations, [], []);

            expect(refined).toHaveLength(2);
        });

        it('should merge if alwaysMerge is set, even if next word is a starter', () => {
            const sentences: SentenceNode[] = [
                { text: 'Prof.', cfi: 'epubcfi(/6/2!/4/1,:0,:5)' },
                { text: 'He is smart.', cfi: 'epubcfi(/6/2!/4/1,:5,:17)' }
            ];

            // "He" is a sentence starter.
            const abbreviations = ['Prof.'];
            const alwaysMerge = ['Prof.'];
            const sentenceStarters = ['He'];

            const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

            expect(refined).toHaveLength(1);
            expect(refined[0].text).toBe('Prof. He is smart.');
            expect(refined[0].cfi).toBe('epubcfi(/6/2!/4/1,:0,:17)');
        });

        it('should NOT merge if next word is a starter and NOT alwaysMerge', () => {
            const sentences: SentenceNode[] = [
                { text: 'Dr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
                { text: 'He is smart.', cfi: 'epubcfi(/6/2!/4/1,:3,:15)' }
            ];

            const abbreviations = ['Dr.'];
            const alwaysMerge: string[] = [];
            const sentenceStarters = ['He'];

            const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

            expect(refined).toHaveLength(2);
        });

        it('should handle merging across different elements (complex CFI)', () => {
            // This is a harder case where parents might be different or path is different.
            // refineSegments falls back to generateCfiRange(last.cfi, current.cfi)
            // Let's assume they share some common root.

            // Sent A: /6/2!/4/1:10 to /6/2!/4/1:20
            // Sent B: /6/2!/4/2:0 to /6/2!/4/2:10 (Next paragraph)
            const sentences: SentenceNode[] = [
                 { text: 'Part 1.', cfi: 'epubcfi(/6/2!/4/1,:10,:20)' },
                 { text: 'Part 2.', cfi: 'epubcfi(/6/2!/4/2,:0,:10)' }
            ];

            // Force merge
            const abbreviations = ['Part 1.']; // Weird abbr but ok for test
            const alwaysMerge = ['Part 1.'];

            const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, []);

            expect(refined).toHaveLength(1);
            expect(refined[0].text).toBe('Part 1. Part 2.');

            // start: /6/2!/4/1:10
            // end: /6/2!/4/2:10
            // common: /6/2!/4 (split at slash)
            // startRel: /1:10
            // endRel: /2:10
            // Expected: epubcfi(/6/2!/4,/1:10,/2:10)
            expect(refined[0].cfi).toBe('epubcfi(/6/2!/4,/1:10,/2:10)');
        });
    });
});


describe('regression: TextSegmenter.regex', () => {
    describe('TextSegmenter Regexes', () => {
        describe('RE_SINGLE_LETTER_OR_ROMAN_NUMERAL', () => {
            it('matches single letters with periods', () => {
                expect('A.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('A.');
                expect('z.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('z.');
                expect('M.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('M.');
                expect('Some M.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('M.');
            });

            it('matches roman numerals (1-9) with periods', () => {
                expect('I.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('I.');
                expect('III.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('III.');
                expect('IV.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('IV.');
                expect('V.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('V.');
                expect('VI.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('VI.');
                expect('IX.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('IX.');
                expect('ix.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('ix.');
                expect('Chapter IV.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0].trim()).toBe('IV.');
            });

            it('does not match non-roman words or numbers without periods correctly', () => {
                expect('cat.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)).toBeNull();
                expect('XI.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)).toBeNull();
                expect('XII.'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)).toBeNull();
                expect('A'.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)).toBeNull();
            });

            it('handles trailing whitespace', () => {
                expect('A. '.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0]).toBe('A. ');
                expect('IV.   '.match(RE_SINGLE_LETTER_OR_ROMAN_NUMERAL)?.[0]).toBe('IV.   ');
            });
        });

        describe('RE_LAST_WORD', () => {
            it('matches the last word in a string', () => {
                expect('Hello World'.match(RE_LAST_WORD)?.[0]).toBe('World');
                expect('Testing...'.match(RE_LAST_WORD)?.[0]).toBe('Testing...');
            });

            it('handles single word strings', () => {
                expect('Word'.match(RE_LAST_WORD)?.[0]).toBe('Word');
            });

            it('does not match trailing whitespace', () => {
                // Because \S+ must be at the end ($), this will fail if there is trailing whitespace
                // The code trims before using this regex, so this behavior is expected.
                expect('Trailing '.match(RE_LAST_WORD)).toBeNull();
            });
        });

        describe('RE_LAST_TWO_WORDS', () => {
            it('matches the last two words separated by whitespace', () => {
                expect('Hello World'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('Hello World');
                expect('one two three'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('two three');
            });

            it('handles punctuation', () => {
                expect('et al.'.match(RE_LAST_TWO_WORDS)?.[0]).toBe('et al.');
            });

            it('does not match single words', () => {
                expect('Hello'.match(RE_LAST_TWO_WORDS)).toBeNull();
            });

            it('requires whitespace separation', () => {
                expect('HelloStart'.match(RE_LAST_TWO_WORDS)).toBeNull();
            });
        });

        describe('RE_FIRST_WORD', () => {
            it('matches the first word', () => {
                expect('Hello World'.match(RE_FIRST_WORD)?.[0]).toBe('Hello');
            });

            it('matches punctuation at start', () => {
                expect('"Quote" start'.match(RE_FIRST_WORD)?.[0]).toBe('"Quote"');
            });

            it('does not match leading whitespace', () => {
                 // ^\S+ requires start with non-whitespace.
                 // Code trims before use.
                 expect(' Start'.match(RE_FIRST_WORD)).toBeNull();
            });
        });

        describe('RE_LEADING_PUNCTUATION', () => {
            it('matches leading quotes', () => {
                expect('"Hello'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('"');
                expect("'Hello".match(RE_LEADING_PUNCTUATION)?.[0]).toBe("'");
            });

            it('matches brackets', () => {
                expect('(Parenthesis'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('(');
                expect('[Bracket'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('[');
            });

            it('matches multiple punctuation marks', () => {
                expect('"(Hello'.match(RE_LEADING_PUNCTUATION)?.[0]).toBe('"(');
            });

            it('does not match letters', () => {
                expect('Hello'.match(RE_LEADING_PUNCTUATION)).toBeNull();
            });
        });

        describe('RE_TRAILING_PUNCTUATION', () => {
            it('matches trailing period', () => {
                expect('End.'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('.');
            });

            it('matches trailing question mark', () => {
                expect('Why?'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('?');
            });

            it('matches trailing exclamation point', () => {
                expect('Yes!'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('!');
            });

            it('matches trailing colon and semicolon', () => {
                expect('List:'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(':');
                expect('Wait;'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(';');
            });

            it('matches comma', () => {
                expect('Wait,'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe(',');
            });

            it('does not match multiple trailing punctuation (only the last one)', () => {
                // Regex is /[.,!?;:]$/ which matches exactly one character
                expect('Really?!'.match(RE_TRAILING_PUNCTUATION)?.[0]).toBe('!');
            });
        });

        describe('RE_SENTENCE_FALLBACK', () => {
            it('splits text into sentences based on punctuation', () => {
                const text = 'Hello world. How are you? I am fine!';
                const matches = text.match(RE_SENTENCE_FALLBACK);
                expect(matches).toEqual(['Hello world.', ' How are you?', ' I am fine!']);
            });

            it('handles no punctuation at end', () => {
                // The regex captures "([^.!?]+[.!?]+)"
                // It won't capture the trailing text if it lacks punctuation.
                // The fallbackSegment method handles the remainder logic separately.
                const text = 'Hello world. Incomplete';
                const matches = text.match(RE_SENTENCE_FALLBACK);
                expect(matches).toEqual(['Hello world.']);
            });

            it('handles multiple punctuation marks', () => {
                const text = 'Really?! Yes.';
                const matches = text.match(RE_SENTENCE_FALLBACK);
                expect(matches).toEqual(['Really?!', ' Yes.']);
            });
        });
    });
});


describe('regression: TextSegmenter.regression', () => {
    describe('TextSegmenter Regression Tests', () => {
        // Helper to simulate raw segmentation
        const createSentences = (text: string): SentenceNode[] => {
            const segmenter = new TextSegmenter();
            return segmenter.segment(text).map(s => ({ text: s.text, cfi: 'cfi' }));
        };

        it('does NOT merge distinct sentences ending in an ambiguous abbreviation (Dr.)', () => {
            const text = "I visited the Dr. He was nice.";
            const raw = createSentences(text);

            const refined = TextSegmenter.refineSegments(
                raw,
                ['Dr.'],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );

            // "He" is a sentence starter, so it should split (or remain split).
            expect(refined).toHaveLength(2);
            expect(refined[0].text.trim()).toBe("I visited the Dr.");
            expect(refined[1].text.trim()).toBe("He was nice.");
        });

        it('merges sentences when abbreviation is followed by a proper noun', () => {
            const text = "I saw Dr. Smith.";
            // Ensure raw splits it first (Intl.Segmenter might handle Dr., but let's assume it doesn't or force it if needed)
            // If raw has 1 segment, this test is trivial.
            const raw = createSentences(text);

            const refined = TextSegmenter.refineSegments(
                raw,
                ['Dr.'],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );

            // "Smith" is NOT a sentence starter, so it should merge.
            expect(refined).toHaveLength(1);
            expect(refined[0].text.trim()).toBe("I saw Dr. Smith.");
        });

        it('always merges known titles (Mr.) regardless of next word', () => {
            const text = "Mr. He was there.";
            const raw = createSentences(text);

            const refined = TextSegmenter.refineSegments(
                raw,
                ['Mr.'],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );

            expect(refined).toHaveLength(1);
            expect(refined[0].text.trim()).toBe("Mr. He was there.");
        });

        it('does NOT merge custom abbreviation if followed by sentence starter', () => {
            const text = "This is MyAbbrev. It works.";
            const raw = createSentences(text);

            const refined = TextSegmenter.refineSegments(
                raw,
                ['MyAbbrev.'],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );

            // "It" is starter. Split.
            expect(refined).toHaveLength(2);
            expect(refined[0].text.trim()).toBe("This is MyAbbrev.");
            expect(refined[1].text.trim()).toBe("It works.");
        });

        it('handles contractions correctly', () => {
            const text = "I visited the Dr. It's time to go.";
            const raw = createSentences(text);

            const refined = TextSegmenter.refineSegments(
                raw,
                ['Dr.'],
                DEFAULT_ALWAYS_MERGE,
                DEFAULT_SENTENCE_STARTERS
            );

            // "It's" is starter. Split.
            expect(refined).toHaveLength(2);
            expect(refined[0].text.trim()).toBe("I visited the Dr.");
            expect(refined[1].text.trim()).toBe("It's time to go.");
        });
    });
});
