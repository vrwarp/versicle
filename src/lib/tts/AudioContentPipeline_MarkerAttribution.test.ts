import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { extractSentencesFromNode } from '../tts';
import { EpubCFI } from 'epubjs';
import type { CitationMarker } from '../../types/db';

// NOTE: This suite deliberately does NOT mock epubjs. Marker attribution lives or dies on the
// real EpubCFI.compare semantics, so every assertion runs against the actual library in jsdom.
// (cfi-utils.test.ts mocks epubjs with a naive lexicographic string compare — that mock would
// hide exactly the bug this suite guards against.)

type Group = { segments: { cfi: string }[] };

// Minimal helpers — attributeMarkersToGroups only reads segments[0].cfi and segments[last].cfi.
const group = (...cfis: string[]): Group => ({ segments: cfis.map(cfi => ({ cfi })) });
const marker = (cfi: string): CitationMarker => ({
    cfi,
    markerText: '1',
    super: true,
    numeric: true,
    glued: false,
});

const attribute = (pipeline: AudioContentPipeline, groups: Group[], markers: CitationMarker[]): number[] =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipeline as any).attributeMarkersToGroups(groups, markers);

describe('AudioContentPipeline.attributeMarkersToGroups', () => {
    const pipeline = new AudioContentPipeline();

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
        const result = attribute(pipeline, [GROUP_36_SINGLE], [MARK_FN1_HEAD]);
        expect(result).toEqual([0]);
    });

    it('reproduces the full production scene with correct attributions', () => {
        const groups = [GROUP_28, GROUP_34, GROUP_36_SINGLE, GROUP_37_MULTI];
        const markers = [MARK_FN1_BODY, MARK_FN2_BODY, MARK_FN1_HEAD, MARK_FN2_HEAD];

        // fn1 body ref -> group 28 (idx 0); fn2 body ref -> orphan (trailing, past last segment);
        // fn1 head -> single-segment note (idx 2, FIXED); fn2 head -> multi-segment note (idx 3).
        expect(attribute(pipeline, groups, markers)).toEqual([0, -1, 2, 3]);
    });

    it('keeps the multi-segment footnote-head marker attributed (no regression)', () => {
        expect(attribute(pipeline, [GROUP_37_MULTI], [MARK_FN2_HEAD])).toEqual([0]);
    });

    it('keeps a mid-paragraph body marker attributed (no regression)', () => {
        expect(attribute(pipeline, [GROUP_28], [MARK_FN1_BODY])).toEqual([0]);
    });

    it('still orphans a marker that falls past the last segment (out of scope for this fix)', () => {
        // The fn2 body ref is the final child of its paragraph, after the last spoken sentence.
        // Fix #2 widens the window to the last segment END, not beyond it, so this stays orphaned.
        expect(attribute(pipeline, [GROUP_34], [MARK_FN2_BODY])).toEqual([-1]);
    });

    // ---------------------------------------------------------------------------------------
    // Ordering / disjoint groups
    // ---------------------------------------------------------------------------------------
    it('returns the index of the first containing group, preserving marker order', () => {
        const groups = [GROUP_28, GROUP_34, GROUP_36_SINGLE, GROUP_37_MULTI];
        // Order intentionally shuffled relative to document order.
        const markers = [MARK_FN2_HEAD, MARK_FN1_HEAD, MARK_FN1_BODY];
        expect(attribute(pipeline, groups, markers)).toEqual([3, 2, 0]);
    });

    it('orphans a marker positioned before every group', () => {
        // Marker sits in the epigraph region (/4/2), before group 28 (/4/28...).
        const before = marker('epubcfi(/6/34!/4/2/1,/1:0,/1:1)');
        expect(attribute(pipeline, [GROUP_28, GROUP_34], [before])).toEqual([-1]);
    });

    it('orphans a marker positioned after every group', () => {
        // Marker in the trailing spacer region (/4/32), after the footnotes (/4/30...).
        const after = marker('epubcfi(/6/34!/4/32/1,/1:0,/1:1)');
        expect(attribute(pipeline, [GROUP_36_SINGLE, GROUP_37_MULTI], [after])).toEqual([-1]);
    });

    // ---------------------------------------------------------------------------------------
    // Safety: empty / malformed input must never throw
    // ---------------------------------------------------------------------------------------
    it('returns [] when there are no markers', () => {
        expect(attribute(pipeline, [GROUP_28], [])).toEqual([]);
    });

    it('returns -1 for a malformed marker CFI without throwing', () => {
        expect(attribute(pipeline, [GROUP_28], [marker('not-a-cfi')])).toEqual([-1]);
    });

    it('skips a group whose segment CFI is malformed, still matching valid groups', () => {
        const bad = group('totally-broken');
        const groups = [bad, GROUP_36_SINGLE];
        // The valid head marker should skip the broken group and attribute to index 1.
        expect(attribute(pipeline, groups, [MARK_FN1_HEAD])).toEqual([1]);
    });

    it('skips a group with no segments', () => {
        const empty: Group = { segments: [] };
        expect(attribute(pipeline, [empty, GROUP_36_SINGLE], [MARK_FN1_HEAD])).toEqual([1]);
    });

    it('handles a point (non-range) segment CFI via fallback', () => {
        // parseCfiRange returns null for point CFIs; bounds fall back to the raw string.
        const pointGroup = group('epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2/3:0)');
        // A marker at the exact point should compare as contained (>= start && <= end).
        const atPoint = marker('epubcfi(/6/34!/4/30/2[footnote_1e11be33]/2/3:0)');
        expect(attribute(pipeline, [pointGroup], [atPoint])).toEqual([0]);
    });
});

describe('AudioContentPipeline marker attribution — DOM round-trip (wiring smoke test)', () => {
    const pipeline = new AudioContentPipeline();

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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const groups = (pipeline as any).groupSentencesByRoot(sentences) as { segments: { cfi: string; text: string }[]; fullText: string }[];
        const bodyIdx = groups.findIndex(g => g.segments.some(s => s.text.includes('Alpha sentence here')));
        expect(bodyIdx).toBeGreaterThanOrEqual(0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assignment: number[] = (pipeline as any).attributeMarkersToGroups(groups, citationMarkers);
        expect(assignment).toHaveLength(citationMarkers.length);

        // The body reference sits mid-paragraph -> attributes to the body group (robust across
        // CFI numbering because the group has later segments after the marker).
        const bodyMarkerIdx = citationMarkers.findIndex(m => (m.targetHref || '').includes('fn_a') && !(m.targetHref || '').includes('fnref'));
        expect(bodyMarkerIdx).toBeGreaterThanOrEqual(0);
        expect(assignment[bodyMarkerIdx]).toBe(bodyIdx);
    });
});
