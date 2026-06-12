/**
 * CfiGrouper suite (Phase 5c; phase5-tts-strangler.md §5c.2). Carries the
 * surviving assertions of the deleted AudioContentPipeline grouping/
 * attribution suites as named regression blocks (absorption ledger row 17):
 * AudioContentPipeline_Grouping, AudioContentPipeline_StructuralAnomaly,
 * AudioContentPipeline_MarkerAttribution.
 *
 * NOTE: this suite deliberately does NOT mock epubjs — marker attribution
 * lives or dies on the real EpubCFI.compare semantics, so every assertion
 * runs against the actual library in jsdom (cfi.test.ts mocks epubjs with a
 * naive lexicographic compare; that mock would hide exactly the bugs these
 * blocks guard against).
 */
import { describe, it, expect } from 'vitest';
import { EpubCFI } from 'epubjs';
import { groupSegmentsByRoot, attributeMarkersToGroups } from './group';
import { preprocessBlockRoots, parseCfiRange } from './parse';
import { generateCfiRange } from './merge';
import { extractSentencesFromNode } from '@lib/tts/sentence-extraction';
import type { CitationMarker } from '~types/db';

describe('regression: AudioContentPipeline_Grouping', () => {
    it('should consistently group regardless of order (P1, Div, P2 vs Div, P1, P2)', () => {
        // Data setup using correct CFIs with spine separator (!)
        // Spine: /6/14

        // Div text node: path /4/1:0 -> Parent /4
        const divText = { text: 'Div Text', cfi: 'epubcfi(/6/14!/4/1:0)' };

        // P1 text node: path /4/2/1:0 -> Parent /4/2
        const p1Text = { text: 'P1 Text', cfi: 'epubcfi(/6/14!/4/2/1:0)' };

        // P2 text node: path /4/4/1:0 -> Parent /4/4
        const p2Text = { text: 'P2 Text', cfi: 'epubcfi(/6/14!/4/4/1:0)' };

        // Case 1: Div, P1, P2 — all grouped together because Div is ancestor of both
        const case1 = groupSegmentsByRoot([divText, p1Text, p2Text]);

        // Case 2: P1, Div, P2 — P1 initiates group, Div expands scope to /4, P2 fits in /4
        const case2 = groupSegmentsByRoot([p1Text, divText, p2Text]);

        expect(case1.length).toBe(1); // Div captures both children
        expect(case2.length).toBe(1); // Div (in middle) expands scope to capture P2
    });

    describe('regression: AudioPlayerService.test (grouping)', () => {
        // Carried from the deleted AudioPlayerService.test.ts grouping block
        // (absorption ledger row 1): the pure grouping pins lived there for
        // historical reasons; the colliding-parent skip-mask case is covered
        // end-to-end by parity P14 (sourceIndices-keyed masks).
        it('groups sentences by parent and generates Range CFIs for rootCfi', () => {
            const sentences = [
                { text: 'A', cfi: 'epubcfi(/6/14!/4/2/1:0)' },
                { text: 'B', cfi: 'epubcfi(/6/14!/4/2/3:0)' }, // Same parent /4/2
                { text: 'C', cfi: 'epubcfi(/6/14!/4/4/1:0)' }, // New parent /4/4
            ];

            const groups = groupSegmentsByRoot(sentences);

            expect(groups).toHaveLength(2);
            expect(groups[0].segments).toHaveLength(2);
            expect(groups[0].rootCfi).toBe(
                generateCfiRange('epubcfi(/6/14!/4/2/1:0)', 'epubcfi(/6/14!/4/2/3:0)'));
            expect(groups[1].segments).toHaveLength(1);
            expect(groups[1].rootCfi).toBe(
                generateCfiRange('epubcfi(/6/14!/4/4/1:0)', 'epubcfi(/6/14!/4/4/1:0)'));
        });

        it('accumulates fullText capped for detection sampling', () => {
            const long = 'x'.repeat(600);
            const groups = groupSegmentsByRoot([
                { text: long, cfi: 'epubcfi(/6/14!/4/2/1:0)' },
                { text: long, cfi: 'epubcfi(/6/14!/4/2/3:0)' },
                { text: long, cfi: 'epubcfi(/6/14!/4/2/5:0)' },
            ]);
            expect(groups).toHaveLength(1);
            // Cap: stops accumulating once past 1000 chars (each append adds text + '. ').
            expect(groups[0].fullText.length).toBeLessThan(1000 + long.length + 3);
        });
    });

    describe('regression: range-CFI table roots keep distinct group identities (D2)', () => {
        // The deleted TableAdaptationProcessor.preprocessTableRoots escaped its template
        // literal and emitted the literal string 'epubcfi(${range.parent})' as every
        // range-CFI table's `original`, so adjacent tables merged into a single group.
        // The grouping path feeds preprocessBlockRoots output into groupSegmentsByRoot.
        it('keeps two adjacent range-CFI tables in separate groups with parseable root CFIs', () => {
            // Two sibling tables (/4/10 and /4/12), each persisted as a range CFI
            const tableRoots = preprocessBlockRoots([
                'epubcfi(/6/14!/4/10,/2/1:0,/8/1:20)',
                'epubcfi(/6/14!/4/12,/2/1:0,/6/1:14)',
            ]);

            const sentences = [
                { text: 'Table 1 row A', cfi: 'epubcfi(/6/14!/4/10/2/1:0)' },
                { text: 'Table 1 row B', cfi: 'epubcfi(/6/14!/4/10/8/1:0)' },
                { text: 'Table 2 row A', cfi: 'epubcfi(/6/14!/4/12/2/1:0)' },
                { text: 'Table 2 row B', cfi: 'epubcfi(/6/14!/4/12/6/1:0)' },
            ];

            const groups = groupSegmentsByRoot(sentences, tableRoots);

            // Broken version: both tables shared the junk identity and merged into ONE group.
            expect(groups).toHaveLength(2);
            expect(groups[0].segments).toHaveLength(2);
            expect(groups[1].segments).toHaveLength(2);

            for (const group of groups) {
                // No literal '${' placeholder may leak into emitted CFIs/group data
                expect(JSON.stringify(group)).not.toContain('${');
                // The finalized root must be a parseable range CFI
                expect(parseCfiRange(group.rootCfi)).not.toBeNull();
            }
            expect(parseCfiRange(groups[0].rootCfi)?.parent).toBe('/6/14!/4/10');
            expect(parseCfiRange(groups[1].rootCfi)?.parent).toBe('/6/14!/4/12');
        });
    });

    describe('characterization: kernel cfiContains separator fix (5c-PR1, content D9/S17)', () => {
        // The inline isDescendant/isAncestor copies used ['/', '!', ':'] — missing
        // '[' and ',' from THE canonical set. An assertion-bracket child parent
        // (e.g. /4/10[note] under /4/10) therefore failed the boundary check and
        // split the group. Strictly a fix: separator-free fixtures group exactly
        // as before (the suites above), and the bracket fixture now coalesces.
        it('groups assertion-bracket children with their unbracketed ancestor', () => {
            const sentences = [
                // Parent CFI of the first sentence: /4/10
                { text: 'Block head', cfi: 'epubcfi(/6/14!/4/10/1:0)' },
                // Parent CFI: /4/10[note] — same node, id-asserted (descendant by THE set's '[')
                { text: 'Asserted child', cfi: 'epubcfi(/6/14!/4/10[note]/2/1:0)' },
            ];

            const groups = groupSegmentsByRoot(sentences);

            // Pre-fix behavior: 2 groups (the '[' boundary was rejected).
            expect(groups).toHaveLength(1);
            expect(groups[0].segments).toHaveLength(2);
        });
    });
});

