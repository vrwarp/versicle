/**
 * @deprecated Phase 7 façade (§H) — the GenAI implementation lives at
 * `src/domains/google/genai/` (GeminiClient over the NetworkGateway +
 * per-feature modules owning prompt/zod-schema/validation). This module
 * keeps the legacy singleton surface compiling and behaving for its
 * consumers — the app/tts EngineContext adapters (isConfigured/configure/
 * detectContentTypes/generateTableAdaptations), useSmartTOC,
 * SmartLinkDialog, ReadingListDialog — and delegates everything to
 * `getGenAIClient()`.
 *
 * What changed behind the unchanged surface:
 *  - The three `localStorage.getItem('mockGenAIResponse')` production
 *    seams in THIS module are DELETED (GG-4/privacy D9): E2E mocks install
 *    a MockGenAIClient via `window.__versicleTest.genai.setMock(...)`
 *    (src/test-api.ts, DEV/VITE_E2E builds only). The last remaining read
 *    (the 5c chain's genaiReady.ts DEV-gated seam — AudioContentPipeline
 *    itself died at 5c-PR2) was deleted at the Phase 7 merge: nothing sets
 *    the key anywhere.
 *  - `configure()` is a NO-OP: the client reads config per call from the
 *    composition-root provider (useGenAIStore), so the TTS pipeline's
 *    hardcoded `configure(apiKey, 'gemini-1.5-flash')` clobber is
 *    structurally impossible (GG-8). The port keeps the method until P5c
 *    narrows EngineContext.
 *  - Structured responses are validated (zod + membership/range clamps,
 *    GG-5); out-of-contract output throws GENAI_INVALID_RESPONSE.
 *
 * Deletion deadline: Phase 7 exit window of the parallel chain — direct
 * client adoption by consumers is later work; the façade stays until then.
 */
import type { ContentType } from '~types/content-analysis';
import { getGenAIClient } from '@domains/google';
import type { GenAILogEntry, GenAIPrompt } from '@domains/google';
import { createLogger } from '../logger';

// Phase 8 §A first-use splitting: the feature modules (tocTitles,
// referenceDetection, tableAdaptation, libraryMapping) load on FIRST CALL
// via deep dynamic imports — this façade rides the entry chunk (TTS engine
// graph), so static feature-value imports here would drag the whole GenAI
// feature layer into it (check 4 of scripts/check-worker-chunk.mjs asserts
// it stays out). Deep module paths (not the domain index) keep the async
// chunks separate from the statically-imported index.

export type { GenAILogEntry };

const logger = createLogger('GenAIService');

let warnedConfigure = false;

class GenAIService {
  /**
   * @deprecated No-op. Config is read per call from the composition-root
   * provider (useGenAIStore) — see the module header. Kept so the
   * EngineContext port (frozen until P5c) keeps compiling and the legacy
   * pipeline clobber does nothing.
   */
  public configure(apiKey: string, model: string, enableRotation: boolean = false): void {
    void apiKey;
    void model;
    void enableRotation;
    if (!warnedConfigure && import.meta.env.DEV) {
      warnedConfigure = true;
      logger.warn(
        'genAIService.configure() is deprecated and a no-op — config is read per call from useGenAIStore.',
      );
    }
  }

  /**
   * @deprecated No-op. The activity-log sink is wired at the composition
   * root (app/google/wireGoogle.ts → useGenAIStore.addLog, pre-redacted).
   */
  public setLogCallback(callback: (entry: GenAILogEntry) => void): void {
    void callback;
  }

  public isConfigured(): boolean {
    return getGenAIClient().isConfigured();
  }

  public async generateContent(
    prompt: string,
    context?: { bookTitle?: string; sectionTitle?: string },
  ): Promise<string> {
    return getGenAIClient().generateText(prompt, context);
  }

  /**
   * Legacy generic passthrough (no consumers outside this module's feature
   * methods at HEAD; kept for surface compatibility). Identity "validation"
   * only — use the feature modules for contract-checked calls.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async generateStructured<T>(prompt: string | any, schema: any, generationConfigOverride?: any, context?: { bookTitle?: string, sectionTitle?: string, correlationId?: string }): Promise<T> {
    return getGenAIClient().generateStructured<T>({
      method: 'generateStructured',
      prompt: prompt as GenAIPrompt,
      responseSchema: schema as object,
      generationConfig: generationConfigOverride as Record<string, unknown> | undefined,
      validate: (raw) => raw as T,
      context,
    });
  }

  /** Generates titles for a batch of sections (feature: tocTitles). */
  public async generateTOCForBatch(
    sections: { id: string; text: string }[],
    context?: { bookTitle?: string; language?: string },
  ): Promise<{ id: string; title: string }[]> {
    const { generateTocTitles } = await import('@domains/google/genai/features/tocTitles');
    return generateTocTitles(getGenAIClient(), sections, context);
  }

  /** Detects content types for a batch of root nodes (feature: referenceDetection). */
  public async detectContentTypes(
    nodes: { id: string; sampleText: string; leadsWithMarker?: boolean }[],
    hints: { enumeratorCandidate: number },
    context?: { bookTitle?: string; sectionTitle?: string },
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
  public async generateTableAdaptations(
    nodes: { rootCfi: string; imageBlob: Blob }[],
    thinkingBudget: number = 512,
    context?: { bookTitle?: string; sectionTitle?: string },
  ): Promise<{ cfi: string; adaptation: string }[]> {
    const { generateTableAdaptations } = await import(
      '@domains/google/genai/features/tableAdaptation'
    );
    return generateTableAdaptations(getGenAIClient(), nodes, thinkingBudget, context);
  }

  /** Reading-list ↔ library mapping (feature: libraryMapping). */
  public async mapReadingListToLibrary(
    unmappedEntries: { filename: string; title: string; author: string }[],
    unmappedBooks: { bookId: string; title: string; author: string; sourceFilename?: string }[],
  ): Promise<{ readingListFilename: string; libraryBookId: string }[]> {
    const { mapReadingListToLibrary } = await import(
      '@domains/google/genai/features/libraryMapping'
    );
    return mapReadingListToLibrary(getGenAIClient(), unmappedEntries, unmappedBooks);
  }
}

export const genAIService = new GenAIService();
