import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { extractSentencesFromNode } from '../tts';
import type { SentenceNode } from '../tts';

/**
 * Integration test: Loads the real "Book of Citations - Gemini.epub" and runs
 * the full TTS extraction pipeline on all three HTML chapters.
 *
 * Chapter 1: Uses <sup><a id="aaN" href="#bbN">N</a></sup> inline citations
 *            and a footnotes section at the bottom with back-links.
 *
 * Chapter 2: Uses <a href="...Notes.xhtml#EndnoteN"><span class="_Endnote-Reference">N</span></a>
 *            with empty <span class="_Endnote-Reference"/> anchor placeholders.
 *
 * Chapter 3: Uses <sup><a href="16_notes.xhtml#chapter3-N" role="doc-noteref">N</a></sup>
 *            with external note file references.
 */
describe('Citation Skipping – Book of Citations EPUB', () => {
    // Per-chapter sentence arrays + combined text
    let ch1Sentences: SentenceNode[];
    let ch2Sentences: SentenceNode[];
    let ch3Sentences: SentenceNode[];
    let ch1Text: string;
    let ch2Text: string;
    let ch3Text: string;

    beforeAll(async () => {
        const fixturePath = path.resolve(
            __dirname,
            '../../../public/books/Book of Citations - Gemini.epub',
        );
        const buffer = fs.readFileSync(fixturePath);
        const zip = await JSZip.loadAsync(buffer);

        const loadChapter = async (filename: string): Promise<SentenceNode[]> => {
            const file = zip.file(filename);
            if (!file) throw new Error(`${filename} not found in EPUB`);
            const html = await file.async('string');
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return extractSentencesFromNode(
                doc.body,
                () => 'cfi',
                { sanitizationEnabled: true },
            );
        };

        ch1Sentences = await loadChapter('text/chapter1.html');
        ch2Sentences = await loadChapter('text/chapter2.html');
        ch3Sentences = await loadChapter('text/chapter3.html');

        ch1Text = ch1Sentences.map(s => s.text).join(' ');
        ch2Text = ch2Sentences.map(s => s.text).join(' ');
        ch3Text = ch3Sentences.map(s => s.text).join(' ');
    }, 15000);

    // ═══════════════════════════════════════════════════════════════════════
    //  BASIC SANITY
    // ═══════════════════════════════════════════════════════════════════════

    describe('basic sanity', () => {
        it('should extract a non-trivial amount of text from chapter 1', () => {
            expect(ch1Sentences.length).toBeGreaterThan(50);
            expect(ch1Text.length).toBeGreaterThan(5000);
        });

        it('should extract a non-trivial amount of text from chapter 2', () => {
            expect(ch2Sentences.length).toBeGreaterThan(20);
            expect(ch2Text.length).toBeGreaterThan(2000);
        });

        it('should extract a non-trivial amount of text from chapter 3', () => {
            expect(ch3Sentences.length).toBeGreaterThan(50);
            expect(ch3Text.length).toBeGreaterThan(5000);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  GLOBAL: No bare citation numbers leak into text
    // ═══════════════════════════════════════════════════════════════════════

    describe('no citation number leaks', () => {
        it('should not contain bare citation numbers in any chapter', () => {
            const citationLeakPattern = /[.,;:!?]\d{1,2}\s+[A-Z]/;
            const allSentences = [...ch1Sentences, ...ch2Sentences, ...ch3Sentences];
            const leaks = allSentences.filter(s => {
                if (!citationLeakPattern.test(s.text)) return false;
                // Exclude legitimate verse/section refs
                if (/\d+[.:]\d+/.test(s.text)) return false;
                return true;
            });
            expect(leaks).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CHAPTER 1: <sup><a id="aaN" href="#bbN">N</a></sup>
    // ═══════════════════════════════════════════════════════════════════════

    describe('chapter 1 – sup+anchor citations (#bbN pattern)', () => {
        describe('end-of-sentence citations', () => {
            it('citation 1: after "hull,"', () => {
                expect(ch1Text).toContain('strength of the hull, but the necessity of lift');
                expect(ch1Text).not.toMatch(/hull,\s*1\b/);
            });

            it('citation 15: after "victoriously."', () => {
                expect(ch1Text).toContain('task victoriously.');
                expect(ch1Text).not.toMatch(/victoriously\.\s*15\b/);
            });

            it('citation 23: after "trade language of the time"', () => {
                expect(ch1Text).toContain('trade language of the time.');
                expect(ch1Text).not.toMatch(/the time\.\s*23\b/);
            });

            it('citation 44: after "passenger vehicles"', () => {
                expect(ch1Text).toContain('the hulls of passenger vehicles.');
                expect(ch1Text).not.toMatch(/vehicles\.\s*44\b/);
            });

            it('citation 53: after "according to its purpose"', () => {
                expect(ch1Text).toContain('according to its purpose.');
            });

            it('citation 72: after "our Stabilizer"', () => {
                expect(ch1Text).toContain('uplink to, our Stabilizer.');
                expect(ch1Text).not.toMatch(/Stabilizer\.\s*72\b/);
            });
        });

        describe('mid-sentence citations', () => {
            it('citation 45: after "heavy mass"', () => {
                expect(ch1Text).toContain('triumph over heavy mass.');
                expect(ch1Text).not.toMatch(/mass\.\s*45\b/);
            });

            it('citation 46: after "something buoyant"', () => {
                expect(ch1Text).toContain('transformed into something buoyant,');
                expect(ch1Text).not.toMatch(/buoyant,\s*46\b/);
            });

            it('citation 47: after "already there"', () => {
                expect(ch1Text).toContain('working on materials that were already there.');
                expect(ch1Text).not.toMatch(/there\.\s*47\b/);
            });
        });

        describe('blockquote citations', () => {
            it('citation 14: end of blockquote', () => {
                expect(ch1Text).toContain('to the efficiency of the Main Computer.');
            });

            it('citation 26: short blockquote', () => {
                expect(ch1Text).toContain('without really understanding them.');
            });

            it('citation 48: Oris quote', () => {
                expect(ch1Text).toContain('it too is a calculated metric.');
            });

            it('citation 52: Irons quote', () => {
                expect(ch1Text).toContain('the kind of stress assigned to them.');
            });
        });

        describe('footnote section', () => {
            it('should include footnote text content', () => {
                expect(ch1Text).toContain('SysAdmin Logs 23:8.');
            });

            it('should include longer footnote text', () => {
                expect(ch1Text).toContain('See Philipe, On the Stability of the Hull');
            });

            it('footnote back-link numbers should be stripped', () => {
                const footnoteSentences = ch1Sentences.filter(
                    s => s.text.includes('SysAdmin Logs 23:8')
                );
                if (footnoteSentences.length > 0) {
                    expect(footnoteSentences[0].text).not.toMatch(/^\d+\s/);
                }
            });
        });

        describe('section headings', () => {
            it('should extract section heading text', () => {
                expect(ch1Text).toContain('Environmental and Atmospheric Constraints');
            });

            it('should extract second section heading', () => {
                expect(ch1Text).toContain('Power Generation and Propulsion Systems');
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CHAPTER 2: <a href="Notes.xhtml#EndnoteN"><span class="_Endnote-Reference">N</span></a>
    // ═══════════════════════════════════════════════════════════════════════

    describe('chapter 2 – endnote-reference span citations', () => {
        describe('endnote citations stripped', () => {
            it('citation 3: after "rigid bodies"', () => {
                // "...as if they were simple rigid bodies.<endnote 3>"
                expect(ch2Text).toContain('as if they were simple rigid bodies.');
                expect(ch2Text).not.toMatch(/rigid bodies\.\s*3\b/);
            });

            it('citation 4: after "impossible to ignore"', () => {
                // "...it was impossible to ignore."<endnote 4> There was..."
                expect(ch2Text).toContain('it was impossible to ignore.');
                expect(ch2Text).not.toMatch(/ignore\."\s*4\b/);
            });

            it('citation 5: after "altitude, climate, payload, and design"', () => {
                expect(ch2Text).toContain('particular altitude, climate, payload, and design.');
                expect(ch2Text).not.toMatch(/design\.\s*5\b/);
            });

            it('citation 6: after "processes telemetry"', () => {
                expect(ch2Text).toContain('how each array processes telemetry.');
                expect(ch2Text).not.toMatch(/telemetry\.\s*6\b/);
            });

            it('citation 7: after "against the hull"', () => {
                expect(ch2Text).toContain('closed in building pressure against the hull.');
                expect(ch2Text).not.toMatch(/hull\."\s*7\b/);
            });

            it('citation 8: after "they propel the platform"', () => {
                expect(ch2Text).toContain('they propel the platform.');
                expect(ch2Text).not.toMatch(/platform\.\s*8\b/);
            });

            it('citation 9: after "zero-sum calculation"', () => {
                expect(ch2Text).toContain('zero-sum calculation.');
                expect(ch2Text).not.toMatch(/calculation\.\s*9\b/);
            });

            it('citation 10: after "being better" (end of poem)', () => {
                expect(ch2Text).toContain('some fool would talk about one being better.');
                expect(ch2Text).not.toMatch(/better\.\s*10\b/);
            });
        });

        describe('prose preserved around removed citations', () => {
            it('should preserve the Wells quote text', () => {
                expect(ch2Text).toContain('Mr. Smallways');
            });

            it('should preserve K. L. Vance reference', () => {
                expect(ch2Text).toContain('K. L. Vance');
            });

            it('should preserve poetry content', () => {
                expect(ch2Text).toContain('If I set the lift beside the drag');
            });

            it('should preserve the equilibrium discussion', () => {
                expect(ch2Text).toContain('mathematical fiction');
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CHAPTER 3: <sup><a role="doc-noteref" href="16_notes.xhtml#chapter3-N">N</a></sup>
    // ═══════════════════════════════════════════════════════════════════════

    describe('chapter 3 – doc-noteref citations (external notes file)', () => {
        describe('citations stripped', () => {
            it('citation 17: after "geostationary orbit"', () => {
                expect(ch3Text).toContain('focused on the top 1 percent in geostationary orbit.');
                expect(ch3Text).not.toMatch(/orbit\.\s*17\b/);
            });

            it('citation 18: after "at minimum"', () => {
                expect(ch3Text).toContain('top 20 percent of the atmosphere) at minimum.');
                expect(ch3Text).not.toMatch(/minimum\.\s*18\b/);
            });

            it('citation 19: after "recent decades"', () => {
                expect(ch3Text).toContain('stagnating vertical mobility in recent decades.');
                expect(ch3Text).not.toMatch(/decades\.\s*19\b/);
            });

            it('citation 20: after "overwhelmingly Terran-born"', () => {
                expect(ch3Text).toContain('overwhelmingly Terran-born,');
                expect(ch3Text).not.toMatch(/Terran-born,\s*20\b/);
            });

            it('citation 21: after "thermal consolidations"', () => {
                expect(ch3Text).toContain('were it not for these thermal consolidations.');
                expect(ch3Text).not.toMatch(/consolidations\.\s*21\b/);
            });

            it('citation 22: after "levitation energy in the network"', () => {
                expect(ch3Text).toContain('of all levitation energy in the network.');
                expect(ch3Text).not.toMatch(/network\.\s*22\b/);
            });

            it('citation 23: after "153,001 meters or higher"', () => {
                expect(ch3Text).toContain('153,001 meters or higher.');
                expect(ch3Text).not.toMatch(/higher\.\s*23\b/);
            });

            it('citation 24: after "structural resources"', () => {
                expect(ch3Text).toContain('28 percent of structural resources.');
                expect(ch3Text).not.toMatch(/resources\.\s*24\b/);
            });

            it('citation 25: after "for every hundred"', () => {
                expect(ch3Text).toContain('ten kilograms for every hundred).');
                expect(ch3Text).not.toMatch(/hundred\)\.\s*25\b/);
            });

            it('citation 30: after "biological longevity"', () => {
                expect(ch3Text).toContain('with respect to biological longevity.');
                expect(ch3Text).not.toMatch(/longevity\.\s*30\b/);
            });

            it('citation 35: after "falling out of the sky"', () => {
                expect(ch3Text).toContain('80 percent of the city from falling out of the sky.');
                expect(ch3Text).not.toMatch(/sky\.\s*35\b/);
            });
        });

        describe('prose preserved around removed citations', () => {
            it('should preserve the Reeves reference', () => {
                expect(ch3Text).toContain('Richard Reeves');
            });

            it('should preserve economic data', () => {
                expect(ch3Text).toContain('26 percent of all fusion output');
            });

            it('should preserve "lift hoarding" concept', () => {
                expect(ch3Text).toContain('lift hoarding');
            });

            it('should preserve table caption', () => {
                expect(ch3Text).toContain('Clearance Level and Sector Allocation');
            });

            it('should preserve Roberto Unger reference', () => {
                expect(ch3Text).toContain('Roberto Unger');
            });

            it('should preserve percentage data', () => {
                expect(ch3Text).toContain('72 percent');
            });
        });

        describe('consecutive and clustered citations', () => {
            it('citations 19+20: back-to-back paragraph with multiple citations', () => {
                // Paragraph with citations 19, 20, 21 in quick succession
                expect(ch3Text).toContain('vertical mobility in recent decades.');
                expect(ch3Text).toContain('overwhelmingly Terran-born,');
                expect(ch3Text).toContain('these thermal consolidations.');
                // None should show their citation numbers
                expect(ch3Text).not.toMatch(/decades\.\s*19/);
                expect(ch3Text).not.toMatch(/Terran-born,\s*20/);
                expect(ch3Text).not.toMatch(/consolidations\.\s*21/);
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CROSS-CHAPTER: Clean text flow
    // ═══════════════════════════════════════════════════════════════════════

    describe('clean text flow (all chapters)', () => {
        it('should not have double spaces in any sentence', () => {
            const allSentences = [...ch1Sentences, ...ch2Sentences, ...ch3Sentences];
            const doubleSpaceSentences = allSentences.filter(
                s => s.text.includes('  ')
            );
            expect(doubleSpaceSentences).toEqual([]);
        });

        it('should not have spaces before periods', () => {
            const allSentences = [...ch1Sentences, ...ch2Sentences, ...ch3Sentences];
            const badSpacing = allSentences.filter(
                s => / \./.test(s.text) && !s.text.includes('. . .')
            );
            expect(badSpacing).toEqual([]);
        });

        it('should not have spaces before commas', () => {
            const allSentences = [...ch1Sentences, ...ch2Sentences, ...ch3Sentences];
            const badSpacing = allSentences.filter(s => / ,/.test(s.text));
            expect(badSpacing).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  Legitimate numbers must survive
    // ═══════════════════════════════════════════════════════════════════════

    describe('legitimate numbers are preserved', () => {
        it('ch1: should preserve dates like 2200', () => {
            expect(ch1Text).toContain('By 2200');
        });

        it('ch1: should preserve "d. 2050" style annotations', () => {
            expect(ch1Text).toContain('d. 2050');
        });

        it('ch1: should preserve verse references like "68:18"', () => {
            expect(ch1Text).toContain('68:18');
        });

        it('ch3: should preserve dollar/metric amounts like "153,001 meters"', () => {
            expect(ch3Text).toContain('153,001 meters');
        });

        it('ch3: should preserve percentages like "26 percent"', () => {
            expect(ch3Text).toContain('26 percent');
        });

        it('ch3: should preserve years like 2122', () => {
            expect(ch3Text).toContain('2122');
        });

        it('ch3: should preserve statistics like "1,318 out of more than 43,000"', () => {
            expect(ch3Text).toContain('1,318');
            expect(ch3Text).toContain('43,000');
        });
    });
});
