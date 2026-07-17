/**
 * Best-effort User Timing telemetry. Emits `performance.measure` entries so
 * hot paths (boot tasks, import phases, reader open) are visible in devtools
 * traces and readable by the E2E perf spec
 * (verification/test_perf_baseline.spec.ts) via
 * `performance.getEntriesByType('measure')`. Failures are swallowed: timing
 * telemetry must never break the instrumented path (some test environments
 * lack options-style `performance.measure`).
 */
export function measureSince(name: string, start: number): void {
  try {
    performance.measure(name, { start, end: performance.now() });
  } catch {
    // Swallow: telemetry only.
  }
}

/**
 * Emit a measure for a duration accumulated across many small slices (e.g.
 * per-chapter display time inside an extraction loop). The entry's duration
 * is exact; its start time is synthetic (`now - total`).
 */
export function measureTotal(name: string, totalMs: number): void {
  try {
    const end = performance.now();
    performance.measure(name, { start: Math.max(0, end - totalMs), end });
  } catch {
    // Swallow: telemetry only.
  }
}
