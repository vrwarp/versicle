/**
 * Public surface of the quota module. It imports nothing internal beyond
 * `~types/errors` (the rate-limit backpressure error it throws) and is shared by
 * more than one feature area — the AI/Gemini code and the audio/TTS code — which
 * is why it lives in the dependency-free kernel layer. Consumers import it as
 * `@kernel/quota`.
 */
export {
  QuotaGovernor,
  setQuotaStore,
  type QuotaStore,
  type DailyUsage,
  type QuotaLimits,
  // Exported for the app-side cross-device spend reconciler
  // (app/quota/embedSpendReconciler.ts), which returns one as the background-lane
  // limits provider.
  type QuotaLimitsProvider,
  // Exported for the settings quota meters: it is `snapshot()`'s per-lane shape,
  // consumed by the GenAI panel's `useQuotaMeters` hook and the GenAI settings
  // tab props.
  type LaneUsage,
} from './QuotaGovernor';
// Re-export the midnight-Pacific day-key helper so the app-side cross-device
// spend reconciler (app/quota/embedSpendReconciler.ts) uses the EXACT SAME
// helper the governor uses — their per-day stamps must match or a sibling
// device's spend would be silently dropped.
export { ptDayString } from './ptDay';
