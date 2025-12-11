import { describe, it, expect } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE } from './TextSegmenter';

describe('TextSegmenter - Punctuation Handling', () => {
    // Common abbreviations
    const commonAbbreviations = ['Dr.', 'St.', 'Gov.', 'Capt.', 'Lt.', 'Col.', 'Maj.', 'Rev.', 'Sgt.'];

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
    const segmenter = new TextSegmenter('en', allAbbreviations, DEFAULT_ALWAYS_MERGE);

    describe('General Punctuation Cases', () => {
        it('should handle "Mr." inside parentheses', () => {
            const text = 'I met (Mr. Smith) yesterday.';
            const segments = segmenter.segment(text);
            expect(segments).toHaveLength(1);
            expect(segments[0].text).toBe('I met (Mr. Smith) yesterday.');
        });

        it('should handle "Mrs." inside brackets', () => {
            const text = 'I saw [Mrs. Robinson] today.';
            const segments = segmenter.segment(text);
            expect(segments).toHaveLength(1);
            expect(segments[0].text).toBe('I saw [Mrs. Robinson] today.');
        });

        it('should handle "Ms." inside double quotes', () => {
            const text = 'He called "Ms. Jones" clearly.';
            const segments = segmenter.segment(text);
            expect(segments).toHaveLength(1);
            expect(segments[0].text).toBe('He called "Ms. Jones" clearly.');
        });

        it('should handle "Prof." inside single quotes', () => {
            const text = "It was 'Prof. X' entering.";
            const segments = segmenter.segment(text);
            expect(segments).toHaveLength(1);
            expect(segments[0].text).toBe("It was 'Prof. X' entering.");
        });
    });

    describe('Christian Literature Abbreviations', () => {
        christianAbbreviations.forEach(abbr => {
            it(`should handle "${abbr}" inside parentheses`, () => {
                const text = `Ref (${abbr} 1:1) is valid.`;
                const segments = segmenter.segment(text);
                expect(segments).toHaveLength(1);
                expect(segments[0].text).toBe(text);
            });

            it(`should handle "${abbr}" inside brackets`, () => {
                const text = `See [${abbr} 2:3] for details.`;
                const segments = segmenter.segment(text);
                expect(segments).toHaveLength(1);
                expect(segments[0].text).toBe(text);
            });
        });
    });
});
