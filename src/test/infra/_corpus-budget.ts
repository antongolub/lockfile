/**
 * Time budget for the audits that own an irreducible full-corpus pass.
 *
 * Four audits each walk a whole corpus through `parse` + `stringify` because
 * they own a global boundary — npm's parse+emit and byte-exact floors and the
 * authoritative source-target seal, Berry's strict-replay boundary, Deno's
 * byte-replay boundary. Three other audits were deliberately narrowed so these
 * passes are paid exactly once; the cost that remains cannot be prefiltered away
 * without giving up the boundary itself.
 *
 * V8 coverage instrumentation adds a measured **~34%** to such a walk
 * (117.8s → 158.0s isolated, on `npm-undetected-corpus-audit`). That is enough
 * to cross limits the plain lane clears comfortably, so the coverage lane gets
 * proportionally more room and the plain lane keeps its tighter budget — where a
 * genuine slowdown should still be caught.
 *
 * A per-test timeout argument overrides Vitest's `--testTimeout`, which is why
 * this is a value the tests import rather than a flag on the coverage script.
 */
const COVERAGE_LANE = process.env.VITEST_COVERAGE_LANE === '1'

export function corpusBudget(plainMs: number): number {
  return COVERAGE_LANE ? Math.round(plainMs * 2.5) : plainMs
}
