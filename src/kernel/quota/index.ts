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
  // Promoted onto the barrel for A7: the settings quota meters consume it as
  // `snapshot()`'s per-lane shape. Real production consumers are the
  // GenAIPanel `useQuotaMeters` hook + the presentational GenAISettingsTab
  // props (both typed by it), so it is no longer a knip-dead export.
  type LaneUsage,
} from './QuotaGovernor';
// The shared midnight-PT day key (Phase A DRY). Re-exported so the app-layer
// embedSpendReconciler imports the SAME helper the kernel governor uses (its
// cross-device stamps must match the kernel structurally). Consumer:
// app/quota/embedSpendReconciler.ts — knip-clean.
export { ptDayString } from './ptDay';
