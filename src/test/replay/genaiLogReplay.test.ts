/**
 * The GenAI log replay tool: a synthetic export keeps the parser and the
 * metrics honest in CI; with GENAI_LOG_PATH set the real export is replayed
 * and the report printed (see genaiLogReplay.ts for the invocation).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatReplayReport,
  nodesFromPrompt,
  parseGenAILogExport,
  replayGenAILog,
} from './genaiLogReplay';

/** One entry in the exact "Download GenAI logs" export format. */
function entry(iso: string, type: string, method: string, payload: unknown, cid?: string): string {
  const header = `[${iso}] ${type} (${method})${cid ? ` cid=${cid}` : ''} `;
  return `${header}\n${JSON.stringify(payload, null, 2)}\n${'-'.repeat(40)} \n`;
}

function detectionPrompt(groups: { id: number; sampleText: string; leadsWithMarker?: boolean }[]): string {
  return `You will be provided an array of text groups…\n\nGroups:\n${JSON.stringify(groups)}`;
}

const NARRATIVE_10 = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  sampleText: i < 7 ? `Body paragraph ${i}.` : `[${i - 6}] Author, Title, 2001.`,
}));
const END_NOTES_7 = [
  { id: 0, sampleText: 'End Notes.' },
  ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, sampleText: `${i + 1} Author, Title, Publisher, 2001.` })),
];
const TINY_3 = [
  { id: 0, sampleText: 'Resources.' },
  { id: 1, sampleText: 'A short line.' },
  { id: 2, sampleText: 'Another short line.' },
];
/** Six body groups, then four endnotes that each open with a citation marker (a linked note tail at 60%). */
const LINKED_NOTES_10 = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  sampleText: i < 6 ? `Body paragraph ${i}.` : `Author, Title (Publisher, 2001), ${i}.`,
  ...(i >= 6 ? { leadsWithMarker: true } : {}),
}));

