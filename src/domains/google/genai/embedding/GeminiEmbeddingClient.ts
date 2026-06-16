/**
 * GeminiEmbeddingClient — the production EmbeddingClient over the Gemini REST
 * `:embedContent` endpoint, routed through `NetworkGateway.egress('gemini', …)`
 * so every request passes the same consent + quota-lane + token-estimate
 * admission checks as the chat client. Mirrors GeminiClient.ts, narrowed to the
 * embedding shape:
 *  - By default, ONE `:embedContent` POST per text (the batch endpoint is
 *    opt-in; see {@link embed}).
 *  - Config is read PER CALL from the injected provider, never cached, so a
 *    settings edit (model, dims, API key) takes effect on the very next embed
 *    with no stale-singleton state to clobber.
 *  - `profile` mapping for the two model families: gemini-embedding-001 sends a
 *    `taskType` field (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY); gemini-embedding-2
 *    instead prepends a profile instruction to the text. The matched
 *    document/query pair is what makes the asymmetric retrieval cosine work.
 *  - `outputDimensionality: dims` requests a truncated embedding.
 *  - Log payloads are redacted before they reach the injected sink, so book
 *    text never lands in the activity log.
 *  - Returns FLOAT32 vectors; int8 quantization is the indexer/worker's job,
 *    never this client's, so the wire format stays one concern of the storage
 *    layer.
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

/** Max contents packed into ONE :batchEmbedContents call. */
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
 * A coarse token estimate for the gateway's pre-flight admission check — the
 * usual ~4-chars-per-token heuristic, identical to GeminiClient.estTokens. The
 * gateway debits this estimate up front; reconciling to the real cost from the
 * response is not done here.
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
    // Batch endpoint, off by default. When enabled, the client packs up to 100
    // texts into ONE :batchEmbedContents POST instead of one :embedContent POST
    // per text. Because the gateway debits one daily-request unit per egress
    // call, batching would cut N requests down to 1 — but only if Google's quota
    // also counts a batch as a single request, which is unconfirmed. Until that
    // is verified against a real free-tier key (issue a 50-content batch and
    // check whether the daily request counter goes up by 1 or by 50), the safe
    // default is the per-text path so we never silently blow the quota.
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
   * Batched path (opt-in): pack up to {@link BATCH_MAX} texts into ONE
   * `:batchEmbedContents` POST per window — one egress call (one gateway
   * daily-request debit) per <=100 texts, versus N for the per-text path.
   * `embeddings[]` is parsed back to N Float32Array, positionally aligned with
   * the requests. Profile shaping (EM2 instruction vs taskType,
   * outputDimensionality) is identical to the per-text path, applied per request.
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
    // Read config fresh each call so a settings edit applies to the next embed.
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
        // One combined token estimate for the whole batch, since the batch is a
        // single egress call (like the per-text path's per-text estimate).
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
    // Read config fresh each call so a settings edit applies to the next embed.
    const config = this.deps.getConfig();
    const isEm2 = config.model === EM2_MODEL;

    // Profile mapping: gemini-embedding-2 prepends an instruction to the text;
    // gemini-embedding-001 carries a taskType field instead. The matched
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
