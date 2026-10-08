/**
 * GeminiClient suite (Phase 7 §H, PR-A3). Absorbs the rotation/429
 * assertions of the deleted src/lib/genai/GenAIService.test.ts (absorption
 * ledger) and pins the new contract: per-call config, gateway routing,
 * required validation, redacted logging.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GeminiClient,
  GENAI_ROTATION_MODELS,
  OVERLOADED_RETRY_DELAY_MS,
  UNAVAILABLE_COOLDOWN_MS,
  type GeminiClientDeps,
} from './GeminiClient';
import {
  GenAIHttpError,
  GenAIInvalidResponseError,
  GenAINotConfiguredError,
} from './errors';
import type { GenAIConfig } from './contract';
import type { EgressFn } from '@kernel/net';
import { AppError, NetRateLimitedError } from '~types/errors';
import type { GenAILogEntry } from './logging';
import { DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';

function geminiResponse(
  text: string,
  status = 200,
  usageMetadata?: Record<string, number>,
): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      ...(usageMetadata ? { usageMetadata } : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, message = 'boom'): Response {
  return new Response(JSON.stringify({ error: { code: status, message } }), { status });
}

function makeClient(
  responses: Response[],
  config: Partial<GenAIConfig> = {},
  deps: Partial<Pick<GeminiClientDeps, 'governor' | 'sleep' | 'now'>> = {},
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
    // The same-model retry pause is real time in production; never in a test.
    sleep: async () => {},
    ...deps,
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
    expect(model(calls[0].url)).toBe(GENAI_ROTATION_MODELS[0]);
    expect(model(calls[1].url)).toBe(GENAI_ROTATION_MODELS[1]);
    expect(model(calls[0].url)).toBe('gemini-3.8-flash');
  });

  it('every rotation model has its own quota pool, summing to the free-tier day', () => {
    // The daily ceiling is the SUM of the per-model buckets — order cannot add
    // or lose quota, but a model with NO pool of its own silently inherits the
    // far looser `default` pool, which would overrun its real free tier.
    const rpd = GENAI_ROTATION_MODELS.map((m) => DEFAULT_QUOTA_LIMITS[m]?.rpd);
    expect(rpd).not.toContain(undefined);
    expect(rpd.reduce((sum, n) => sum! + n!, 0)).toBe(1140);
  });

  it('models with a shutdown date are ordered BELOW the high-daily-quota workhorses', () => {
    // Retirement is the one failure the chain cannot fully absorb, so anything
    // deprecating sits in the tail: a hard abort there costs the last 60
    // requests of the day rather than the 1,000 the lite models carry.
    const deprecating = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'];
    const workhorses = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
    const at = (m: string) => GENAI_ROTATION_MODELS.indexOf(m as never);
    for (const tail of deprecating) {
      for (const workhorse of workhorses) {
        expect(at(tail)).toBeGreaterThan(at(workhorse));
      }
    }
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

  it('a RETIRED model (404) rotates on instead of stranding the rest of the chain', async () => {
    // Google shuts models down on its own schedule; a dead one answers 404, not
    // 429. Without this the loop rethrows on the spot and every model below it
    // — including the 500-RPD workhorses — goes unused for the rest of the day.
    const { client, calls } = makeClient(
      [errorResponse(404, 'models/gemini-3.8-flash is not found'), geminiResponse('success')],
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).resolves.toBe('success');
    expect(calls).toHaveLength(2);
  });

  it('a model gated behind a tier (400 FAILED_PRECONDITION) rotates on', async () => {
    const { client, calls } = makeClient(
      [
        new Response(
          JSON.stringify({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'billing' } }),
          { status: 400 },
        ),
        geminiResponse('success'),
      ],
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).resolves.toBe('success');
    expect(calls).toHaveLength(2);
  });

  it('a malformed request (400 INVALID_ARGUMENT) does NOT rotate — it would fail identically on every model', async () => {
    const { client, calls } = makeClient(
      [
        new Response(
          JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad schema' } }),
          { status: 400 },
        ),
      ],
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('stepping past an out-of-quota model logs at debug, a retired one at error', async () => {
    const { client: quotaClient, logs: quotaLogs } = makeClient(
      [errorResponse(429, 'RESOURCE_EXHAUSTED'), geminiResponse('ok')],
      { rotationEnabled: true },
    );
    await quotaClient.generateText('prompt');
    const quotaRotation = quotaLogs.filter((l) => l.type === 'error' || l.type === 'debug');
    expect(quotaRotation.map((l) => l.type)).toEqual(['debug']);

    const { client: deadClient, logs: deadLogs } = makeClient(
      [errorResponse(404, 'not found'), geminiResponse('ok')],
      { rotationEnabled: true },
    );
    await deadClient.generateText('prompt');
    const deadRotation = deadLogs.filter((l) => l.type === 'error' || l.type === 'debug');
    expect(deadRotation.map((l) => l.type)).toEqual(['error']);
  });

  it('regression: exhausts all rotation models when every one returns 429', async () => {
    const { client, calls } = makeClient(
      GENAI_ROTATION_MODELS.map(() => errorResponse(429, 'RESOURCE_EXHAUSTED')),
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

/**
 * Every request entry must be followed by a response OR an error entry that
 * says why the request died. The Jul–Sep 2026 export had 74 detection
 * requests (26%) with no logged outcome at all: non-429 HTTP errors,
 * rotation-off 429s, pre-network gateway refusals and network errors all
 * threw without logging.
 */