const SYNTHETIC_EXPORT = [
  // A: accepted answer (index 7 of 10), telemetry follows the response.
  entry('2026-07-02T17:05:59.757Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(NARRATIVE_10),
    schema: {},
    model: 'gemini-3.5-flash',
  }),
  // C: a tiny section fired in the same second as A, never answered.
  entry('2026-07-02T17:05:59.900Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(TINY_3),
    schema: {},
    model: 'gemini-3.5-flash',
  }),
  entry('2026-07-02T17:06:05.000Z', 'RESPONSE', 'detectContentTypes', {
    text: '{"referenceStartIndex": 7}',
    parsed: { justification: 'tail of citations', referenceStartIndex: 7, agreedWithHeuristic: true },
  }),
  entry('2026-07-02T17:06:05.010Z', 'RESPONSE', 'detectReferenceStart', {
    bookId: 'b',
    sectionId: 's',
    groupCount: 10,
    justification: 'tail of citations',
    perGroup: [],
  }),
  // B: the "End Notes" section rejected by the old 40% guard, then re-sent the next day and rejected again.
  entry('2026-07-12T15:40:18.000Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(END_NOTES_7),
    schema: {},
    model: 'gemini-3.5-flash',
  }),
  entry('2026-07-12T15:40:34.000Z', 'ERROR', 'detectContentTypes', {
    message: 'Response failed validation',
    error: 'referenceStartIndex 0 is before 40% of chapter (7 groups) — likely false positive',
  }),
  entry('2026-07-13T00:42:51.000Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(END_NOTES_7),
    schema: {},
    model: 'gemini-3.5-flash',
  }),
  entry('2026-07-13T00:43:19.000Z', 'ERROR', 'detectContentTypes', {
    message: 'Response failed validation',
    error: 'referenceStartIndex 0 is before 40% of chapter (7 groups) — likely false positive',
  }),
  // D/E: the Oct 2026 shape — a linked-note-tail section whose model call died on a
  // head-model 503, re-sent after the detector's retry delay and lost to a timeout.
  entry('2026-10-08T00:26:57.849Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(LINKED_NOTES_10),
    schema: {},
    model: 'gemini-3.8-flash',
  }, 'cid-503'),
  entry('2026-10-08T00:27:02.553Z', 'ERROR', 'detectContentTypes', {
    message: 'Request failed',
    model: 'gemini-3.8-flash',
    error: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    name: 'GenAIHttpError',
    code: 'GENAI_UNKNOWN',
    retryable: true,
    aborted: false,
    status: 503,
    apiStatus: 'UNAVAILABLE',
  }, 'cid-503'),
  entry('2026-10-08T00:44:10.841Z', 'REQUEST', 'detectContentTypes', {
    prompt: detectionPrompt(LINKED_NOTES_10),
    schema: {},
    model: 'gemini-3.8-flash',
  }, 'cid-timeout'),
  entry('2026-10-08T00:45:10.841Z', 'ERROR', 'detectContentTypes', {
    message: 'Request failed',
    model: 'gemini-3.8-flash',
    error: 'Egress to "gemini" timed out after 60000ms.',
    name: 'NetTimeoutError',
    code: 'NET_TIMEOUT',
    retryable: true,
    aborted: false,
  }, 'cid-timeout'),
  // F: an answer whose request was evicted from the ring buffer before the export.
  entry('2026-10-08T00:07:37.114Z', 'RESPONSE', 'detectContentTypes', {
    text: '{"referenceStartIndex": 173}',
    parsed: { justification: 'numbered endnotes from group 173', referenceStartIndex: 173 },
    model: 'gemini-3.8-flash',
  }, 'cid-evicted'),
  entry('2026-10-08T00:07:37.122Z', 'RESPONSE', 'detectReferenceStart', {
    bookId: 'b',
    sectionId: 'chapter3.xhtml',
    groupCount: 262,
    justification: 'numbered endnotes from group 173',
    perGroup: [],
  }, 'cid-evicted'),
  // Embedding: two daily-cap errors 91 s apart, then a per-minute burst of three.
  entry('2026-07-07T17:00:33.000Z', 'ERROR', 'embedOne', {
    message: 'Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_requests, limit: 1000, model: gemini-embedding-2',
    status: 429,
  }),
  entry('2026-07-07T17:02:04.000Z', 'ERROR', 'embedOne', {
    message: 'Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_requests, limit: 1000, model: gemini-embedding-2',
    status: 429,
  }),
  entry('2026-09-03T14:07:15.000Z', 'ERROR', 'embedOne', { message: 'Resource exhausted. Please try again later.', status: 429 }),
  entry('2026-09-03T14:07:20.000Z', 'ERROR', 'embedOne', { message: 'Resource exhausted. Please try again later.', status: 429 }),
  entry('2026-09-03T14:07:25.000Z', 'ERROR', 'embedOne', { message: 'Resource exhausted. Please try again later.', status: 429 }),
  // Tables: one request with an empty MIME type (silent failure), one that narrated an illustration.
  entry('2026-07-24T01:28:51.000Z', 'REQUEST', 'generateTableAdaptations', {
    prompt: { contents: [{ role: 'user', parts: [{ inlineData: { byteCount: 1, hash: 'x', mimeType: '', redacted: true } }] }] },
    model: 'gemini-3.5-flash',
  }),
  entry('2026-08-01T22:43:37.000Z', 'REQUEST', 'generateTableAdaptations', {
    prompt: { contents: [{ role: 'user', parts: [{ inlineData: { byteCount: 1, hash: 'y', mimeType: 'image/webp', redacted: true } }] }] },
    model: 'gemini-3.6-flash',
  }),
  entry('2026-08-01T22:43:41.000Z', 'RESPONSE', 'generateTableAdaptations', {
    text: '[]',
    parsed: [{ cfi: 'epubcfi(/6/20!/4/52)', adaptation: 'An illustration featuring Isaac Newton, accompanied by a quote.' }],
  }),
].join('\n');

