/**
 * The ONE app-layer implementation of the EngineContext `GenAIPort` call
 * surface over the `@domains/google` GenAI client. Both engine transports —
 * createZustandEngineContext for the main thread and
 * createWorkerEngineClient's host commands for the worker — consume THIS
 * module.
 *
 * First-use splitting discipline: the feature modules load on FIRST CALL via
 * deep dynamic imports — this module rides the entry chunk (TTS engine
 * graph), so static feature-value imports here would drag the whole GenAI
 * feature layer into it (check 4 of scripts/check-worker-chunk.mjs asserts it
 * stays out). Deep module paths (not the domain index) keep the async chunks
 * separate.
 *
 * `bookId` in the call contexts flows through the feature modules into the
 * GeminiClient request context, where the NetworkGateway's per-book consent
 * gate reads it (app/google/aiConsent.ts).
 */
import type { ContentType } from '~types/content-analysis';
import { getGenAIClient } from '@domains/google';

export function genAIIsConfigured(): boolean {
  return getGenAIClient().isConfigured();
}

/**
 * @deprecated No-op, kept only because the EngineContext port still carries
 * `configure` (ensureGenAIReady calls it when the client is unconfigured):
 * config is read per call from the composition-root provider (useGenAIStore),
 * so this setter can no longer clobber the live model selection. It goes away
 * when the port itself is narrowed.
 */
export function genAIConfigure(apiKey: string, model: string): void {
  void apiKey;
  void model;
}

/** Classify content groups (feature: referenceDetection). */
export async function genAIDetectContentTypes(
  nodes: { id: string; sampleText: string; leadsWithMarker?: boolean }[],
  hints: { enumeratorCandidate: number; leadingMarkerCandidate: number },
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string; correlationId?: string },
): Promise<{
  classifications: { id: string; type: ContentType }[];
  justification: string;
  agreedWithHeuristic: boolean | null;
}> {
  const { detectReferenceSection } = await import(
    '@domains/google/genai/features/referenceDetection'
  );
  const result = await detectReferenceSection(getGenAIClient(), nodes, hints, context);
  return {
    // The ContentType union is single-variant ('reference'); the pipeline
    // filters on it — 'main' rows pass through the cast unchanged.
    classifications: result.classifications.map((c) => ({
      id: c.id,
      type: c.type as ContentType,
    })),
    justification: result.justification,
    agreedWithHeuristic: result.agreedWithHeuristic,
  };
}

/** Table-image narration (feature: tableAdaptation). */
export async function genAIGenerateTableAdaptations(
  nodes: { rootCfi: string; imageBlob: Blob }[],
  thinkingBudget: number,
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string; correlationId?: string },
): Promise<{ cfi: string; adaptation: string }[]> {
  const { generateTableAdaptations } = await import(
    '@domains/google/genai/features/tableAdaptation'
  );
  return generateTableAdaptations(getGenAIClient(), nodes, thinkingBudget, context);
}
