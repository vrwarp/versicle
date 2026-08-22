/**
 * Rules-lockout detection.
 *
 * This predicate decides whether the user is told their deployed Firebase
 * security rules are out of date. A false negative leaves them staring at
 * sync that silently does nothing; a false positive tells them to redeploy
 * rules over an unrelated network blip. Mutation testing found every one
 * of its branches unverified — the module had no test of its own.
 */
import { describe, expect, it } from 'vitest';
import { isPermissionDeniedEvent } from './permissionDenied';

describe('isPermissionDeniedEvent', () => {
  describe('recognises each rejection shape', () => {
    it('detects the Firestore permission-denied code', () => {
      expect(isPermissionDeniedEvent({ code: 'permission-denied' })).toBe(true);
    });

    it('detects the Cloud Storage unauthorized code', () => {
      expect(isPermissionDeniedEvent({ code: 'storage/unauthorized' })).toBe(true);
    });

    it('detects permission-denied named only in the message', () => {
      expect(isPermissionDeniedEvent({ message: 'FirebaseError: permission-denied' })).toBe(true);
    });

    it('detects the long-form insufficient-permissions message', () => {
      expect(isPermissionDeniedEvent({ message: 'Missing or insufficient permissions.' })).toBe(true);
    });

    /*
     * Each disjunct has to stand alone: a payload matching only one of the
     * four must still be detected.
     */
    it('needs only one of the four signals', () => {
      expect(isPermissionDeniedEvent({ code: 'permission-denied', message: 'unrelated' })).toBe(true);
      expect(isPermissionDeniedEvent({ code: 'unavailable', message: 'permission-denied' })).toBe(true);
    });
  });

  describe('rejects everything else', () => {
    it.each([
      ['unavailable', 'network transport failure'],
      ['not-found', 'document missing'],
      ['resource-exhausted', 'quota'],
      ['unauthenticated', 'signed out'],
    ])('does not flag %s', (code, message) => {
      expect(isPermissionDeniedEvent({ code, message })).toBe(false);
    });

    it('does not flag a near-miss storage code', () => {
      expect(isPermissionDeniedEvent({ code: 'storage/unauthenticated' })).toBe(false);
      expect(isPermissionDeniedEvent({ code: 'storage/object-not-found' })).toBe(false);
    });

    it('does not flag an empty or absent payload', () => {
      expect(isPermissionDeniedEvent({})).toBe(false);
      expect(isPermissionDeniedEvent(null)).toBe(false);
      expect(isPermissionDeniedEvent(undefined)).toBe(false);
    });

    it('does not flag a non-object payload', () => {
      expect(isPermissionDeniedEvent('permission-denied')).toBe(false);
      expect(isPermissionDeniedEvent(42)).toBe(false);
      expect(isPermissionDeniedEvent(true)).toBe(false);
    });

    it('ignores non-string code and message fields', () => {
      expect(isPermissionDeniedEvent({ code: { toString: () => 'permission-denied' } })).toBe(false);
      expect(isPermissionDeniedEvent({ message: ['permission-denied'] })).toBe(false);
    });
  });

  describe('walks nested payloads', () => {
    it('finds the rejection under an event.error wrapper', () => {
      expect(isPermissionDeniedEvent({ type: 'sync-failed', error: { code: 'permission-denied' } }))
        .toBe(true);
    });

    it('finds the rejection down an error cause chain', () => {
      expect(isPermissionDeniedEvent({ message: 'wrapper', cause: { code: 'permission-denied' } }))
        .toBe(true);
    });

    it('prefers error over cause when both are present', () => {
      // `error` is checked first; a match under it must be found even when
      // `cause` leads somewhere harmless.
      expect(isPermissionDeniedEvent({
        error: { code: 'permission-denied' },
        cause: { code: 'unavailable' },
      })).toBe(true);
    });

    it('follows cause when error is absent rather than stopping', () => {
      expect(isPermissionDeniedEvent({
        error: undefined,
        cause: { code: 'permission-denied' },
      })).toBe(true);
    });

    /*
     * The walk is depth-limited so a self-referential error cannot hang the
     * caller. Five levels are inspected; anything deeper is not reported.
     */
    it('finds a rejection at the deepest inspected level', () => {
      expect(isPermissionDeniedEvent({
        error: { error: { error: { error: { code: 'permission-denied' } } } },
      })).toBe(true);
    });

    it('gives up beyond the depth limit rather than recursing forever', () => {
      expect(isPermissionDeniedEvent({
        error: { error: { error: { error: { error: { code: 'permission-denied' } } } } },
      })).toBe(false);
    });

    it('terminates on a self-referential cause chain', () => {
      const loop: Record<string, unknown> = { message: 'looping' };

      loop.cause = loop;

      expect(isPermissionDeniedEvent(loop)).toBe(false);
    });

    it('stops walking when the chain ends in a non-object', () => {
      expect(isPermissionDeniedEvent({ error: 'permission-denied' })).toBe(false);
      expect(isPermissionDeniedEvent({ error: null })).toBe(false);
    });
  });
});
