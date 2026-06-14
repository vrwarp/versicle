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
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      vectors.push(await this.embedOne(text, opts));
    }
    return { vectors };
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