describe('GeminiClient terminal outcomes are always logged', () => {
  const errorEntries = (logs: GenAILogEntry[]) => logs.filter((l) => l.type === 'error');

  it('a 429 with rotation OFF logs an error entry with status, code and model', async () => {
    const { client, logs } = makeClient([errorResponse(429, 'RESOURCE_EXHAUSTED')]);
    await expect(client.generateText('prompt')).rejects.toBeInstanceOf(GenAIHttpError);
    expect(errorEntries(logs)).toHaveLength(1);
    expect(errorEntries(logs)[0].payload).toMatchObject({
      message: 'Request failed',
      model: 'my-specific-model',
      status: 429,
      code: 'GENAI_UNKNOWN',
      retryable: true,
      aborted: false,
    });
  });

  it('a 500 with rotation ON logs an error entry (it is not a rotation case)', async () => {
    const { client, logs } = makeClient([errorResponse(500, 'An internal error has occurred.')], {
      rotationEnabled: true,
    });
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 500 });
    expect(errorEntries(logs).map((l) => (l.payload as { status?: number }).status)).toEqual([500]);
    expect((errorEntries(logs)[0].payload as { error: string }).error).toBe(
      'An internal error has occurred.',
    );
  });

  it('a pre-network gateway refusal with rotation OFF logs its code and reason', async () => {
    const egress = vi.fn(async () => {
      throw new NetRateLimitedError(1000, { lane: 'fg', reason: 'cooldown', ratePool: 'm' });
    }) as unknown as EgressFn;
    const logs: GenAILogEntry[] = [];
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'm', rotationEnabled: false }),
      egress,
      onLog: (entry) => logs.push(entry),
    });
    await expect(client.generateText('prompt')).rejects.toBeInstanceOf(NetRateLimitedError);
    expect(errorEntries(logs)[0].payload).toMatchObject({
      code: 'NET_RATE_LIMITED',
      reason: 'cooldown',
      retryAfterMs: 1000,
    });
  });

  it('exhausting every rotation model logs ONE terminal error after the debug steps', async () => {
    const { client, logs } = makeClient(
      GENAI_ROTATION_MODELS.map(() => errorResponse(429, 'RESOURCE_EXHAUSTED')),
      { rotationEnabled: true },
    );
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 429 });
    expect(logs.filter((l) => l.type === 'debug')).toHaveLength(GENAI_ROTATION_MODELS.length);
    expect(errorEntries(logs)).toHaveLength(1);
    expect(errorEntries(logs)[0].payload).toMatchObject({
      message: `All ${GENAI_ROTATION_MODELS.length} rotation models failed`,
      status: 429,
    });
  });

  it('a caller abort is logged at debug, not error', async () => {
    const egress = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as EgressFn;
    const logs: GenAILogEntry[] = [];
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'm', rotationEnabled: false }),
      egress,
      onLog: (entry) => logs.push(entry),
    });
    await expect(client.generateText('prompt')).rejects.toThrow('aborted');
    expect(errorEntries(logs)).toHaveLength(0);
    expect(logs.filter((l) => l.type === 'debug')[0].payload).toMatchObject({ aborted: true });
  });

  it('a validation failure logs the raw response text ONCE (no duplicate terminal entry)', async () => {
    const { client, logs } = makeClient([geminiResponse('{"referenceStartIndex": 0}')]);
    await expect(
      client.generateStructured({
        method: 'detectContentTypes',
        prompt: 'p',
        responseSchema: {},
        validate: () => {
          throw new GenAIInvalidResponseError('rejected');
        },
      }),
    ).rejects.toThrow('rejected');
    expect(errorEntries(logs)).toHaveLength(1);
    expect(errorEntries(logs)[0].payload).toMatchObject({
      message: 'Response failed validation',
      error: 'rejected',
      text: '{"referenceStartIndex": 0}',
      model: 'my-specific-model',
    });
  });

  it('an unparseable response logs once, with the text', async () => {
    const { client, logs } = makeClient([geminiResponse('not json {')]);
    await expect(
      client.generateStructured({ method: 'x', prompt: 'p', responseSchema: {}, validate: (raw) => raw }),
    ).rejects.toBeInstanceOf(GenAIInvalidResponseError);
    expect(errorEntries(logs)).toHaveLength(1);
    expect(errorEntries(logs)[0].payload).toMatchObject({ message: 'Failed to parse JSON', text: 'not json {' });
  });

  it('response entries carry the serving model, latency and the API token usage', async () => {
    let t = 1_000;
    const logs: GenAILogEntry[] = [];
    const egress = vi.fn(async () => {
      t += 4_200;
      return geminiResponse('"ok"', 200, { promptTokenCount: 1874, candidatesTokenCount: 60, totalTokenCount: 1934 });
    }) as unknown as EgressFn;
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'gemini-3.6-flash', rotationEnabled: false }),
      egress,
      onLog: (entry) => logs.push(entry),
      now: () => t,
    });
    await client.generateStructured({ method: 'x', prompt: 'p', responseSchema: {}, validate: (raw) => raw });
    const response = logs.find((l) => l.type === 'response');
    expect(response?.payload).toMatchObject({
      model: 'gemini-3.6-flash',
      latencyMs: 4_200,
      usage: { promptTokenCount: 1874, candidatesTokenCount: 60, totalTokenCount: 1934 },
    });
  });
});

