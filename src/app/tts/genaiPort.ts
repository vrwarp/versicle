/**
 * The ONE app-layer implementation of the EngineContext `GenAIPort` call
 * surface over the Phase 7 domain client (P9: the deprecated
 * `lib/genai/GenAIService` façade is deleted; both engine transports —
 * createZustandEngineContext for the main thread and
 * createWorkerEngineClient's host commands for the worker — consume THIS
 * module instead).
 *
 * Phase 8 §A first-use splitting discipline (inherited from the façade):
 * the feature modules load on FIRST CALL via deep dynamic imports — this
 * module rides the entry chunk (TTS engine graph), so static feature-value
 * imports here would drag the whole GenAI feature layer into it (check 4 of
 * scripts/check-worker-chunk.mjs asserts it stays out). Deep module paths
 * (not the domain index) keep the async chunks separate.
 *
 * `bookId` in the call contexts flows through the feature modules into the
 * GeminiClient request context, where the NetworkGateway's per-book consent
 * gate reads it (app/google/aiConsent.ts) — the P7 §Follow-ups item-3
 * threading.
 */
import type { ContentType } from '~types/content-analysis';
import { getGenAIClient } from '@domains/google';

export function genAIIsConfigured(): boolean {
  return getGenAIClient().isConfigured();
}

/**
 * @deprecated No-op, kept only because the EngineContext port still carries
 * `configure` (the legacy pipeline calls it before analysis): config is read
 * per call from the composition-root provider (useGenAIStore), so this legacy
 * setter can no longer clobber the live model selection. Narrowing the port
 * itself is the P9 deletion-audit item's call.
 */
export function genAIConfigure(apiKey: string, model: string): void {
  void apiKey;
  void model;
}

/** Classify content groups (feature: referenceDetection). */
export async function genAIDetectContentTypes(
  nodes: { id: string; sampleText: string; leadsWithMarker?: boolean }[],
  hints: { enumeratorCandidate: number },
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string },
): Promise<{
  classifications: { id: string; type: ContentType }[];
  justification: string;
  agreedWithHeuristic: boolean;
}> {
  const { detectReferenceSection } = await import(
    '@domains/google/genai/features/referenceDetection'
  );
  const result = await detectReferenceSection(getGenAIClient(), nodes, hints, context);
  return {
    // The legacy ContentType union is single-variant ('reference'); the
    // pipeline filters on it — 'main' rows pass through exactly as before.
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
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string },
): Promise<{ cfi: string; adaptation: string }[]> {
  const { generateTableAdaptations } = await import(
    '@domains/google/genai/features/tableAdaptation'
  );
  return generateTableAdaptations(getGenAIClient(), nodes, thinkingBudget, context);
}
