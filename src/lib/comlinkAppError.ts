/**
 * Comlink transfer handler that carries {@link AppError}s across a worker
 * boundary WITHOUT losing their taxonomy.
 *
 * Comlink's built-in `throw` handler serializes a thrown error as
 * `{message, name, stack}` only — every own property (our stable `code`,
 * the `context` bag, `retryable`) is dropped, and the other side receives a
 * plain `Error`. Every consumer that branches on `code` across the boundary
 * was therefore dead code in production: the ReferenceSectionDetector's
 * GENAI_INVALID_RESPONSE terminal fallback runs in the TTS worker while the
 * model call runs on the main thread, so a validation-rejected answer arrived
 * code-less, was treated as transient, and was re-sent on every revisit (the
 * Jul–Sep 2026 log export shows each rejected section re-sent after the
 * 5-minute retry delay on builds that already carried the fallback).
 *
 * The fix wraps the built-in handler (same `canHandle`, so no private Comlink
 * symbol is needed): an AppError is serialized through `toJSON()` and revived
 * with `AppError.fromJSON()` — a base AppError with `code`, `context`,
 * `retryable`, `name` and the flattened cause chain intact. Anything else
 * takes the original path unchanged. Install it on BOTH sides of a channel
 * (the worker entry and the main-thread client), before the first call.
 */
import * as Comlink from 'comlink';
import { AppError, type SerializedAppError } from '~types/errors';

const INSTALLED = Symbol.for('versicle.comlink.appErrorTransfer');

/** Comlink's wire shape for a thrown value, plus our AppError marker. */
interface ThrownWireValue {
  isError: boolean;
  isAppError?: true;
  value: unknown;
}

type ThrowHandler = Comlink.TransferHandler<{ value: unknown }, ThrownWireValue> & {
  [INSTALLED]?: true;
};

export function installAppErrorTransferHandler(): void {
  const handlers = Comlink.transferHandlers as Map<string, Comlink.TransferHandler<unknown, unknown>>;
  const original = handlers.get('throw') as ThrowHandler | undefined;
  if (!original || original[INSTALLED]) return;

  const wrapped: ThrowHandler = {
    [INSTALLED]: true,
    canHandle: (value: unknown): value is { value: unknown } => original.canHandle(value),
    serialize(thrown) {
      if (thrown.value instanceof AppError) {
        return [{ isError: true, isAppError: true, value: thrown.value.toJSON() }, []];
      }
      return original.serialize(thrown);
    },
    deserialize(serialized) {
      if (serialized.isAppError) {
        throw AppError.fromJSON(serialized.value as SerializedAppError);
      }
      return original.deserialize(serialized);
    },
  };
  handlers.set('throw', wrapped as unknown as Comlink.TransferHandler<unknown, unknown>);
}
