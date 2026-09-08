// @vitest-environment node
/**
 * The worker-boundary regression: an AppError thrown on one side of a
 * Comlink channel must arrive on the other side WITH its stable `code`.
 * Comlink's stock throw handler keeps only message/name/stack, which is why
 * the detector's GENAI_INVALID_RESPONSE branch never ran in production.
 */
import { describe, expect, it } from 'vitest';
import * as Comlink from 'comlink';
import { AppError, NetRateLimitedError } from '~types/errors';
import { installAppErrorTransferHandler } from './comlinkAppError';

class GenAIInvalidResponseError extends AppError {
  constructor(message: string) {
    super(message, { code: 'GENAI_INVALID_RESPONSE', context: { referenceStartIndex: 0 } });
    this.name = 'GenAIInvalidResponseError';
  }
}

function channel() {
  const { port1, port2 } = new MessageChannel();
  const api = {
    reject: (): number => {
      throw new GenAIInvalidResponseError('referenceStartIndex 0 rejected');
    },
    backpressure: (): number => {
      throw new NetRateLimitedError(1500, { lane: 'fg', reason: 'cooldown' });
    },
    plain: (): number => {
      throw new TypeError('not an AppError');
    },
    ok: () => 42,
  };
  Comlink.expose(api, port1);
  const remote = Comlink.wrap<typeof api>(port2);
  return { remote, close: () => { port1.close(); port2.close(); } };
}

describe('AppError across a Comlink boundary', () => {
  it('WITHOUT the handler the code is lost (the production bug)', async () => {
    const { remote, close } = channel();
    try {
      await expect(remote.reject()).rejects.toMatchObject({ message: 'referenceStartIndex 0 rejected' });
      await expect(remote.reject()).rejects.not.toHaveProperty('code', 'GENAI_INVALID_RESPONSE');
    } finally {
      close();
    }
  });

  it('WITH the handler code, context, retryable and name survive; other errors are untouched', async () => {
    installAppErrorTransferHandler();
    installAppErrorTransferHandler(); // idempotent: a second install must not double-wrap
    const { remote, close } = channel();
    try {
      await expect(remote.reject()).rejects.toMatchObject({
        code: 'GENAI_INVALID_RESPONSE',
        name: 'GenAIInvalidResponseError',
        message: 'referenceStartIndex 0 rejected',
        context: { referenceStartIndex: 0 },
        retryable: false,
      });
      const revived = await remote.reject().catch((e: unknown) => e);
      expect(revived).toBeInstanceOf(AppError);

      await expect(remote.backpressure()).rejects.toMatchObject({
        code: 'NET_RATE_LIMITED',
        retryable: true,
        context: { retryAfterMs: 1500, lane: 'fg', reason: 'cooldown' },
      });
      await expect(remote.plain()).rejects.toMatchObject({ message: 'not an AppError', name: 'TypeError' });
      await expect(remote.ok()).resolves.toBe(42);
    } finally {
      close();
    }
  });
});