describe('GenAI log replay (synthetic export)', () => {
  it('parses the export format, including the new cid/book/section header fields', () => {
    const entries = parseGenAILogExport(SYNTHETIC_EXPORT);
    expect(entries).toHaveLength(22);
    expect(entries[0]).toMatchObject({ type: 'REQUEST', method: 'detectContentTypes', timestamp: Date.parse('2026-07-02T17:05:59.757Z') });

    const withContext = parseGenAILogExport(
      '[2026-09-08T15:10:46.381Z] REQUEST (detectContentTypes) cid=abc-123 book="A \\"quoted\\" title" section="Chapter 3" \n{"prompt":"p"}\n' +
        '-'.repeat(40) + ' \n',
    );
    expect(withContext[0]).toMatchObject({ correlationId: 'abc-123', bookTitle: 'A "quoted" title', sectionTitle: 'Chapter 3' });
  });

  it('rebuilds the validator nodes from the prompt', () => {
    const nodes = nodesFromPrompt(detectionPrompt(END_NOTES_7));
    expect(nodes).toHaveLength(7);
    expect(nodes?.[0]).toEqual({ id: '0', sampleText: 'End Notes.' });
  });

  it('measures what the current code changes', () => {
    const report = replayGenAILog(parseGenAILogExport(SYNTHETIC_EXPORT));
    const d = report.detection;
    expect(d.requests).toBe(6);
    expect(d.attempts).toBe(6);
    expect(d.uniqueSections).toBe(4);
    expect(d.outcomes).toEqual({ accepted: 1, rejected: 2, failed: 2, silent: 1 });
    // The validator without the 40% guard accepts everything it accepted before AND both rejected answers.
    expect(d.validator).toMatchObject({ acceptedBefore: 1, acceptedAfter: 1, rejectedBefore: 2, rejectedAfterOfThose: 0, newlyRejected: 0 });
    expect(d.validator.rejectedCases.every((c) => c.acceptedNow)).toBe(true);
    // Terminal failures are counted by what the server (or the gateway) said, per model,
    // and a section re-sent to the same outcome is visible as such.
    expect(d.failures).toEqual({
      total: 2,
      byKind: { '503 UNAVAILABLE': 1, NET_TIMEOUT: 1 },
      byModel: { 'gemini-3.8-flash': 2 },
      sectionsRetried: 1,
    });
    // A correlated answer with no request behind it is an orphan, never paired by guesswork.
    expect(d.orphanedResponses).toEqual([
      { at: '2026-10-08T00:07:37.114Z', correlationId: 'cid-evicted', model: 'gemini-3.8-flash', referenceStartIndex: 173 },
    ]);
    // Both failed attempts carried a linked note tail from group 6 of 10: answered locally now.
    expect(d.leadingMarkerFastPath).toEqual({ requests: 2, sections: 1 });
    expect(d.tinySectionRequests).toBe(1);
    expect(d.rejectedResends).toBe(1);
    expect(d.sameInstantRequests).toBe(1);
    expect(d.requestsAfter).toBe(2);
    expect(d.quota.headModelRpd).toBe(20);
    expect(d.quota.rotationCapacityRpd).toBe(1140);

    expect(report.embedding.clusters.map((c) => [c.kind, c.count, c.requestsUnderPolicy])).toEqual([
      ['daily-quota', 2, 1],
      ['per-minute', 3, 1],
    ]);
    expect(report.tables).toMatchObject({ requests: 2, responses: 1, emptyMimeRequests: 1 });
    expect(report.tables.narrationsByText[0].looksLikeTable).toBe(false);
    const text = formatReplayReport(report);
    expect(text).toContain('requests after .............. 2');
    expect(text).toContain('terminal failures ........... 2: 503 UNAVAILABLE ×1, NET_TIMEOUT ×1 — by model gemini-3.8-flash ×2; 1 sections re-sent');
    expect(text).toContain('orphaned responses .......... 1');
    expect(text).toContain('linked-note-tail fast path .. 2 requests (1 sections)');
  });
});

const LOG_PATH = process.env.GENAI_LOG_PATH;

describe.skipIf(!LOG_PATH)('GenAI log replay (real export from GENAI_LOG_PATH)', () => {
  it('replays the export and prints the report', () => {
    const entries = parseGenAILogExport(readFileSync(LOG_PATH!, 'utf8'));
    const report = replayGenAILog(entries);
    const text = formatReplayReport(report);
    console.log(`\n${text}\n`);
    // GENAI_REPLAY_OUT=/path/report.json also writes the readable report next
    // to it as report.txt (the test harness swallows console output).
    const out = process.env.GENAI_REPLAY_OUT;
    if (out) {
      writeFileSync(out, JSON.stringify(report, null, 2));
      writeFileSync(`${out.replace(/\.json$/, '')}.txt`, `${text}\n`);
    }
    expect(report.detection.attempts).toBeGreaterThan(0);
    // The regression claims of the fix set, checked against the real answers:
    expect(report.detection.validator.newlyRejected).toBe(0);
    expect(report.detection.validator.rejectedAfterOfThose).toBe(0);
  });
});
