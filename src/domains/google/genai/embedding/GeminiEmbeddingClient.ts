/**
 * GeminiEmbeddingClient (Increment C §1) — the production EmbeddingClient over
 * the Gemini REST `:embedContent` endpoint, routed through
 * `NetworkGateway.egress('gemini', …)`. Mirrors GeminiClient.ts (config read
 * per call, gateway routing with consent + lane + estTokens, redacted logging
 * before the injected sink), narrowed to the embedding shape.
 *
 * Design points (design §1/§5.2, §8.1):
 *  - ONE `:embedContent` POST PER text (batching off by design §0/§8.1).
 *  - Config read PER CALL from the injected provider (GG-8): a settings edit
 *    takes effect on the very next embed, no mutable-singleton clobber.
 *  - `profile` mapping: gemini-embedding-001 sets `taskType` (the matched
 *    RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY pair); gemini-embedding-2 prepends a
 *    profile instruction to the text (the EM2 contract).
 *  - `outputDimensionality: dims` requests the truncated embedding.
 *  - Logs are redacted BEFORE they reach the injected sink (privacy D3),
 *    exactly like GeminiClient.log (GeminiClient.ts:119).
 *  - Returns FLOAT32 vectors; int8 quantization is the indexer/worker's job
 *    (B3), never this client's.
 */
import { egress, type EgressFn } from '@kernel/net';
import { GenAIHttpError } from '../errors';
import { redactPayload, type GenAILogEntry, type GenAILogSink } from '../logging';
import type {
  EmbeddingClient,
  EmbeddingConfigProvider,
  EmbeddingProfile,
} from './contract';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The EM2 model id whose profile is carried by a prepended instruction. */
const EM2_MODEL = 'gemini-embedding-2';

/** Max contents packed into ONE :batchEmbedContents call (design §9/§11.3). */
const BATCH_MAX = 100;

/** The `taskType` enum values for the asymmetric retrieval embedding pair. */
const TASK_TYPE: Record<EmbeddingProfile, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

/** The prepended profile instruction EM2 uses in lieu of a taskType field. */
const EM2_INSTRUCTION: Record<EmbeddingProfile, string> = {
  document: 'title: none | text: ',
  query: 'task: search result | query: ',
};

/**
 * A coarse token estimate for the pre-flight gateway admission window — the
 * usual ~4-chars-per-token heuristic, identical to GeminiClient.estTokens
 * (GeminiClient.ts:80). The reconcile to the real cost via usageMetadata is a
 * Phase-D/F refinement (this fg lane debits only the estimate).
 */
function estTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function generateLogId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

interface EmbedContentResponseBody {
  embedding?: { values?: number[] };
  error?: { code?: number; message?: string; status?: string };
}

interface BatchEmbedContentsResponseBody {
  /** Positionally aligned with the request's `requests[]` (one per content). */
  embeddings?: { values?: number[] }[];
  error?: { code?: number; message?: string; status?: string };
}

export interface GeminiEmbeddingClientDeps {
  getConfig: EmbeddingConfigProvider;
  /** Injected for tests; production uses the kernel gateway. */
  egress?: EgressFn;
  /** Activity-log sink (entries arrive pre-redacted). */
  onLog?: GenAILogSink;
}

