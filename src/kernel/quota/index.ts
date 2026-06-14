/**
 * kernel/quota public surface (Phase A). Admission per C12: zero internal
 * imports beyond ~types/errors (the NET_RATE_LIMITED backpressure error it
 * throws); consumed by ≥2 domains (google/genai + the audio domain at
 * lib/tts). `@kernel/quota` is the import path consumers use.
 */
export {
  QuotaGovernor,
  setQuotaStore,
  type QuotaStore,
  type DailyUsage,
  type QuotaLimits,
  // Promoted onto the barrel for A6: the app-layer embedSpend reconciler
  // (app/quota/embedSpendReconciler.ts) returns one as the BG-lane limits
  // provider. Has a real production consumer (wireGoogle), so not knip-dead.
  type QuotaLimitsProvider,
} from './QuotaGovernor';

// `LaneUsage` (the single shared snapshot shape) is intentionally NOT
// re-exported yet: its only consumer is the settings meters (A7, deferred), so
// surfacing it on the barrel now would be a knip-flagged unused export. It
// stays exported from `./QuotaGovernor` (where `snapshot()`'s return type uses
// it) and is promoted onto this barrel when the meters land.