describe('GeminiClient 429 cooldowns follow the server\'s own quota signals', () => {
  function quotaBody(quotaId: string, retryDelay?: string) {
    return {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota.',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
          ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
        ],
      },
    };
  }
  function clientWith(response: Response) {
    const recordCooldown = vi.fn();
    const egress = vi.fn(async () => response) as unknown as EgressFn;
    const logs: GenAILogEntry[] = [];
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'gemini-3.6-flash', rotationEnabled: false }),
      egress,
      onLog: (entry) => logs.push(entry),
      governor: { commit: vi.fn(), recordCooldown },
      now: () => Date.UTC(2026, 8, 3, 14, 7, 15), // 07:07 PT
    });
    return { client, recordCooldown, logs };
  }

  it('a per-minute exhaustion waits exactly the RetryInfo delay', async () => {
    const { client, recordCooldown } = clientWith(
      new Response(JSON.stringify(quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '18s')), { status: 429 }),
    );
    await expect(client.generateText('p')).rejects.toBeInstanceOf(GenAIHttpError);
    expect(recordCooldown).toHaveBeenCalledWith(18_000, 'gemini-3.6-flash');
  });

  it('a Retry-After header wins over the body hint', async () => {
    const { client, recordCooldown } = clientWith(
      new Response(JSON.stringify(quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '18s')), {
        status: 429,
        headers: { 'Retry-After': '7' },
      }),
    );
    await expect(client.generateText('p')).rejects.toBeInstanceOf(GenAIHttpError);
    expect(recordCooldown).toHaveBeenCalledWith(7_000, 'gemini-3.6-flash');
  });

  it('a DAILY exhaustion cools the pool down until the next Pacific day and says so in the log', async () => {
    const { client, recordCooldown, logs } = clientWith(
      new Response(JSON.stringify(quotaBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '18s')), { status: 429 }),
    );
    await expect(client.generateText('p')).rejects.toMatchObject({
      context: expect.objectContaining({ dailyQuotaExhausted: true }),
    });
    const [ms, pool] = recordCooldown.mock.calls[0] as [number, string];
    expect(pool).toBe('gemini-3.6-flash');
    // 07:07 PT → the day flips at midnight PT, 17 probe-hours later (coarse bound).
    expect(ms).toBe(17 * 3_600_000);
    const error = logs.find((l) => l.type === 'error');
    expect(error?.payload).toMatchObject({
      dailyQuotaExhausted: true,
      quotaIds: ['GenerateRequestsPerDayPerProjectPerModel-FreeTier'],
      retryAfterMs: 17 * 3_600_000,
    });
  });

  it('with no hint at all the default 30 s cooldown applies', async () => {
    const { client, recordCooldown } = clientWith(errorResponse(429, 'RESOURCE_EXHAUSTED'));
    await expect(client.generateText('p')).rejects.toBeInstanceOf(GenAIHttpError);
    expect(recordCooldown).toHaveBeenCalledWith(30_000, 'gemini-3.6-flash');
  });
});

