/**
 * Runtime-only-graph variant of .dependency-cruiser.cjs, used exclusively by
 * scripts/depcruise-baseline.mjs to measure the `no-circular-runtime` count.
 *
 * Why a second cruise: dependency-cruiser reports at most ONE cycle per
 * dependency edge. On the full graph (tsPreCompilationDeps: true) an edge
 * that participates in both a type-edge-tainted cycle and an all-runtime
 * cycle may get reported only with the tainted cycle, which the rule's
 * viaOnly filter then discards — so the runtime-cycle count UNDERCOUNTS,
 * and unrelated type-graph cleanups "create" runtime violations by
 * unmasking them (the full-graph count can jump from type-only edits while
 * the runtime graph is bit-for-bit unchanged). Cruising with
 * tsPreCompilationDeps: false measures cycles on the runtime graph
 * directly, immune to that artifact; the viaOnly filter is then a no-op
 * (every edge in this graph is non-type-only) but is kept so the rule name
 * and intent stay aligned with the main config.
 */
const base = require('./.dependency-cruiser.cjs');

module.exports = {
  ...base,
  // Only the runtime-cycle rule is measured on this graph; every other rule
  // is measured on the full (type-edges-included) graph by the main config.
  forbidden: base.forbidden.filter((rule) => rule.name === 'no-circular-runtime'),
  options: { ...base.options, tsPreCompilationDeps: false },
};
