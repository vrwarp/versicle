/**
 * kernel/net public surface (Phase 7 §I). Admission per C12: zero internal
 * imports beyond ~types/errors; consumed by ≥2 domains (google, library,
 * search/dictionary, audio).
 */
export { findDestination, type DestinationId } from './destinations';
export {
  egress,
  setConsentResolver,
  setQuotaScheduler,
  type EgressFn,
  type EgressOptions,
  type ConsentResolver,
} from './NetworkGateway';
export { NetConsentRequiredError, retryAfterMs } from './errors';
export { localFetch } from './local';
