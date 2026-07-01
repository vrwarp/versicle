/**
 * AnthropicClient suite — pins the Claude Messages API contract the client
 * targets: the browser-access headers, forced tool use for structured output
 * (incl. top-level-array unwrap), image-block translation + log redaction,
 * 429 → cooldown + typed error, the usage-based quota commit, provider/model
 * logging, and the not-configured guard.
 */
import { describe, expect, it, vi } from 'vitest';
import { AnthropicClient } from './AnthropicClient';
import { GenAIHttpError, GenAINotConfiguredError } from './errors';
import { SchemaType, type GenAIConfig } from './contract';
import type { EgressFn } from '@kernel/net';
import type { GenAILogEntry } from './logging';

function toolUseResponse(
  input: unknown,
  usage = { input_tokens: 10, output_tokens: 5 },
): Response {
  return new Response(
    JSON.stringify({ content: [{ type: 'tool_use', name: 'emit_result', input }], usage, stop_reason: 'tool_use' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function textResponse(text: string): Response {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 3 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, message = 'boom'): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'x', message } }), { status });
}

function makeClient(responses: Response[], config: Partial<GenAIConfig> = {}) {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit }[] = [];
  const egress = vi.fn(async (_id: string, url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('egress queue exhausted');
    return next;
  }) as unknown as EgressFn;
  const logs: GenAILogEntry[] = [];
  const commits: { lane: string; tokens: number; model: string | undefined }[] = [];
  const recordCooldown = vi.fn();
  const client = new AnthropicClient({
    getConfig: () => ({ apiKey: 'fake-key', model: 'claude-sonnet-5', rotationEnabled: false, ...config }),
    egress,
    onLog: (entry) => logs.push(entry),
    governor: {
      commit: (lane, tokens, model) => commits.push({ lane, tokens, model }),
      recordCooldown,
    },
  });
  return { client, calls, logs, commits, recordCooldown };
}

const OBJECT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: { ok: { type: SchemaType.BOOLEAN } },
  required: ['ok'],
};

describe('AnthropicClient', () => {
  it('hits the Messages endpoint with the browser-access headers', async () => {
    const { client, calls } = makeClient([toolUseResponse({ ok: true })]);
    await client.generateStructured({
      method: 'm',
      prompt: 'p',
      responseSchema: OBJECT_SCHEMA,
      validate: (raw) => raw as { ok: boolean },
    });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('fake-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('forces the tool and feeds tool_use.input to validate', async () => {
    const { client, calls } = makeClient([toolUseResponse({ ok: true })]);
    const validate = vi.fn((raw) => raw as { ok: boolean });
    const result = await client.generateStructured({
      method: 'm',
      prompt: 'p',
      responseSchema: OBJECT_SCHEMA,
      validate,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.tools[0].name).toBe('emit_result');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_result' });
    expect(validate).toHaveBeenCalledWith({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('unwraps a top-level-array result before validating', async () => {
    const arraySchema = {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.OBJECT, properties: { id: { type: SchemaType.STRING } }, required: ['id'] },
    };
    const { client, calls } = makeClient([toolUseResponse({ result: [{ id: '1' }] })]);
    const validate = vi.fn((raw) => raw as { id: string }[]);
    await client.generateStructured({ method: 'm', prompt: 'p', responseSchema: arraySchema, validate });
    // input_schema wraps the array in an object…
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.tools[0].input_schema.type).toBe('object');
    // …and the client unwraps `.result` back to the bare array for validate.
    expect(validate).toHaveBeenCalledWith([{ id: '1' }]);
  });

  it('translates inlineData image parts and redacts their bytes in the log', async () => {
    const { client, calls, logs } = makeClient([toolUseResponse({ ok: true })]);
    await client.generateStructured({
      method: 'generateTableAdaptations',
      prompt: {
        contents: [
          { role: 'user', parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }, { text: 'go' }] },
        ],
      },
      responseSchema: OBJECT_SCHEMA,
      validate: (raw) => raw as { ok: boolean },
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    // The request log carries the ORIGINAL prompt shape, redacted.
    const reqLog = logs.find((l) => l.type === 'request');
    const loggedPrompt = (reqLog?.payload as { prompt: { contents: { parts: { inlineData?: { data: string; redacted?: boolean } }[] }[] } }).prompt;
    const img = loggedPrompt.contents[0].parts[0].inlineData!;
    expect(img.data).toBeUndefined();
    expect(img.redacted).toBe(true);
  });

  it('commits input+output tokens and stamps provider/model on logs', async () => {
    const { client, logs, commits } = makeClient([toolUseResponse({ ok: true }, { input_tokens: 12, output_tokens: 8 })]);
    await client.generateStructured({
      method: 'm',
      prompt: 'p',
      responseSchema: OBJECT_SCHEMA,
      validate: (raw) => raw as { ok: boolean },
    });
    expect(commits).toEqual([{ lane: 'fg', tokens: 20, model: 'claude-sonnet-5' }]);
    expect(logs[0].provider).toBe('anthropic');
    expect(logs[0].model).toBe('claude-sonnet-5');
  });

  it('records a cooldown and throws GenAIHttpError on 429', async () => {
    const { client, recordCooldown } = makeClient([errorResponse(429, 'rate limited')]);
    await expect(
      client.generateStructured({ method: 'm', prompt: 'p', responseSchema: OBJECT_SCHEMA, validate: (r) => r }),
    ).rejects.toBeInstanceOf(GenAIHttpError);
    expect(recordCooldown).toHaveBeenCalledOnce();
  });

  it('throws GenAINotConfiguredError without calling egress when no key', async () => {
    const { client, calls } = makeClient([], { apiKey: '' });
    await expect(
      client.generateStructured({ method: 'm', prompt: 'p', responseSchema: OBJECT_SCHEMA, validate: (r) => r }),
    ).rejects.toBeInstanceOf(GenAINotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it('generateText joins text blocks', async () => {
    const { client } = makeClient([textResponse('hello world')]);
    await expect(client.generateText('prompt')).resolves.toBe('hello world');
  });
});
