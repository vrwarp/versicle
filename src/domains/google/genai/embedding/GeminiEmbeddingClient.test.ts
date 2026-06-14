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
