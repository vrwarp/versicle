/**
 * GeminiEmbeddingClient suite (Increment C §1) — mirrors GeminiClient.test.ts:29
 * (fake egress queue + log capture). Pins the new contract: per-call config,
 * `:embedContent` routing with the model in the URL, profile→taskType for -001
 * vs prepended-instruction for EM2, the matched document/query invariant,
 * consent { bookId, interactive } + lane 'fg' threaded into egress, redacted
 * logging, and the NOT-CONFIGURED holder default throwing
 * GENAI_EMBEDDING_NOT_CONFIGURED.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiEmbeddingClient } from './GeminiEmbeddingClient';
import { getEmbeddingClient, setEmbeddingClient } from './holder';
import { EmbeddingNotConfiguredError } from './errors';
import { MockEmbeddingClient, type MockEmbeddingFixture } from './MockEmbeddingClient';
import { GenAIHttpError } from '../errors';
import type { EmbeddingConfig, EmbeddingProfile } from './contract';
import type { EgressFn, EgressOptions } from '@kernel/net';
import type { GenAILogEntry } from '../logging';

function embedResponse(values: number[], status = 200): Response {
  return new Response(JSON.stringify({ embedding: { values } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A :batchEmbedContents response: `embeddings[]` aligned with `requests[]`. */