describe('regression: AudioContentPipeline_StructuralAnomaly', () => {
    const createMockCfiGenerator = () => (range: Range): string => {
        const epubCfi = new EpubCFI(range, '/6/14!');
        return epubCfi.toString();
    };

    it('should correctly segment body paragraphs into separate groups even when anomalous metadata tags are present in the body', () => {
        // Construct the anomalous HTML DOM where metadata tags are placed inside the body
        const container = document.createElement('div');
        document.body.appendChild(container);
        container.innerHTML = `
            <p class="intro-quote">"This is the first random quote."</p>
            <p class="intro-author">First Author</p>
            <p class="intro-quote">"This is the second random quote."</p>
            <p class="intro-author">Second Author</p>
            <p class="intro-quote">"This is the third random quote."</p>
            <p class="intro-author">Third Author</p>

            <base href="https://localhost:5173/content/chapter-1.xhtml">
            <meta http-equiv="content-type" content="text/html; charset=UTF-8">
            <title>Chapter 1: The Mystery of the Grouping</title>
            <link href="blob:https://localhost:5173/stylesheet.css" rel="stylesheet" type="text/css">

            <div class="section">
                <p class="chapter-number">Chapter 1</p>
                <p class="chapter-title">The Mystery of the Grouping</p>
                <p class="body-text">This is the first paragraph of the actual body text of the chapter.</p>
                <p class="body-text">This is the second paragraph of the body text.</p>
            </div>
        `;

        const cfiGen = createMockCfiGenerator();

        // Extract sentences from the DOM
        const { sentences } = extractSentencesFromNode(container, cfiGen);
        document.body.removeChild(container);

        const groups = groupSegmentsByRoot(sentences);

        // Under correct behavior, all body paragraphs are correctly isolated:
        // 6 intro groups + chapter number + chapter title + 2 body paragraphs = 10.
        // (The historical bug: the title tag's root Range CFI collapsed all
        // subsequent paragraphs into one group, yielding 6.)
        expect(groups).toHaveLength(10);

        // Verify body paragraphs are in their own separate groups
        const bodyGroup1 = groups[8];
        const bodyGroup2 = groups[9];

        expect(bodyGroup1.segments[0].text).toContain('This is the first paragraph of the actual body text');
        expect(bodyGroup2.segments[0].text).toContain('This is the second paragraph of the body text');
    });
});

