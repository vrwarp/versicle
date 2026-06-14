/**
 * Property-based equivalence suite for the CFI kernel's string fast paths
 * (phase5-tts-strangler.md §5c.4): every fast path survives ONLY behind
 * agreement with the parsed-component reference model in ./parse.
 *
 * The arbitrary is STRUCTURED (token-built CFIs — steps, id-like assertions,
 * indirections, offsets, ranges), not random strings: the seeded-fuzz
 * convention of cfi.fuzz.test.ts / TextScanningTrie.fuzz extended to
 * properties with an oracle. >10k total cases, all derived from
 * DEFAULT_FUZZ_SEED so failures reproduce.
 *
 * Properties:
 *   E1  tokenizer round-trip: parse(serialize(tokens)) === tokens
 *   E2  tryFastMergeCfi vs mergeCfiSlow (fast === null || fast ≅ slow)
 *   E3  getParentCfi (string) vs getParentCfiParsed (parsed oracle)
 *   E4  cfiContains (string) vs cfiContainsParsed (parsed oracle)
 */
import { describe, it, expect } from 'vitest';
import { SeededRandom, DEFAULT_FUZZ_SEED } from '@test/fuzz-utils';
import {
    parseCfiTokens, serializeCfiTokens,
    tryFastMergeCfi, mergeCfiSlow, parseCfiRange,
    getParentCfi, getParentCfiParsed,
    cfiContains, cfiContainsParsed,
} from './index';
import type { CfiToken, CfiStepToken } from './parse';

// Id-like assertion alphabet (what epubjs emits from element ids). Spec-exotic
// assertions (slashes, commas, escapes) are exercised by the tokenizer
// round-trip (E1); the string fast paths are only CLAIMED — and therefore only
// pinned — on this realistic family.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-';

function genStep(rng: SeededRandom, withAssertion = rng.next() < 0.3): CfiStepToken {
    const step: CfiStepToken = { kind: 'step', index: rng.nextInt(1, 98) };
    if (withAssertion) {
        return { ...step, assertion: rng.nextString(rng.nextInt(1, 8), ID_CHARS) };
    }
    return step;
}

/** A structured point-CFI token sequence: spine steps, `!`, content steps, optional offset. */
function genPointTokens(rng: SeededRandom, opts: { offset?: boolean } = {}): CfiToken[] {
    const tokens: CfiToken[] = [];
    const spineSteps = rng.nextInt(1, 3);
    for (let i = 0; i < spineSteps; i++) tokens.push(genStep(rng));
    tokens.push({ kind: 'indirection' });
    const contentSteps = rng.nextInt(1, 6);
    for (let i = 0; i < contentSteps; i++) tokens.push(genStep(rng));
    const withOffset = opts.offset ?? rng.nextBool();
    if (withOffset) tokens.push({ kind: 'offset', value: rng.nextInt(0, 500) });
    return tokens;
}

const wrap = (tokens: ReadonlyArray<CfiToken>) => `epubcfi(${serializeCfiTokens(tokens)})`;

/** `epubcfi(P,S,E)` from a parent token path and two relative extensions. */
function genRangeFromParent(rng: SeededRandom, parent: ReadonlyArray<CfiToken>): string {
    const rel = () => {
        const steps: CfiToken[] = [];
        const n = rng.nextInt(1, 2);
        for (let i = 0; i < n; i++) steps.push(genStep(rng, false));
        steps.push({ kind: 'offset', value: rng.nextInt(0, 200) });
        return serializeCfiTokens(steps);
    };
    return `epubcfi(${serializeCfiTokens(parent)},${rel()},${rel()})`;
}

/** Semantic range equality: same parent-resolved start/end points. */
function expectCfiEquivalent(actual: string | null, expected: string | null, ctx: string) {
    if (actual === null || expected === null) {
        expect(actual, ctx).toBe(expected);
        return;
    }
    const pa = parseCfiRange(actual);
    const pe = parseCfiRange(expected);
    expect(pa, `${ctx} — actual not a range: ${actual}`).not.toBeNull();
    expect(pe, `${ctx} — expected not a range: ${expected}`).not.toBeNull();
    expect(pa!.fullStart, ctx).toBe(pe!.fullStart);
    expect(pa!.fullEnd, ctx).toBe(pe!.fullEnd);
}