export class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private readonly deps: GeminiEmbeddingClientDeps) {}

  private get egress(): EgressFn {
    return this.deps.egress ?? egress;
  }

  isConfigured(): boolean {
    return this.deps.getConfig().apiKey !== '';
  }

  private log(type: GenAILogEntry['type'], payload: unknown): void {
    this.deps.onLog?.({
      id: generateLogId(),
      timestamp: Date.now(),
      type,
      method: 'embedContent',
      payload: redactPayload(payload),
    });
  }

  async embed(
    texts: string[],
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      interactive?: boolean;
      lane?: 'fg' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<{ vectors: Float32Array[] }> {
    // §11.3 PROBE PROCEDURE (run ONCE, manually, against a real free-tier key
    // on the default project before flipping useBatchEmbedding on by default):
    //   1. With useBatchEmbedding=false, issue 5 single :embedContent calls and
    //      read the daily REQUEST counter delta to calibrate (should be +5).
    //   2. With useBatchEmbedding=true, issue ONE 50-content :batchEmbedContents
    //      call and re-read the counter.
    //   3. If the delta is +1, Google counts a batch as a single request →
    //      adopt useBatchEmbedding=true (the structural N→1 RPD win). If the
    //      delta is ~+50, the batch is billed per-content → REVERT to false.
    // The swap below makes the CLIENT issue 1 egress call per <=100 window vs
    // N per single; the gateway debits RPD once per egress acquire, so the
    // 1-vs-N RPD difference is structural — whether Google's quota agrees is
    // exactly the unconfirmed question this probe answers. Default stays false.
    const { useBatchEmbedding } = this.deps.getConfig();
    if (useBatchEmbedding) {
      return this.embedBatch(texts, opts);
    }

    const vectors: Float32Array[] = [];
    for (const text of texts) {
      vectors.push(await this.embedOne(text, opts));
    }
    return { vectors };
  }

  /**
   * Batched path (default-off scaffolding, §9/§11.3): pack up to {@link
   * BATCH_MAX} texts into ONE `:batchEmbedContents` POST per window — one
   * egress call (= one gateway RPD debit) per <=100 texts, vs N for the single
   * path. `embeddings[]` is parsed back to N Float32Array, positionally aligned
   * with the requests. The profile shaping (EM2 instruction vs taskType,
   * outputDimensionality) is identical to the single path, applied per request.
   */
  private async embedBatch(
    texts: string[],
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      interactive?: boolean;
      lane?: 'fg' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<{ vectors: Float32Array[] }> {
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_MAX) {
      const window = texts.slice(i, i + BATCH_MAX);
      const part = await this.embedWindow(window, opts);
      for (const v of part) vectors.push(v);
    }
    return { vectors };
  }

  /** Issue ONE :batchEmbedContents call for a <=BATCH_MAX window. */
  private async embedWindow(
    texts: string[],
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      interactive?: boolean;
      lane?: 'fg' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<Float32Array[]> {
    // Config read PER CALL (GG-8).
    const config = this.deps.getConfig();
    const isEm2 = config.model === EM2_MODEL;

    const contents = texts.map((text) =>
      isEm2 ? `${EM2_INSTRUCTION[opts.profile]}${text}` : text,
    );
    const requests = contents.map((content) => ({
      model: `models/${config.model}`,
      content: { parts: [{ text: content }] },
      outputDimensionality: config.dims,
      ...(isEm2 ? {} : { taskType: TASK_TYPE[opts.profile] }),
    }));
    const payload = { requests };

    this.log('request', { model: config.model, profile: opts.profile, batch: requests.length });

    const response = await this.egress(
      'gemini',
      `${GEMINI_API_BASE}/models/${config.model}:batchEmbedContents`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify(payload),
      },
      {
        signal: opts.signal,
        consent: { bookId: opts.bookId, interactive: opts.interactive },
        lane: opts.lane ?? 'fg',
        // The window's combined estimate (one acquire window, like the single
        // path's per-text estTokens).
        estTokens: contents.reduce((sum, c) => sum + estTokens(c), 0),
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as BatchEmbedContentsResponseBody;
      const error = new GenAIHttpError(
        body.error?.message || `Embedding request failed: ${response.status}`,
        response.status,
        { apiStatus: body.error?.status, model: config.model },
      );
      this.log('error', { message: error.message, status: response.status });
      throw error;
    }

    const body = (await response.json()) as BatchEmbedContentsResponseBody;
    const embeddings = body.embeddings ?? [];
    this.log('response', { model: config.model, batch: embeddings.length });
    return embeddings.map((e) => Float32Array.from(e.values ?? []));
  }

  private async embedOne(
    text: string,
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      interactive?: boolean;
      lane?: 'fg' | 'bg';
      signal?: AbortSignal;
    },
  ): Promise<Float32Array> {
    // Config read PER CALL (GG-8).
    const config = this.deps.getConfig();
    const isEm2 = config.model === EM2_MODEL;

    // Profile mapping (design §1/§5.2): EM2 prepends an instruction to the
    // text; gemini-embedding-001 carries a taskType field. The matched
    // document/query pair is what makes the asymmetric cosine meaningful.
    const content = isEm2 ? `${EM2_INSTRUCTION[opts.profile]}${text}` : text;
    const payload: Record<string, unknown> = {
      content: { parts: [{ text: content }] },
      outputDimensionality: config.dims,
      ...(isEm2 ? {} : { taskType: TASK_TYPE[opts.profile] }),
    };

    this.log('request', { model: config.model, profile: opts.profile, payload });

    const response = await this.egress(
      'gemini',
      `${GEMINI_API_BASE}/models/${config.model}:embedContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify(payload),
      },
      {
        signal: opts.signal,
        consent: { bookId: opts.bookId, interactive: opts.interactive },
        lane: opts.lane ?? 'fg',
        estTokens: estTokens(content),
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as EmbedContentResponseBody;
      const error = new GenAIHttpError(
        body.error?.message || `Embedding request failed: ${response.status}`,
        response.status,
        { apiStatus: body.error?.status, model: config.model },
      );
      this.log('error', { message: error.message, status: response.status });
      throw error;
    }

    const body = (await response.json()) as EmbedContentResponseBody;
    const values = body.embedding?.values ?? [];
    this.log('response', { model: config.model, dims: values.length });
    return Float32Array.from(values);
  }
}