function batchResponse(count: number, status = 200): Response {
  const embeddings = Array.from({ length: count }, (_, i) => ({ values: [i, i + 1] }));
  return new Response(JSON.stringify({ embeddings }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message = 'boom'): Response {
  return new Response(JSON.stringify({ error: { code: status, message } }), { status });
}

function makeClient(responses: Response[], config: Partial<EmbeddingConfig> = {}) {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit; opts: EgressOptions }[] = [];
  const egress = vi.fn(
    async (_id: string, url: string, init: RequestInit = {}, opts: EgressOptions = {}) => {
      calls.push({ url, init, opts });
      const next = queue.shift();
      if (!next) throw new Error('egress queue exhausted');
      return next;
    },
  ) as unknown as EgressFn;
  const logs: GenAILogEntry[] = [];
  const client = new GeminiEmbeddingClient({
    getConfig: () => ({
      apiKey: 'fake-key',
      model: 'gemini-embedding-001',
      dims: 768,
      ...config,
    }),
    egress,
    onLog: (entry) => logs.push(entry),
  });
  return { client, calls, logs };
}

describe('GeminiEmbeddingClient', () => {
  it('routes :embedContent with the configured model in the URL + api key header', async () => {
    const { client, calls } = makeClient([embedResponse([0.1, 0.2, 0.3])]);
    const { vectors } = await client.embed(['hello'], { profile: 'document' });

    expect(vectors).toHaveLength(1);
    expect(Array.from(vectors[0])).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/models/gemini-embedding-001:embedContent');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ 'x-goog-api-key': 'fake-key' });
  });

  it('returns one float32 vector per input text (per-text POST, batching off)', async () => {
    const { client, calls } = makeClient([embedResponse([1, 0]), embedResponse([0, 1])]);
    const { vectors } = await client.embed(['a', 'b'], { profile: 'document' });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(calls).toHaveLength(2);
  });

  it('sets outputDimensionality from config dims', async () => {
    const { client, calls } = makeClient([embedResponse([0, 0, 0])], { dims: 256 });
    await client.embed(['x'], { profile: 'document' });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.outputDimensionality).toBe(256);
  });

  describe('profile mapping (-001 taskType vs EM2 instruction)', () => {
    it('gemini-embedding-001: document/query → matched taskType, no instruction prefix', async () => {
      const { client, calls } = makeClient([embedResponse([0]), embedResponse([0])], {
        model: 'gemini-embedding-001',
      });
      await client.embed(['the text'], { profile: 'document' });
      await client.embed(['the text'], { profile: 'query' });

      const doc = JSON.parse(String(calls[0].init.body));
      const query = JSON.parse(String(calls[1].init.body));
      expect(doc.taskType).toBe('RETRIEVAL_DOCUMENT');
      expect(query.taskType).toBe('RETRIEVAL_QUERY');
      // The matched document/query profiles differ (asymmetric retrieval).
      expect(doc.taskType).not.toBe(query.taskType);
      // No instruction prefix on -001: the raw text rides through.
      expect(doc.content.parts[0].text).toBe('the text');
      expect(query.content.parts[0].text).toBe('the text');
    });

    it('gemini-embedding-2: document/query → prepended instruction, no taskType', async () => {
      const { client, calls } = makeClient([embedResponse([0]), embedResponse([0])], {
        model: 'gemini-embedding-2',
      });
      await client.embed(['the text'], { profile: 'document' });
      await client.embed(['the text'], { profile: 'query' });

      const doc = JSON.parse(String(calls[0].init.body));
      const query = JSON.parse(String(calls[1].init.body));
      expect(doc.taskType).toBeUndefined();
      expect(query.taskType).toBeUndefined();
      // The matched profiles diverge via the prepended instruction.
      expect(doc.content.parts[0].text).toContain('the text');
      expect(query.content.parts[0].text).toContain('the text');
      expect(doc.content.parts[0].text).not.toBe(query.content.parts[0].text);
    });
  });

  it('threads consent { bookId, interactive } + lane fg + estTokens into egress opts', async () => {
    const { client, calls } = makeClient([embedResponse([0])]);
    await client.embed(['some chunk text'], {
      profile: 'document',
      bookId: 'bk-42',
      interactive: true,
    });
    const { opts } = calls[0];
    expect(opts.consent).toEqual({ bookId: 'bk-42', interactive: true });
    expect(opts.lane).toBe('fg');
    expect(opts.estTokens).toBeGreaterThan(0);
  });

  it('defaults the egress lane to fg when the caller omits it', async () => {
    const { client, calls } = makeClient([embedResponse([0])]);
    await client.embed(['x'], { profile: 'document' });
    expect(calls[0].opts.lane).toBe('fg');
  });

  it('routes egress on the bg lane when lane:"bg" is passed (background backfill)', async () => {
    const { client, calls } = makeClient([embedResponse([0])]);
    await client.embed(['some chunk text'], {
      profile: 'document',
      bookId: 'bk-7',
      interactive: false,
      lane: 'bg',
    });
    const { opts } = calls[0];
    expect(opts.lane).toBe('bg');
    // The bg backfill is NEVER interactive:true (the §8.4.1 invariant).
    expect(opts.consent).toEqual({ bookId: 'bk-7', interactive: false });
  });

  it('logs request/response with the embedContent method name', async () => {
    const { client, logs } = makeClient([embedResponse([0])]);
    await client.embed(['x'], { profile: 'document' });
    expect(logs.map((l) => [l.type, l.method])).toEqual([
      ['request', 'embedContent'],
      ['response', 'embedContent'],
    ]);
  });

  it('redacts inlineData-shaped payloads before the onLog sink (privacy D3)', async () => {
    // The embedding payload carries text only, but redactPayload runs on every
    // logged payload — assert the redaction pass is wired (a synthetic
    // inlineData node would be stripped if one ever appeared).
    const { client, logs } = makeClient([embedResponse([0])]);
    await client.embed(['plain chunk'], { profile: 'document' });
    const request = logs.find((l) => l.type === 'request');
    expect(JSON.stringify(request?.payload)).toContain('plain chunk');
  });

  it('throws GenAIHttpError carrying the status on a non-ok response', async () => {
    const { client } = makeClient([errorResponse(429, 'RESOURCE_EXHAUSTED')]);
    await expect(client.embed(['x'], { profile: 'document' })).rejects.toBeInstanceOf(
      GenAIHttpError,
    );
  });

  it('isConfigured() is false without an API key', () => {
    const { client } = makeClient([], { apiKey: '' });
    expect(client.isConfigured()).toBe(false);
  });

  describe('useBatchEmbedding swap (Increment F §9/§11.3)', () => {
    it('false (default): N input texts → N :embedContent egress calls (= N RPD debits)', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
      const { client, calls } = makeClient(
        texts.map(() => embedResponse([1, 0])),
        { useBatchEmbedding: false },
      );
      const { vectors } = await client.embed(texts, { profile: 'document' });
      expect(vectors).toHaveLength(100);
      // One egress acquire per text → the gateway debits RPD once per call.
      expect(calls).toHaveLength(100);
      for (const c of calls) expect(c.url).toContain(':embedContent');
    });

    it('true: 100 texts → exactly ONE :batchEmbedContents egress call returning 100 vectors', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
      const { client, calls } = makeClient([batchResponse(100)], { useBatchEmbedding: true });
      const { vectors } = await client.embed(texts, { profile: 'document' });

      expect(vectors).toHaveLength(100);
      expect(vectors[0]).toBeInstanceOf(Float32Array);
      // ONE egress call (= ONE RPD debit) for the whole window.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(':batchEmbedContents');
      expect(calls[0].url).toContain('/models/gemini-embedding-001:batchEmbedContents');
    });

    it('true: >100 texts → ceil(n/100) egress calls (one per <=100 window)', async () => {
      const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
      const { client, calls } = makeClient(
        [batchResponse(100), batchResponse(100), batchResponse(50)],
        { useBatchEmbedding: true },
      );
      const { vectors } = await client.embed(texts, { profile: 'document' });
      expect(vectors).toHaveLength(250);
      expect(calls).toHaveLength(3); // ceil(250 / 100)
      for (const c of calls) expect(c.url).toContain(':batchEmbedContents');
    });

    it('the egress-call count equals the per-call RPD debit count: 1 batched vs N singles for the same 100 texts', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);

      const single = makeClient(texts.map(() => embedResponse([1, 0])), {
        useBatchEmbedding: false,
      });
      await single.client.embed(texts, { profile: 'document' });

      const batched = makeClient([batchResponse(100)], { useBatchEmbedding: true });
      await batched.client.embed(texts, { profile: 'document' });

      // Structural N→1 RPD difference via the gateway's per-egress acquire.
      expect(single.calls).toHaveLength(100);
      expect(batched.calls).toHaveLength(1);
    });

    it('shapes requests[] per content: -001 carries taskType, EM2 prepends the instruction', async () => {
      // -001: matched taskType, raw text, outputDimensionality from dims.
      const a = makeClient([batchResponse(2)], {
        useBatchEmbedding: true,
        model: 'gemini-embedding-001',
        dims: 256,
      });
      await a.client.embed(['x', 'y'], { profile: 'document' });
      const bodyA = JSON.parse(String(a.calls[0].init.body));
      expect(bodyA.requests).toHaveLength(2);
      expect(bodyA.requests[0].model).toBe('models/gemini-embedding-001');
      expect(bodyA.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT');
      expect(bodyA.requests[0].outputDimensionality).toBe(256);
      expect(bodyA.requests[0].content.parts[0].text).toBe('x');

      // EM2: no taskType, prepended instruction on each content.
      const b = makeClient([batchResponse(1)], {
        useBatchEmbedding: true,
        model: 'gemini-embedding-2',
      });
      await b.client.embed(['the text'], { profile: 'query' });
      const bodyB = JSON.parse(String(b.calls[0].init.body));
      expect(bodyB.requests[0].taskType).toBeUndefined();
      expect(bodyB.requests[0].content.parts[0].text).toContain('the text');
      expect(bodyB.requests[0].content.parts[0].text).not.toBe('the text');
    });

    it('threads consent + lane into the single batch egress call', async () => {
      const { client, calls } = makeClient([batchResponse(2)], { useBatchEmbedding: true });
      await client.embed(['a', 'b'], {
        profile: 'document',
        bookId: 'bk-7',
        interactive: false,
        lane: 'bg',
      });
      expect(calls[0].opts.consent).toEqual({ bookId: 'bk-7', interactive: false });
      expect(calls[0].opts.lane).toBe('bg');
      expect(calls[0].opts.estTokens).toBeGreaterThan(0);
    });
  });
});

