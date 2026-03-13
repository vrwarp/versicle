import { describe, it, expect } from 'vitest';
import { normalizeMetadata, generateMatchKey } from './entity-resolution';

describe('entity-resolution', () => {

    describe('normalizeMetadata', () => {

        // --- Edge cases: empty/null inputs ---

        it('should return empty string for empty input', () => {
            expect(normalizeMetadata("")).toBe("");
        });

        it('should return empty string for undefined-like input', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(normalizeMetadata(undefined as any)).toBe("");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(normalizeMetadata(null as any)).toBe("");
        });

        // --- Step 1: Lowercasing ---

        it('should lowercase all characters', () => {
            expect(normalizeMetadata("ALL SYSTEMS RED")).toBe("all systems red");
        });

        it('should handle mixed case', () => {
            expect(normalizeMetadata("The Hitchhiker's Guide")).toBe("the hitchhikers guide");
        });

        // --- Step 2: File extension stripping ---

        it('should strip .epub extension', () => {
            expect(normalizeMetadata("All Systems Red.epub")).toBe("all systems red");
        });

        it('should strip .pdf extension', () => {
            expect(normalizeMetadata("Project Hail Mary.pdf")).toBe("project hail mary");
        });

        it('should strip .mobi extension', () => {
            expect(normalizeMetadata("Dune.mobi")).toBe("dune");
        });

        it('should strip .azw3 extension', () => {
            expect(normalizeMetadata("Foundation.azw3")).toBe("foundation");
        });

        it('should strip extensions case-insensitively', () => {
            expect(normalizeMetadata("Book.EPUB")).toBe("book");
        });

        it('should NOT strip extension if it appears mid-string', () => {
            // "something.epub more text" — the regex only strips trailing extensions
            expect(normalizeMetadata("file.epub.bak")).toBe("file epub bak");
        });

        // --- Step 3: Parenthetical/bracket removal ---

        it('should remove parenthetical metadata', () => {
            expect(normalizeMetadata("Dune (Deluxe Edition)")).toBe("dune");
        });

        it('should remove bracketed metadata', () => {
            expect(normalizeMetadata("Dune [Special Edition]")).toBe("dune");
        });

        it('should remove multiple bracketed sections', () => {
            expect(normalizeMetadata("Dune [v2] (2021 Reprint)")).toBe("dune");
        });

        it('should handle nested brackets gracefully (non-greedy match)', () => {
            expect(normalizeMetadata("Title (a) Middle (b)")).toBe("title middle");
        });

        // --- Step 4: Structural punctuation → spaces ---

        it('should convert hyphens to spaces', () => {
            expect(normalizeMetadata("The Three-Body Problem")).toBe("the three body problem");
        });

        it('should convert underscores to spaces', () => {
            expect(normalizeMetadata("The_Murderbot_Diaries")).toBe("the murderbot diaries");
        });

        it('should convert colons to spaces', () => {
            expect(normalizeMetadata("Project: Hail Mary")).toBe("project hail mary");
        });

        it('should convert commas to spaces', () => {
            expect(normalizeMetadata("Flowers for Algernon, Daniel Keyes")).toBe("flowers for algernon daniel keyes");
        });

        it('should convert periods to spaces', () => {
            expect(normalizeMetadata("Dr. Jekyll and Mr. Hyde")).toBe("dr jekyll and mr hyde");
        });

        it('should handle multiple punctuation types together', () => {
            expect(normalizeMetadata("Title-with_mixed:punctuation,and.dots")).toBe("title with mixed punctuation and dots");
        });

        // --- Step 5: Quote/apostrophe deletion ---

        it('should remove single quotes', () => {
            expect(normalizeMetadata("Don't")).toBe("dont");
        });

        it('should remove double quotes', () => {
            expect(normalizeMetadata('"Hello"')).toBe("hello");
        });

        it('should remove curly/smart apostrophes', () => {
            expect(normalizeMetadata("The Handmaid\u2019s Tale")).toBe("the handmaids tale");
        });

        it('should remove curly/smart double quotes', () => {
            expect(normalizeMetadata("\u201CHello\u201D")).toBe("hello");
        });

        // --- Step 6: Whitespace collapse ---

        it('should collapse multiple spaces', () => {
            expect(normalizeMetadata("Title    with   spaces")).toBe("title with spaces");
        });

        it('should trim leading/trailing whitespace', () => {
            expect(normalizeMetadata("  Padded Title  ")).toBe("padded title");
        });

        it('should collapse whitespace left from bracket removal', () => {
            expect(normalizeMetadata("Title [edition]  Extra")).toBe("title extra");
        });

        // --- Step 7: Unknown author nullification ---

        it('should return empty string for "Unknown Author"', () => {
            expect(normalizeMetadata("Unknown Author")).toBe("");
        });

        it('should return empty string for "unknown author" (already lowercased)', () => {
            expect(normalizeMetadata("unknown author")).toBe("");
        });

        it('should return empty string for "UNKNOWN AUTHOR" (uppercase)', () => {
            expect(normalizeMetadata("UNKNOWN AUTHOR")).toBe("");
        });

        it('should NOT nullify partial matches like "Unknown Author Jr"', () => {
            expect(normalizeMetadata("Unknown Author Jr")).toBe("unknown author jr");
        });

        // --- Full pipeline (combined) ---

        it('should handle a realistic messy title: extension + brackets + underscores', () => {
            expect(normalizeMetadata("All_Systems_Red_(Murderbot_Diaries_1).epub"))
                .toBe("all systems red");
        });

        it('should handle a realistic author with edition noise', () => {
            expect(normalizeMetadata("Martha Wells [Tor.com]"))
                .toBe("martha wells");
        });

        it('should handle hyphens and colons in subtitles', () => {
            expect(normalizeMetadata("Sapiens: A Brief History of Humankind - Yuval Noah Harari"))
                .toBe("sapiens a brief history of humankind yuval noah harari");
        });
    });

    describe('generateMatchKey', () => {

        it('should combine normalized title and author', () => {
            expect(generateMatchKey("All Systems Red", "Martha Wells"))
                .toBe("all systems red martha wells");
        });

        it('should match despite extension in title', () => {
            const key1 = generateMatchKey("All Systems Red.epub", "Martha Wells");
            const key2 = generateMatchKey("All Systems Red", "Martha Wells");
            expect(key1).toBe(key2);
        });

        it('should match despite underscores vs spaces', () => {
            const key1 = generateMatchKey("The_Three_Body_Problem", "Liu Cixin");
            const key2 = generateMatchKey("The Three Body Problem", "Liu Cixin");
            expect(key1).toBe(key2);
        });

        it('should match despite brackets in one dataset', () => {
            const key1 = generateMatchKey("Dune [Deluxe Edition]", "Frank Herbert");
            const key2 = generateMatchKey("Dune", "Frank Herbert");
            expect(key1).toBe(key2);
        });

        it('should match despite colon vs no colon', () => {
            const key1 = generateMatchKey("Project: Hail Mary", "Andy Weir");
            const key2 = generateMatchKey("Project Hail Mary", "Andy Weir");
            expect(key1).toBe(key2);
        });

        it('should match despite apostrophe differences', () => {
            const key1 = generateMatchKey("The Hitchhiker's Guide", "Douglas Adams");
            const key2 = generateMatchKey("The Hitchhikers Guide", "Douglas Adams");
            expect(key1).toBe(key2);
        });

        it('should match despite smart quotes vs straight quotes', () => {
            const key1 = generateMatchKey("The Hitchhiker\u2019s Guide", "Douglas Adams");
            const key2 = generateMatchKey("The Hitchhiker's Guide", "Douglas Adams");
            expect(key1).toBe(key2);
        });

        it('should collapse unknown author to empty', () => {
            const key = generateMatchKey("Orphan Book", "Unknown Author");
            expect(key).toBe("orphan book");
        });

        it('should handle empty author gracefully', () => {
            const key = generateMatchKey("Solo Title", "");
            expect(key).toBe("solo title");
        });

        it('should handle empty title gracefully', () => {
            const key = generateMatchKey("", "Solo Author");
            expect(key).toBe("solo author");
        });

        it('should handle both empty gracefully', () => {
            const key = generateMatchKey("", "");
            expect(key).toBe("");
        });

        // --- Real-world cross-dataset scenarios ---

        it('should reconcile a Goodreads CSV title with an EPUB filename-derived title', () => {
            // Reading list from CSV import: clean title
            // Inventory from EPUB ingestion: filename-derived title with extension
            const csvKey = generateMatchKey("Crazy Rich Asians", "Kevin Kwan");
            const epubKey = generateMatchKey("Crazy_Rich_Asians.epub", "Kevin Kwan");
            expect(csvKey).toBe(epubKey);
        });

        it('should reconcile metadata with edition brackets and commas in author', () => {
            const key1 = generateMatchKey("War and Peace [Penguin Classics]", "Tolstoy, Leo");
            const key2 = generateMatchKey("War and Peace", "Tolstoy Leo");
            expect(key1).toBe(key2);
        });

        it('should NOT false-match genuinely different books', () => {
            const key1 = generateMatchKey("Crazy Love", "Francis Chan");
            const key2 = generateMatchKey("Crazy Rich Asians", "Kevin Kwan");
            expect(key1).not.toBe(key2);
        });

        it('should NOT false-match books with same title but different authors', () => {
            const key1 = generateMatchKey("Crazy Love", "Francis Chan");
            const key2 = generateMatchKey("Crazy Love", "Leslie Morgan Steiner");
            expect(key1).not.toBe(key2);
        });
    });

    // ============================================================
    // CHALLENGING REAL-WORLD PAIRS
    // These test cases are derived from actual e-book library data
    // where structural discrepancies between export formats cause
    // entity resolution failures.
    // ============================================================
    describe('challenging real-world pairs', () => {

        // --- SHOULD MATCH ---

        it('C1: Punctuation sanitization — underscore for colon in subtitle', () => {
            // The file system export replaces colons with underscores
            const key1 = generateMatchKey(
                "Empowered Witness_ Politics, Culture, and the Spiritual Mission of the Church",
                "Alan D. Strange, Kevin DeYoung"
            );
            const key2 = generateMatchKey(
                "Empowered Witness: Politics, Culture, and the Spiritual Mission of the Church",
                "Alan D. Strange, Kevin DeYoung"
            );
            expect(key1).toBe(key2);
        });

        it('C2: Edition metadata + extension bleed — author baked into filename title', () => {
            // JSON tracks "Crazy Love" but filename has "Francis Chan - Crazy Love (Revised and Updated).epub"
            const key1 = generateMatchKey(
                "Francis Chan - Crazy Love (Revised and Updated).epub",
                "Francis Chan"
            );
            const key2 = generateMatchKey(
                "Crazy Love",
                "Francis Chan"
            );
            expect(key1).toBe(key2);
        });

        it('C3: Encoding/diacritics — non-ASCII characters preserved across formats', () => {
            const key1 = generateMatchKey(
                "Biblical Theology_ A Canonical, Thematic, and Ethical Approach",
                "Andreas J. Köstenberger, Gregory Goswell"
            );
            const key2 = generateMatchKey(
                "Biblical Theology: A Canonical, Thematic, and Ethical Approach",
                "Andreas J. Köstenberger, Gregory Goswell"
            );
            expect(key1).toBe(key2);
        });

        it('C4: Missing metadata fallback — snake_case filename with extension as title', () => {
            const key1 = generateMatchKey(
                "five_lies_of_our_anti-christian_age_1.epub",
                "Unknown Author"
            );
            const key2 = generateMatchKey(
                "five lies of our anti christian age 1",
                "Unknown Author"
            );
            expect(key1).toBe(key2);
        });

        it('C5: Whitespace anomalies — colon stripped leaving double space, plus extension', () => {
            const key1 = generateMatchKey(
                "Anxious Generation  How the Great Rewiring of Childhood.epub",
                "Unknown Author"
            );
            const key2 = generateMatchKey(
                "Anxious Generation: How the Great Rewiring of Childhood",
                "Unknown Author"
            );
            expect(key1).toBe(key2);
        });

        it('C7: Apostrophes + double underscores — __ representing colon-space', () => {
            // "Fool's Gold__" vs "Fools Gold:"
            const key1 = generateMatchKey(
                "Fool's Gold__ Discerning Truth in an Age of Error",
                "John MacArthur"
            );
            const key2 = generateMatchKey(
                "Fools Gold: Discerning Truth in an Age of Error",
                "John MacArthur"
            );
            expect(key1).toBe(key2);
        });

        it('C10: Extraneous contributor roles — "gen. ed." noise in author field', () => {
            const key1 = generateMatchKey(
                "1 Samuel: Looking for a Leader",
                "John Woodhouse, R. Kent Hughes, gen. ed."
            );
            const key2 = generateMatchKey(
                "1 Samuel: Looking for a Leader",
                "John Woodhouse, R. Kent Hughes"
            );
            expect(key1).toBe(key2);
        });

        // --- SHOULD NOT MATCH (collision guards) ---

        it('C6: Collision risk — same base title, different subtitles (should NOT match)', () => {
            const key1 = generateMatchKey(
                "Redeeming Our Thinking about History",
                "Vern S. Poythress"
            );
            const key2 = generateMatchKey(
                "Redeeming Our Thinking about History_ A God-Centered Approach",
                "Vern S. Poythress"
            );
            expect(key1).not.toBe(key2);
        });

        it('C11: Sequel volume collision — distinguished only by trailing integer (should NOT match)', () => {
            const key1 = generateMatchKey(
                "Wind and Truth 1.epub",
                "Unknown Author"
            );
            const key2 = generateMatchKey(
                "Wind and Truth.epub",
                "Unknown Author"
            );
            expect(key1).not.toBe(key2);
        });

        // --- INHERENTLY UNSOLVABLE with pure normalization ---
        // These document known limitations where cross-field heuristics
        // or substring matching would be needed, which risk false positives.

        it('C8: OS-level truncation — truncated title cannot match full title (documents limitation)', () => {
            // The OS or export script truncated "Brain Science..." to "Brain.epub"
            // This is lossy data — no normalization can recover lost words.
            const key1 = generateMatchKey(
                "The Other Half of Church Christian Community, Brain.epub",
                "Unknown Author"
            );
            const key2 = generateMatchKey(
                "The Other Half of Church: Christian Community, Brain Science, and Overcoming Spiritual Stagnation",
                "Unknown Author"
            );
            // These CANNOT match without substring/prefix matching, which would cause false positives
            expect(key1).not.toBe(key2);
        });

        it('C9: Author baked into title — cross-field heuristic needed (documents limitation)', () => {
            // title1 = "R. Kent Hughes - John.epub", author1 = "Unknown Author"
            // title2 = "John", author2 = "R. Kent Hughes"
            // The author is in the title field on one side and the author field on the other.
            const key1 = generateMatchKey(
                "R. Kent Hughes - John.epub",
                "Unknown Author"
            );
            const key2 = generateMatchKey(
                "John",
                "R. Kent Hughes"
            );
            // The words are the SAME but in different order, so the keys differ.
            // Solving this requires "Author - Title" pattern detection, a different algorithm.
            expect(key1).not.toBe(key2);
        });
    });
});