/**
 * The Oct 2026 export: 11 of 13 reference-detection requests died on a 503
 * ("This model is currently experiencing high demand") from gemini-3.8-flash
 * and one on the 60 s gateway timeout — every one thrown as terminal with
 * eight untried rotation models below it, then re-sent to the same model five
 * minutes later, for sixteen hours. A transiently unavailable model now
 * rotates on and cools down so the NEXT request skips it pre-network; with
 * rotation off a 503 gets one short same-model retry before it is terminal.
 */
describe('regression: an overloaded or timed-out model rotates instead of ending the request', () => {
  const model = (url: string) => url.match(/models\/([^:]+):/)?.[1];
  const overloaded = () =>
    errorResponse(
      503,
      'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    );
  /** The gateway's timeout as it reaches the client: by C10 code, no subclass identity needed. */
  const timeout = () =>
    new AppError('Egress to "gemini" timed out after 60000ms.', {
      code: 'NET_TIMEOUT',
      retryable: true,
      context: { destinationId: 'gemini', timeoutMs: 60_000 },
    });
  const governor = () => ({ commit: vi.fn(), recordCooldown: vi.fn() });

  it('a 503 with rotation ON moves to the next model and cools the overloaded one down', async () => {
    const gov = governor();
    const { client, calls, logs } = makeClient(
      [overloaded(), geminiResponse('success')],
      { rotationEnabled: true },
      { governor: gov },
    );
    await expect(client.generateText('prompt')).resolves.toBe('success');
    expect(calls.map((c) => model(c.url))).toEqual([GENAI_ROTATION_MODELS[0], GENAI_ROTATION_MODELS[1]]);
    expect(gov.recordCooldown).toHaveBeenCalledWith(UNAVAILABLE_COOLDOWN_MS, GENAI_ROTATION_MODELS[0]);
    // Expected chatter while a demand spike lasts: a debug step, no error entry.
    expect(logs.filter((l) => l.type === 'error')).toHaveLength(0);
    expect(logs.filter((l) => l.type === 'debug')[0].payload).toMatchObject({
      status: 503,
      model: GENAI_ROTATION_MODELS[0],
      retryable: true,
    });
  });

  it('a 503 Retry-After header sets the length of the cooldown', async () => {
    const gov = governor();
    const { client } = makeClient(
      [
        new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } }), {
          status: 503,
          headers: { 'Retry-After': '45' },
        }),
        geminiResponse('success'),
      ],
      { rotationEnabled: true },
      { governor: gov },
    );
    await expect(client.generateText('prompt')).resolves.toBe('success');
    expect(gov.recordCooldown).toHaveBeenCalledWith(45_000, GENAI_ROTATION_MODELS[0]);
  });

  it('a gateway timeout with rotation ON rotates on and cools the silent model down', async () => {
    const gov = governor();
    const urls: string[] = [];
    const egress = vi.fn(async (_id: string, url: string) => {
      urls.push(url);
      if (urls.length === 1) throw timeout();
      return geminiResponse('late but fine');
    }) as unknown as EgressFn;
    const logs: GenAILogEntry[] = [];
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'unused', rotationEnabled: true }),
      egress,
      onLog: (entry) => logs.push(entry),
      governor: gov,
      sleep: async () => {},
    });
    await expect(client.generateText('prompt')).resolves.toBe('late but fine');
    expect(urls.map(model)).toEqual([GENAI_ROTATION_MODELS[0], GENAI_ROTATION_MODELS[1]]);
    expect(gov.recordCooldown).toHaveBeenCalledWith(UNAVAILABLE_COOLDOWN_MS, GENAI_ROTATION_MODELS[0]);
    expect(logs.filter((l) => l.type === 'error')).toHaveLength(0);
    expect(logs.filter((l) => l.type === 'debug')[0].payload).toMatchObject({ code: 'NET_TIMEOUT' });
  });

  it('with rotation OFF a 503 is retried once on the same model after the short pause', async () => {
    const sleep = vi.fn(async () => {});
    const gov = governor();
    const { client, calls, logs } = makeClient([overloaded(), geminiResponse('recovered')], {}, { sleep, governor: gov });
    await expect(client.generateText('prompt')).resolves.toBe('recovered');
    expect(calls.map((c) => model(c.url))).toEqual(['my-specific-model', 'my-specific-model']);
    expect(sleep).toHaveBeenCalledWith(OVERLOADED_RETRY_DELAY_MS);
    // The retry is the recovery path, not a cooldown: the model stays usable.
    expect(gov.recordCooldown).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.type === 'error')).toHaveLength(0);
    expect(logs.filter((l) => l.type === 'debug')).toHaveLength(1);
  });

  it('with rotation OFF a second 503 is terminal, logged once, and cools the model down', async () => {
    const gov = governor();
    const { client, calls, logs } = makeClient([overloaded(), overloaded()], {}, { governor: gov });
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(2);
    expect(gov.recordCooldown).toHaveBeenCalledWith(UNAVAILABLE_COOLDOWN_MS, 'my-specific-model');
    const errors = logs.filter((l) => l.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].payload).toMatchObject({ message: 'Request failed', status: 503, retryable: true });
  });

  it('with rotation OFF a timeout gets no second wait: terminal at once, model cooled down', async () => {
    const gov = governor();
    const sleep = vi.fn(async () => {});
    const egress = vi.fn(async () => {
      throw timeout();
    }) as unknown as EgressFn;
    const logs: GenAILogEntry[] = [];
    const client = new GeminiClient({
      getConfig: () => ({ apiKey: 'k', model: 'my-specific-model', rotationEnabled: false }),
      egress,
      onLog: (entry) => logs.push(entry),
      governor: gov,
      sleep,
    });
    await expect(client.generateText('prompt')).rejects.toMatchObject({ code: 'NET_TIMEOUT' });
    expect(egress).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(gov.recordCooldown).toHaveBeenCalledWith(UNAVAILABLE_COOLDOWN_MS, 'my-specific-model');
    expect(logs.filter((l) => l.type === 'error')[0].payload).toMatchObject({ code: 'NET_TIMEOUT' });
  });

  it('every rotation model overloaded ends in ONE terminal error after the debug steps', async () => {
    const gov = governor();
    const { client, calls, logs } = makeClient(
      GENAI_ROTATION_MODELS.map(() => overloaded()),
      { rotationEnabled: true },
      { governor: gov },
    );
    await expect(client.generateText('prompt')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(GENAI_ROTATION_MODELS.length);
    expect(gov.recordCooldown).toHaveBeenCalledTimes(GENAI_ROTATION_MODELS.length);
    expect(logs.filter((l) => l.type === 'debug')).toHaveLength(GENAI_ROTATION_MODELS.length);
    expect(logs.filter((l) => l.type === 'error')).toHaveLength(1);
  });
});
