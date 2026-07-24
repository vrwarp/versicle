/**
 * End-of-chapter reference-section detection (Phase 7 §H feature module).
 *
 * The prompt-minimization technique is preserved VERBATIM (a named keeper):
 * asymmetric truncation (front 60% to ~8 words, tail 40% to ~120 chars),
 * sparse leadsWithMarker flags, deterministic enumerator hint with forced
 * agree/disagree justification.
 *
 * The GG-5 clamp: `referenceStartIndex` must be an integer in [-1, n-1] —
 * the legacy mapping treated ANY non-(-1) value as a valid start, so a
 * model returning -2 flagged EVERY group as reference and poisoned the
 * synced contentAnalysis map. Out-of-range now throws
 * GENAI_INVALID_RESPONSE and the callers' status:'error' machinery handles
 * it.
 */
import { z } from 'zod';
import { GenAIInvalidResponseError } from '../errors';
import { SchemaType, type GenAIClient } from '../contract';

/** Single-variant union today (matches ~types/content-analysis). */
type DetectedContentType = 'reference' | 'main';

export interface ReferenceDetectionNode {
  id: string;
  sampleText: string;
  leadsWithMarker?: boolean;
}

export interface ReferenceDetectionResult {
  classifications: { id: string; type: DetectedContentType }[];
  justification: string;
  agreedWithHeuristic: boolean;
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trimStart().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '…';
}

function truncateChars(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.lastIndexOf(' ', maxChars);
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, maxChars)) + '…';
}

const responseZod = z.object({
  justification: z.string(),
  referenceStartIndex: z.number(),
  agreedWithHeuristic: z.boolean(),
});

/**
 * Matches text that IS a references heading — the entire string is the heading
 * (plus trailing punctuation), never merely prefixed by it, so a chapter titled
 * "Notes from Underground" can't match while "End Notes." does.
 */
const REFERENCES_HEADING_RE =
  /^(?:end\s?notes?|footnotes?|notes|references|reference\s+list|bibliography|works\s+cited|citations?|sources)\s*[.:]?$/i;

/** Minimum leadsWithMarker density (and absolute count) for the endnote-block exemption. */
const MARKER_RUN_MIN_FRACTION = 0.6;
const MARKER_RUN_MIN_COUNT = 3;

/**
 * Whether an early-chapter referenceStartIndex is corroborated by structural
 * evidence that the claimed span really is a reference block — the
 * dedicated-endnotes-section case the positional guard used to reject
 * (observed: a 7-group section titled "End Notes" whose entire body is
 * numbered citations; the model's correct index 0 failed the 40% guard on
 * every revisit, burning quota without ever converging).
 */
function isCorroboratedReferenceBlock(
  index: number,
  nodes: ReferenceDetectionNode[],
  sectionTitle?: string,
): boolean {
  if (sectionTitle && REFERENCES_HEADING_RE.test(sectionTitle.trim())) return true;
  // The group at the claimed start is itself a references heading.
  const startText = nodes[index]?.sampleText.trim();
  if (startText && REFERENCES_HEADING_RE.test(startText)) return true;
  // The claimed span is dominated by groups that open with citation anchors.
  const span = nodes.slice(index);
  const leading = span.filter((n) => n.leadsWithMarker).length;
  return leading >= MARKER_RUN_MIN_COUNT && leading / span.length >= MARKER_RUN_MIN_FRACTION;
}

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    justification: { type: SchemaType.STRING },
    referenceStartIndex: { type: SchemaType.INTEGER },
    agreedWithHeuristic: { type: SchemaType.BOOLEAN },
  },
  required: ['justification', 'referenceStartIndex', 'agreedWithHeuristic'],
};

