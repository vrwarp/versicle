/**
 * kernel/net public surface (Phase 7 §I). Admission per C12: zero internal
 * imports beyond ~types/errors; consumed by ≥2 domains (google, library,
 * search/dictionary, audio).
 */
export {
  EGRESS_DESTINATIONS,
  findDestination,
  allRegistryHosts,
  hostMatches,
  type DestinationId,
  type EgressDestination,
  type EgressDataClass,
  type EgressConsent,
} from './destinations';
export {
  egress,
  setConsentResolver,
  getEgressCounters,
  resetEgressCounters,
  type EgressFn,
  type EgressOptions,
  type EgressConsentContext,
  type ConsentResolver,
  type EgressCounters,
} from './NetworkGateway';
export {
  NetworkGatewayError,
  UnknownDestinationError,
  HostNotAllowedError,
  NetConsentRequiredError,
  NetTimeoutError,
  NetOfflineError,
} from './errors';
export { localFetch } from './local';
export { renderCsp, parseCsp, connectSrcSources } from './csp';