describe('regression: AudioContentPipeline_MarkerAttribution', () => {
    type Group = { segments: { cfi: string }[] };

    // Minimal helpers — attributeMarkersToGroups only reads segments[0].cfi and segments[last].cfi.
    const group = (...cfis: string[]): Group => ({ segments: cfis.map(cfi => ({ cfi })) });
    const marker = (cfi: string): CitationMarker => ({
        cfi,
        markerText: '1',
        super: true,
        numeric: true,
        glued: false,
        leading: false,
    });

    // ---------------------------------------------------------------------------------------
    // Real CFIs captured from the "All That Jesus Commanded — Command #7" telemetry.
    // Layout: body section under /4/28, footnotes under /4/30.
    //   footnote_1e11be33 (/4/30/2): a SINGLE-sentence note  -> group is single-segment
    //   footnote_613d091d (/4/30/4): a MANY-sentence note    -> group is multi-segment
    // Both notes open with a back-reference link ("1"/"2") in a <span> before the spoken text.
    // ---------------------------------------------------------------------------------------
    const GROUP_28 = group(  // body paragraph, footnote ref "1" sits mid-paragraph
        'epubcfi(/6/34!/4/28/46,/1:0,/1:224)',
        'epubcfi(/6/34!/4/28/46,/7:1,/7:41)',
    );
    const GROUP_34 = group(  // body paragraph, footnote ref "2" is the trailing child of the <p>
        'epubcfi(/6/34!/4/28/58,/1:0,/1:104)',
        'epubcfi(/6/34!/4/28/58,/11:222,/11:301)',
    );
    const GROUP_36_SINGLE = group(  // single-sentence footnote 1 (first === last)
        'epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2,/1:0,/3:34)',
    );
    const GROUP_37_MULTI = group(  // multi-sentence footnote 2
        'epubcfi(/6/34!/4/30/4[footnote_613d091d]/2,/1:0,/1:113)',
        'epubcfi(/6/34!/4/30/4[footnote_613d091d]/2,/5:969,/5:1110)',
    );

    const MARK_FN1_BODY = marker('epubcfi(/6/34!/4/28/46/6,/1:0,/1:1)');        // ref "1" mid group 28
    const MARK_FN2_BODY = marker('epubcfi(/6/34!/4/28/58/12,/1:0,/1:1)');       // ref "2" trailing group 34
    const MARK_FN1_HEAD = marker('epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2/2,/1:0,/1:1)'); // note 1 head
    const MARK_FN2_HEAD = marker('epubcfi(/6/34!/4/30/4[footnote_613d091d]/2/2,/1:0,/1:1)'); // note 2 head

    it('attributes the single-segment footnote-head marker (the fix)', () => {
        // Before the fix this orphaned (-1): single-segment group => upper bound collapsed to the
        // segment start => head marker (before the spoken text) failed the <= end check.
        const result = attributeMarkersToGroups([GROUP_36_SINGLE], [MARK_FN1_HEAD]);
        expect(result).toEqual([0]);
    });

    it('reproduces the full production scene with correct attributions', () => {
        const groups = [GROUP_28, GROUP_34, GROUP_36_SINGLE, GROUP_37_MULTI];
        const markers = [MARK_FN1_BODY, MARK_FN2_BODY, MARK_FN1_HEAD, MARK_FN2_HEAD];

        // fn1 body ref -> group 28 (idx 0); fn2 body ref -> orphan (trailing, past last segment);
        // fn1 head -> single-segment note (idx 2, FIXED); fn2 head -> multi-segment note (idx 3).
        expect(attributeMarkersToGroups(groups, markers)).toEqual([0, -1, 2, 3]);
    });

    it('keeps the multi-segment footnote-head marker attributed (no regression)', () => {
        expect(attributeMarkersToGroups([GROUP_37_MULTI], [MARK_FN2_HEAD])).toEqual([0]);
    });

    it('keeps a mid-paragraph body marker attributed (no regression)', () => {
        expect(attributeMarkersToGroups([GROUP_28], [MARK_FN1_BODY])).toEqual([0]);
    });

    it('still orphans a marker that falls past the last segment (out of scope for this fix)', () => {
        // The fn2 body ref is the final child of its paragraph, after the last spoken sentence.
        // Fix #2 widens the window to the last segment END, not beyond it, so this stays orphaned.
        expect(attributeMarkersToGroups([GROUP_34], [MARK_FN2_BODY])).toEqual([-1]);
    });

    // ---------------------------------------------------------------------------------------
    // Ordering / disjoint groups
    // ---------------------------------------------------------------------------------------
    it('returns the index of the first containing group, preserving marker order', () => {
        const groups = [GROUP_28, GROUP_34, GROUP_36_SINGLE, GROUP_37_MULTI];
        // Order intentionally shuffled relative to document order.
        const markers = [MARK_FN2_HEAD, MARK_FN1_HEAD, MARK_FN1_BODY];
        expect(attributeMarkersToGroups(groups, markers)).toEqual([3, 2, 0]);
    });

    it('orphans a marker positioned before every group', () => {
        // Marker sits in the epigraph region (/4/2), before group 28 (/4/28...).
        const before = marker('epubcfi(/6/34!/4/2/1,/1:0,/1:1)');
        expect(attributeMarkersToGroups([GROUP_28, GROUP_34], [before])).toEqual([-1]);
    });

    it('orphans a marker positioned after every group', () => {
        // Marker in the trailing spacer region (/4/32), after the footnotes (/4/30...).
        const after = marker('epubcfi(/6/34!/4/32/1,/1:0,/1:1)');
        expect(attributeMarkersToGroups([GROUP_36_SINGLE, GROUP_37_MULTI], [after])).toEqual([-1]);
    });

    // ---------------------------------------------------------------------------------------
    // Safety: empty / malformed input must never throw
    // ---------------------------------------------------------------------------------------
    it('returns [] when there are no markers', () => {
        expect(attributeMarkersToGroups([GROUP_28], [])).toEqual([]);
    });

    it('returns -1 for a malformed marker CFI without throwing', () => {
        expect(attributeMarkersToGroups([GROUP_28], [marker('not-a-cfi')])).toEqual([-1]);
    });

    it('skips a group whose segment CFI is malformed, still matching valid groups', () => {
        const bad = group('totally-broken');
        const groups = [bad, GROUP_36_SINGLE];
        // The valid head marker should skip the broken group and attribute to index 1.
        expect(attributeMarkersToGroups(groups, [MARK_FN1_HEAD])).toEqual([1]);
    });

    it('skips a group with no segments', () => {
        const empty: Group = { segments: [] };
        expect(attributeMarkersToGroups([empty, GROUP_36_SINGLE], [MARK_FN1_HEAD])).toEqual([1]);
    });

    it('handles a point (non-range) segment CFI via fallback', () => {
        // parseCfiRange returns null for point CFIs; bounds fall back to the raw string.
        const pointGroup = group('epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2/3:0)');
        // A marker at the exact point should compare as contained (>= start && <= end).
        const atPoint = marker('epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2/3:0)');
        expect(attributeMarkersToGroups([pointGroup], [atPoint])).toEqual([0]);
    });
});