describe('cfi kernel — property equivalence vs the parsed reference', () => {
    it('E1: tokenizer round-trips structured CFIs (2000 cases)', () => {
        const rng = new SeededRandom(DEFAULT_FUZZ_SEED);
        for (let i = 0; i < 2000; i++) {
            const tokens = genPointTokens(rng);
            const s = wrap(tokens);
            const reparsed = parseCfiTokens(s);
            expect(reparsed, `case ${i}: ${s}`).toEqual(tokens);
        }
    });

    it('E1b: tokenizer round-trips ^-escaped exotic assertions (1000 cases)', () => {
        const rng = new SeededRandom(DEFAULT_FUZZ_SEED + 1);
        const EXOTIC = ID_CHARS + '^[](),;=/:! ';
        for (let i = 0; i < 1000; i++) {
            const tokens: CfiToken[] = [
                { kind: 'step', index: rng.nextInt(1, 20) },
                { kind: 'step', index: rng.nextInt(1, 20), assertion: rng.nextString(rng.nextInt(1, 10), EXOTIC) },
                { kind: 'indirection' },
                { kind: 'step', index: rng.nextInt(1, 20) },
            ];
            const s = wrap(tokens);
            expect(parseCfiTokens(s), `case ${i}: ${s}`).toEqual(tokens);
        }
    });

    it('E2: tryFastMergeCfi agrees with mergeCfiSlow or declines (4000 cases)', () => {
        const rng = new SeededRandom(DEFAULT_FUZZ_SEED + 2);
        for (let i = 0; i < 4000; i++) {
            const family = rng.nextInt(0, 3);
            let left: string;
            let right: string;
            const parent = genPointTokens(rng, { offset: false });
            switch (family) {
                case 0: // range + range, shared parent
                    left = genRangeFromParent(rng, parent);
                    right = genRangeFromParent(rng, parent);
                    break;
                case 1: // range + point child
                    left = genRangeFromParent(rng, parent);
                    right = wrap([...parent, genStep(rng, false), { kind: 'offset', value: rng.nextInt(0, 200) }]);
                    break;
                case 2: // point + point, shared path
                    left = wrap([...parent, { kind: 'offset', value: rng.nextInt(0, 100) }]);
                    right = wrap([...parent, { kind: 'offset', value: rng.nextInt(100, 300) }]);
                    break;
                default: // unrelated
                    left = wrap(genPointTokens(rng));
                    right = wrap(genPointTokens(rng));
                    break;
            }
            const fast = tryFastMergeCfi(left, right);
            if (fast !== null) {
                const slow = mergeCfiSlow(left, right);
                expectCfiEquivalent(fast, slow, `case ${i} family ${family}: ${left} + ${right}`);
            }
        }
    });

    it('E3: getParentCfi agrees with the parsed oracle on points and ranges (3000 cases)', () => {
        const rng = new SeededRandom(DEFAULT_FUZZ_SEED + 3);
        for (let i = 0; i < 3000; i++) {
            const parent = genPointTokens(rng, { offset: false });
            const cfi = rng.nextBool()
                ? wrap(rng.nextBool() ? parent : [...parent, { kind: 'offset', value: rng.nextInt(0, 500) }])
                : genRangeFromParent(rng, parent);
            const fast = getParentCfi(cfi);
            const oracle = getParentCfiParsed(cfi);
            expect(oracle, `case ${i}: oracle declined structured CFI ${cfi}`).not.toBeNull();
            expect(fast, `case ${i}: ${cfi}`).toBe(oracle);
        }
    });

    it('E4: cfiContains agrees with the parsed oracle (4000 cases)', () => {
        const rng = new SeededRandom(DEFAULT_FUZZ_SEED + 4);
        for (let i = 0; i < 4000; i++) {
            const parentTokens = genPointTokens(rng, { offset: false });
            const parent = wrap(parentTokens);
            const family = rng.nextInt(0, 3);
            let child: string;
            switch (family) {
                case 0: { // structural descendant: extra steps / offset
                    const ext: CfiToken[] = [];
                    const n = rng.nextInt(0, 3);
                    for (let k = 0; k < n; k++) ext.push(genStep(rng));
                    if (rng.nextBool() || n === 0) ext.push({ kind: 'offset', value: rng.nextInt(0, 300) });
                    child = wrap([...parentTokens, ...ext]);
                    break;
                }
                case 1: { // assertion-bracket child: same leaf step, assertion added
                    const last = parentTokens[parentTokens.length - 1] as CfiStepToken;
                    if (last.kind === 'step' && last.assertion === undefined) {
                        child = wrap([
                            ...parentTokens.slice(0, -1),
                            { ...last, assertion: rng.nextString(rng.nextInt(1, 6), ID_CHARS) },
                        ]);
                    } else {
                        child = wrap(parentTokens);
                    }
                    break;
                }
                case 2: { // sibling / prefix trap: leaf index gets a digit appended (…/2 vs …/21)
                    const last = parentTokens[parentTokens.length - 1] as CfiStepToken;
                    child = wrap([
                        ...parentTokens.slice(0, -1),
                        { kind: 'step', index: Number(`${last.index}${rng.nextInt(0, 9)}`) },
                    ]);
                    break;
                }
                default: // unrelated
                    child = wrap(genPointTokens(rng));
                    break;
            }
            const fast = cfiContains(parent, child);
            const oracle = cfiContainsParsed(parent, child);
            expect(oracle, `case ${i}: oracle declined ${parent} / ${child}`).not.toBeNull();
            expect(fast, `case ${i} family ${family}: ${parent} ⊇? ${child}`).toBe(oracle);
        }
    });

    it('E4 counterexamples: the legacy ACP separator set mis-grouped assertion-bracket and range children', () => {
        // The inline copies in AudioContentPipeline used ['/', '!', ':'] — these
        // two cases are exactly what '[' and ',' add (content debt D9 / S17).
        const parent = 'epubcfi(/6/14!/4/10)';
        expect(cfiContains(parent, 'epubcfi(/6/14!/4/10[note])')).toBe(true);
        expect(cfiContains(parent, 'epubcfi(/6/14!/4/10,/1:0,/3:2)')).toBe(true);
        expect(cfiContainsParsed(parent, 'epubcfi(/6/14!/4/10[note])')).toBe(true);
        expect(cfiContainsParsed(parent, 'epubcfi(/6/14!/4/10,/1:0,/3:2)')).toBe(true);
        // Prefix trap stays excluded under THE set:
        expect(cfiContains(parent, 'epubcfi(/6/14!/4/100)')).toBe(false);
        expect(cfiContainsParsed(parent, 'epubcfi(/6/14!/4/100)')).toBe(false);
    });

    it('E3 quirk pin: spine-only CFIs (no indirection) keep the legacy `!`-append behavior', () => {
        // Characterization, not design: the legacy string path treats the whole
        // content as a spine component when no '!' is present. The parsed
        // oracle is not consulted for this family (the structured arbitrary
        // always includes an indirection, like every real book CFI).
        expect(getParentCfi('epubcfi(/6/14)')).toBe('epubcfi(/6/14!)');
    });
});