function buildPrompt(
  nodes: ReferenceDetectionNode[],
  hints: { enumeratorCandidate: number },
): string {
  const n = nodes.length;
  const splitPoint = Math.ceil(n * 0.6);

  const renderedNodes = nodes.map((node, i) => {
    const isTail = i >= splitPoint;
    const raw = node.sampleText;
    const sampleText = isTail ? truncateChars(raw, 120) : truncateWords(raw, 8);
    const entry: Record<string, unknown> = { id: parseInt(node.id, 10), sampleText };
    // A group flagged leadsWithMarker begins with a citation anchor — typical of a footnote
    // or endnote entry that opens with its reference number/symbol.
    if (node.leadsWithMarker) entry.leadsWithMarker = true;
    return entry;
  });

  const hintLines: string[] = [];
  if (hints.enumeratorCandidate >= 0) {
    hintLines.push(
      `- HINT A (enumerated bibliography): Group ${hints.enumeratorCandidate} starts a consecutive run of numbered entries (e.g. "[1] Author…"). This pattern suggests a bibliography-style reference section starting there.`,
    );
  }
  const hintSection =
    hintLines.length > 0
      ? `\n### Hints from deterministic analysis (candidates, not ground truth):\n${hintLines.join('\n')}\nIn your justification, explicitly state whether you agree or disagree with each hint and why.\n`
      : '';

  return `You will be provided an array of text groups from an EPUB book section, ordered as they appear in the book.
Your task is to identify where the end-of-chapter "references" section begins. References include footnotes, bibliographies, citations, or endnotes.

A group may carry "leadsWithMarker": true, meaning that group BEGINS with a citation anchor/marker
(e.g. a footnote or endnote entry that opens with its reference number or symbol). A run of such
groups at the end of the section is a strong indicator of an endnote/footnote block — even when the
entries have no visible enumerator in the sample text.

### Task:
Find the index of the first group that clearly marks the beginning of the references section.
Once the references section begins, everything after it is also references.
If there is no references section at the end, return -1.
${hintSection}
Groups:
${JSON.stringify(renderedNodes)}`;
}

export function validateReferenceDetection(
  raw: unknown,
  nodes: ReferenceDetectionNode[],
  context?: { sectionTitle?: string },
): z.infer<typeof responseZod> {
  const nodeCount = nodes.length;
  const parsed = responseZod.safeParse(raw);
  if (!parsed.success) {
    throw new GenAIInvalidResponseError(
      'Reference-detection response failed schema validation',
      { issues: parsed.error.issues.slice(0, 5).map((i) => i.message) },
    );
  }
  const index = parsed.data.referenceStartIndex;
  if (!Number.isInteger(index) || index < -1 || index >= nodeCount) {
    throw new GenAIInvalidResponseError(
      `referenceStartIndex ${index} is outside [-1, ${nodeCount - 1}]`,
      { referenceStartIndex: index, nodeCount },
    );
  }
  // Positional guard: a reference section beginning before 40% of the chapter
  // is almost certainly a false positive (e.g. epigraph attributions). The
  // deterministic detector uses 60%; we are more lenient for the model but
  // still catch extreme early-chapter misclassifications. Exception: a
  // dedicated notes/bibliography section legitimately starts near index 0 —
  // accept an early index when the section title, the start group's own text,
  // or a dense leadsWithMarker run corroborates it.
  const MIN_POSITION_FRACTION = 0.4;
  if (
    index >= 0 &&
    nodeCount > 5 &&
    index < nodeCount * MIN_POSITION_FRACTION &&
    !isCorroboratedReferenceBlock(index, nodes, context?.sectionTitle)
  ) {
    throw new GenAIInvalidResponseError(
      `referenceStartIndex ${index} is before 40% of chapter (${nodeCount} groups) — likely false positive`,
      { referenceStartIndex: index, nodeCount, positionFraction: index / nodeCount },
    );
  }
  return parsed.data;
}

export async function detectReferenceSection(
  client: GenAIClient,
  nodes: ReferenceDetectionNode[],
  hints: { enumeratorCandidate: number },
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string },
): Promise<ReferenceDetectionResult> {
  if (nodes.length === 0) {
    return { classifications: [], justification: '', agreedWithHeuristic: false };
  }

  const result = await client.generateStructured({
    method: 'detectContentTypes',
    prompt: buildPrompt(nodes, hints),
    responseSchema,
    validate: (raw) =>
      validateReferenceDetection(raw, nodes, { sectionTitle: context?.sectionTitle }),
    context,
  });

  const startIndex = result.referenceStartIndex;
  const classifications = nodes.map((node, index) => ({
    id: node.id,
    type: (startIndex !== -1 && index >= startIndex
      ? 'reference'
      : 'main') as DetectedContentType,
  }));

  return {
    classifications,
    justification: result.justification,
    agreedWithHeuristic: result.agreedWithHeuristic,
  };
}