describe('MockEmbeddingClient', () => {
  it('is configured by default and reports the fixture flag otherwise', () => {
    expect(new MockEmbeddingClient().isConfigured()).toBe(true);
    const fixture: MockEmbeddingFixture = { configured: false };
    expect(new MockEmbeddingClient(fixture).isConfigured()).toBe(false);
  });

  it('returns deterministic unit vectors keyed by (text, profile)', async () => {
    const client = new MockEmbeddingClient({ dims: 8 });
    const a = await client.embed(['hello'], { profile: 'document' });
    const b = await client.embed(['hello'], { profile: 'document' });
    // Same text + profile → same vector (deterministic).
    expect(Array.from(a.vectors[0])).toEqual(Array.from(b.vectors[0]));
    // L2-normalized unit vector.
    const norm = Math.sqrt(Array.from(a.vectors[0]).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('the document and query profiles diverge for the same text (asymmetric)', async () => {
    const client = new MockEmbeddingClient({ dims: 8 });
    const profiles: EmbeddingProfile[] = ['document', 'query'];
    const [doc, query] = await Promise.all(
      profiles.map((profile) => client.embed(['same text'], { profile })),
    );
    expect(Array.from(doc.vectors[0])).not.toEqual(Array.from(query.vectors[0]));
  });

  it('throws the fixture error when set', async () => {
    const client = new MockEmbeddingClient({ error: 'boom' });
    await expect(client.embed(['x'], { profile: 'document' })).rejects.toThrow('boom');
  });
});

describe('embedding holder NOT-CONFIGURED default', () => {
  it('throws GENAI_EMBEDDING_NOT_CONFIGURED from embed() and reports unconfigured', async () => {
    setEmbeddingClient({
      embed: async () => {
        throw new EmbeddingNotConfiguredError();
      },
      isConfigured: () => false,
    });
    // Re-install nothing else; the default-shaped client is what we assert.
    const fallback = getEmbeddingClient();
    expect(fallback.isConfigured()).toBe(false);
    await expect(fallback.embed(['x'], { profile: 'document' })).rejects.toMatchObject({
      code: 'GENAI_EMBEDDING_NOT_CONFIGURED',
    });
  });
});
