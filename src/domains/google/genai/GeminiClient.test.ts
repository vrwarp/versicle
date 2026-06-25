/**
 * GeminiClient suite (Phase 7 §H, PR-A3). Absorbs the rotation/429
 * assertions of the deleted src/lib/genai/GenAIService.test.ts (absorption
 * ledger) and pins the new contract: per-call config, gateway routing,
 * required validation, redacted logging.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiClient, GENAI_ROTATION_MODELS } from './GeminiClient';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
} from './errors';
import type { GenAIConfig } from './contract';
import type { EgressFn } from '@kernel/net';
import { NetRateLimitedError } from '~types/errors';
import type { GenAILogEntry } from './logging';

function geminiResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, message = 'boom'): Response {
  return new Response(JSON.stringify({ error: { code: status, message } }), { status });
}

function makeClient(
  responses: Response[],
  config: Partial<GenAIConfig> = {},
) {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit }[] = [];
  const egress = vi.fn(async (_id: string, url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('egress queue exhausted');
    return next;
  }) as unknown as EgressFn;
  const logs: GenAILogEntry[] = [];
  const client = new GeminiClient({
    getConfig: () => ({
      apiKey: 'fake-key',
      model: 'my-specific-model',
      rotationEnabled: false,
      ...config,
    }),
    egress,
    onLog: (entry) => logs.push(entry),
  });
  return { client, calls, logs };
}

describe('GeminiClient', () => {
  it('regression: uses the configured model when rotation is disabled', async () => {
    const { client, calls } = makeClient([geminiResponse('result')]);
    await expect(client.generateText('prompt')).resolves.toBe('result');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/models/my-specific-model:generateContent');
  });

  it('regression: uses a rotation model when rotation is enabled', async () => {
    const { client, calls } = makeClient([geminiResponse('result')], {
      rotationEnabled: true,
    });
    await client.generateText('prompt');
    const used = GENAI_ROTATION_MODELS.some((m) => calls[0].url.includes(`/models/${m}:`));
    expect(used).toBe(true);
  });

  it('regression: retries with the next model on 429 when rotation is enabled (deterministic order)', async () => {
    const { client, calls } = makeClient(
      [errorResponse(429, 'RESOURCE_EXHAUSTED'), geminiResponse('success')],
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).resolves.toBe('success');
    expect(calls).toHaveLength(2);
    const model = (url: string) => url.match(/models\/([^:]+):/)?.[1];
    // Tiered order: premium first, then next
    expect(model(calls[0].url)).toBe('gemini-3.5-flash');
    expect(model(calls[1].url)).toBe('gemini-3-flash-preview');
  });

  it('regression: does NOT retry on 429 when rotation is disabled', async () => {
    const { client, calls } = makeClient([errorResponse(429, 'RESOURCE_EXHAUSTED')]);
    await expect(client.generateText('prompt')).rejects.toBeInstanceOf(GenAIHttpError);
    expect(calls).toHaveLength(1);
  });

  it('regression: does NOT retry on non-429 errors even with rotation enabled', async () => {
    const { client, calls } = makeClient([errorResponse(500, 'Internal Server Error')], {
      rotationEnabled: true,
    });
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('regression: exhausts all rotation models when every one returns 429', async () => {
    const { client, calls } = makeClient(
      [
        errorResponse(429, 'RESOURCE_EXHAUSTED'),
        errorResponse(429, 'RESOURCE_EXHAUSTED'),
        errorResponse(429, 'RESOURCE_EXHAUSTED'),
      ],
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(GENAI_ROTATION_MODELS.length);
  });

  it('regression: rotates through the remaining models when a 429 cooldown makes the sibling acquire NetRateLimitedError', async () => {
    // Production failure being pinned: model A's network 429 sets a governor
    // cooldown; model B's pre-network gateway acquire then throws
    // NetRateLimitedError. The rotation continue-predicate (isRetryableForRotation)
    // must treat that pre-network backpressure as retryable so rotation still
    // tries the remaining model instead of aborting. Here the FIRST attempt's
    // pre-network step throws NetRateLimitedError (the cooldown) and the SECOND
    // model succeeds — without the fix, the loop would rethrow and never reach it.
    const calls: string[] = [];
    let attempt = 0;
    const egress = vi.fn(async (_id: string, url: string) => {
      attempt += 1;
      calls.push(url);
      if (attempt === 1) {
        // The gateway acquire backpressured (sibling 429 cooldown) — pre-network.
        throw new NetRateLimitedError(1000, { lane: 'fg', reason: 'cooldown' });
      }
      return geminiResponse('recovered');
    }) as unknown as EgressFn;
    const client = new GeminiClient({
      getConfig: () => ({
        apiKey: 'fake-key',
        model: 'unused',
        rotationEnabled: true,
      }),
      egress,
    });

    await expect(client.generateText('prompt')).resolves.toBe('recovered');
    expect(calls).toHaveLength(2); // two models tried; the second succeeded
    const model = (url: string) => url.match(/models\/([^:]+):/)?.[1];
    expect(model(calls[0])).not.toBe(model(calls[1]));
  });

  it('throws GENAI_NOT_CONFIGURED (legacy message) without an API key', async () => {
    const { client, calls } = makeClient([], { apiKey: '' });
    await expect(client.generateText('prompt')).rejects.toBeInstanceOf(
      GenAINotConfiguredError,
    );
    await expect(
      client.generateStructured({
        method: 'x',
        prompt: 'p',
        responseSchema: {},
        validate: (raw) => raw,
      }),
    ).rejects.toThrow('GenAI Service not configured (missing API key).');
    expect(calls).toHaveLength(0);
    expect(client.isConfigured()).toBe(false);
  });

  describe('generateStructured', () => {
    it('sends JSON mode + responseSchema + api key header, parses and validates', async () => {
      const { client, calls } = makeClient([geminiResponse('{"value": 7}')]);
      const validate = vi.fn((raw: unknown) => raw as { value: number });
      const result = await client.generateStructured({
        method: 'test',
        prompt: 'give me a value',
        responseSchema: { type: 'object' },
        validate,
      });
      expect(result).toEqual({ value: 7 });
      expect(validate).toHaveBeenCalledWith({ value: 7 });
      const init = calls[0].init;
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ 'x-goog-api-key': 'fake-key' });
      const body = JSON.parse(String(init.body));
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toEqual({ type: 'object' });
      expect(body.contents[0].parts[0].text).toBe('give me a value');
    });

    it('passes generationConfig overrides (thinkingConfig) through', async () => {
      const { client, calls } = makeClient([geminiResponse('[]')]);
      await client.generateStructured({
        method: 'test',
        prompt: 'p',
        responseSchema: {},
        generationConfig: { thinkingConfig: { thinkingBudget: 512 } },
        validate: (raw) => raw,
      });
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 512 });
    });

    it('throws GENAI_INVALID_RESPONSE on unparseable JSON', async () => {
      const { client } = makeClient([geminiResponse('not json {')]);
      await expect(
        client.generateStructured({
          method: 'test',
          prompt: 'p',
          responseSchema: {},
          validate: (raw) => raw,
        }),
      ).rejects.toBeInstanceOf(GenAIInvalidResponseError);
    });

    it('propagates validation failures (validate is REQUIRED, GG-5)', async () => {
      const { client } = makeClient([geminiResponse('{"bad": true}')]);
      await expect(
        client.generateStructured({
          method: 'test',
          prompt: 'p',
          responseSchema: {},
          validate: () => {
            throw new GenAIInvalidResponseError('membership breach');
          },
        }),
      ).rejects.toThrow('membership breach');
    });
  });

  describe('logging (privacy D3)', () => {
    it('redacts inlineData from logged request payloads', async () => {
      const { client, logs } = makeClient([geminiResponse('[]')]);
      await client.generateStructured({
        method: 'generateTableAdaptations',
        prompt: {
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { data: 'QUJDREVGRw==', mimeType: 'image/png' } },
                { text: 'Table Image CFI: epubcfi(/6/2)' },
              ],
            },
          ],
        },
        responseSchema: {},
        validate: (raw) => raw,
      });
      const request = logs.find((l) => l.type === 'request');
      const serialized = JSON.stringify(request?.payload);
      expect(serialized).not.toContain('QUJDREVGRw==');
      expect(serialized).toContain('"redacted":true');
      expect(serialized).toContain('byteCount');
      expect(serialized).toContain('Table Image CFI');
    });

    it('logs request/response pairs with the method name', async () => {
      const { client, logs } = makeClient([geminiResponse('"ok"')]);
      await client.generateStructured({
        method: 'myMethod',
        prompt: 'p',
        responseSchema: {},
        validate: (raw) => raw,
      });
      expect(logs.map((l) => [l.type, l.method])).toEqual([
        ['request', 'myMethod'],
        ['response', 'myMethod'],
      ]);
    });
  });
});