describe('marker attribution — DOM round-trip (wiring smoke test)', () => {
    const cfiGen = (range: Range): string => new EpubCFI(range, '/6/14!').toString();

    // This block validates the extraction -> marker-capture -> attribution wiring end to end
    // against CFIs generated by the real EpubCFI in jsdom. It does NOT assert footnote-HEAD
    // attribution: jsdom's CFI step numbering for a leading <span> differs from the production
    // reader's (jsdom places the spoken text at /1 with the head span at /2 — marker after text;
    // production has a leading text node at /1, span /2, body text /3 — marker between). Footnote-
    // head attribution is therefore proven authoritatively by the raw production-CFI tests above.
    it('captures markers and attributes a mid-paragraph body reference to its group', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        container.innerHTML = `
            <div class="section">
                <p class="body">Alpha sentence here. Beta sentence with a mark.<sup><a href="#fn_a" id="fnref_a">1</a></sup> Gamma sentence final.</p>
            </div>
            <div class="footnotes">
                <div class="footnote" id="fn_a">
                    <p class="note"><span class="ref"><a href="#fnref_a">1</a></span> Solo footnote sentence stands alone.</p>
                </div>
                <div class="footnote" id="fn_b">
                    <p class="note"><span class="ref"><a href="#fnref_b">2</a></span> First note sentence here. Second note sentence here. Third note sentence here.</p>
                </div>
            </div>
        `;

        const { sentences, citationMarkers } = extractSentencesFromNode(container, cfiGen);
        document.body.removeChild(container);

        // Three markers captured: body "1" (targets #fn_a), note-a head, note-b head.
        expect(citationMarkers).toHaveLength(3);
        expect(citationMarkers.some(m => (m.targetHref || '').includes('fn_a'))).toBe(true);

        const groups = groupSegmentsByRoot(sentences);
        const bodyIdx = groups.findIndex(g => g.segments.some(s => s.text.includes('Alpha sentence here')));
        expect(bodyIdx).toBeGreaterThanOrEqual(0);

        const assignment = attributeMarkersToGroups(groups, citationMarkers);
        expect(assignment).toHaveLength(citationMarkers.length);

        // The body reference sits mid-paragraph -> attributes to the body group (robust across
        // CFI numbering because the group has later segments after the marker).
        const bodyMarkerIdx = citationMarkers.findIndex(m => (m.targetHref || '').includes('fn_a') && !(m.targetHref || '').includes('fnref'));
        expect(bodyMarkerIdx).toBeGreaterThanOrEqual(0);
        expect(assignment[bodyMarkerIdx]).toBe(bodyIdx);
    });
});
