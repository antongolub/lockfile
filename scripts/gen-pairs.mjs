#!/usr/bin/env node
// Generates docs/arch/PAIRS.md — one recipe row per ordered format pair.
//
// Hand-maintaining 380 rows guarantees drift, so every row is derived:
//   - which pairs exist, and what each loses -> src/test/interop/_matrix.ts
//   - what the runtime actually emits and how it can be repaired ->
//     src/main/ts/completeness/projection.ts (diagnosticLossClass /
//     diagnosticRemedy). The INTEROP_* strings in the matrix are that suite's
//     observation vocabulary and never reach onDiagnostic, so they are mapped
//     here to the codes convert() really emits rather than printed verbatim.
//
// This module only builds the document. The drift gate that can FAIL a run lives
// in src/test/e2e/pairs.mjs and imports `render` from here — scripts/ builds or
// reports, src/test/ is what is allowed to break the build.
//
// Run: node scripts/gen-pairs.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PAIRS_PATH = join(root, 'docs/arch/PAIRS.md')

// --- load the declared contracts through esbuild (the matrix is TypeScript) ---
export async function loadContracts() {
  const tmp = mkdtempSync(join(tmpdir(), 'lockgraph-pairs-'))
  try {
    const entry = join(tmp, 'entry.mjs')
    writeFileSync(entry, `export { CONTRACTS } from ${JSON.stringify(join(root, 'src/test/interop/_matrix.ts'))}\n`)
    const bundle = join(tmp, 'bundle.mjs')
    execFileSync(join(root, 'node_modules/.bin/esbuild'),
      [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=error'])
    const { CONTRACTS } = await import(`file://${bundle}`)
    return CONTRACTS
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- feature -> what it means for a reader -----------------------------------
// Keys are the matrix's LossFeature values; every one in ALL_FEATURES must be
// present or generation fails loudly rather than emitting a blank cell.
const FEATURES = {
  'compressionLevel': 'the `compressionLevel` subkey',
  'conditions': 'the `conditions` block',
  'multi-spec-collapsed': 'merged descriptor sets',
  'workspace-rekey': "workspace node ids — rekeyed to the target's scheme, graph preserved",
  'peer-virt': 'peer virtualization',
  'patch': 'the patch recipe',
  'sentinel-collapsed': 'unresolved-sentinel patch slots',
  'virtual': 'virtual node identities',
  'workspace-metadata': 'workspace metadata',
  'cacheKey': "the checksum's cache-key domain",
  'edges': 'unkeyable dependency edges',
  'tarballs': 'tarball payload metadata',
  'workspace': 'workspace members',
  // The URL is NOT dropped: the berry locator is emitted into the target's
  // `resolved:` field and survives as attribution. What degrades is the canonical
  // resolution TYPE, which the target parser can no longer classify as a tarball.
  'resolved-url': 'resolution type — degrades to `unknown`; the raw locator survives as attribution',
  'workspace-root-version': 'the root workspace version',
  'edge-kinds': 'edge kinds',
  'deno-jsr': 'JSR packages',
  'deno-remote': 'remote-URL modules',
}

const familyOf = (f) => f.startsWith('npm') ? 'npm'
  : f.startsWith('yarn-berry') ? 'yarn-berry'
  : f === 'yarn-classic' ? 'yarn-classic'
  : f.startsWith('pnpm') ? 'pnpm'
  : f.startsWith('bun') ? 'bun' : 'deno'

const NODE_FAMILIES = new Set(['npm', 'yarn-classic', 'yarn-berry', 'pnpm', 'bun'])

// --- structural capability overlay -------------------------------------------
// The matrix declares what its FIXTURES prove, which is narrower than what a
// format structurally requires. These rules restore the format-level requirements,
// each traceable to a measured fact. The size of the gap is not hard-coded here —
// render() recomputes it into the document's own provenance section.
const OVERLAY = [
  {
    // A yarn.lock has no project root, omits independent workspace members, and
    // cannot classify dev/peer — CONVERT.md "the two sharp edges".
    when: (c) => c.from === 'yarn-classic',
    code: '`YARN_CLASSIC_NO_MANIFESTS`',
    fix: '`sources.manifests` (root + members)',
    cannot: '`peer` edges — a `yarn.lock` cannot record them',
  },
  {
    // Emitting a yarn.lock needs the same classification on the target side.
    when: (c) => c.to === 'yarn-classic' && c.from !== 'yarn-classic',
    code: '`YARN_CLASSIC_NO_MANIFESTS`',
    fix: '`sources.manifests` (for `dev`)',
    cannot: '`peer` edges — no field in the target',
  },
  {
    // Berry's checksum covers a zip only Yarn produces, so it is recomputed from
    // bytes; no other family carries it. README "When bytes are not enough" and
    // API.md#berry-cache-keys.
    when: (c) => familyOf(c.to) === 'yarn-berry' && familyOf(c.from) !== 'yarn-berry',
    code: '`ENRICH_REQUIRED`',
    fix: '`sources.artifacts` (Berry checksum)',
    cannot: null,
  },
  {
    // A deno.lock has no dev/prod declaration distinction.
    when: (c) => familyOf(c.from) === 'deno' && NODE_FAMILIES.has(familyOf(c.to)),
    code: '`DENO_MANIFEST_REQUIRED`',
    fix: 'the sibling `deno.json`',
    cannot: null,
  },
]

// Status is derived from the recipe, never set by hand: ❌ the pair is refused,
// ✅ the lock alone is enough, ⚠️ it converts but something must be supplied or
// something is lost.
export const STATUS = { refused: '❌', clean: '✅', caveat: '⚠️' }

// Reported in "what the target drops", but they do NOT make a pair ⚠️ — none of
// them costs the caller anything. Marking them as caveats put 42 same-family pairs
// in the warning bucket for nothing.
const NON_DEGRADING = new Set([
  // Every pinned Berry producer strips this unknown __metadata subkey during a
  // mutable install, so dropping it is what Yarn itself does.
  'compressionLevel',
  // The target rekeys node identity to its own scheme; the graph is preserved.
  'workspace-rekey',
  // The merged descriptor set narrows. Cosmetic — resolution is unaffected.
  'multi-spec-collapsed',
])

function recipe(c) {
  if (c.unsupportedReason) {
    return {
      status: STATUS.refused,
      code: '`CAPABILITY_LACK`',
      fix: 'nothing — the pair is refused before parsing',
      cannot: c.unsupportedReason.replace(/^\S+ -> \S+ /, '').replace(/;.*$/, ''),
    }
  }

  const codes = []
  const fixes = []
  const cannot = []

  if ((c.enrichRequired ?? []).includes('manifests')) {
    codes.push('`ENRICH_REQUIRED`')
    fixes.push('`sources.manifests`')
  }
  for (const rule of OVERLAY) {
    if (!rule.when(c)) continue
    if (!codes.includes(rule.code)) codes.push(rule.code)
    if (!fixes.includes(rule.fix)) fixes.push(rule.fix)
    if (rule.cannot && !cannot.includes(rule.cannot)) cannot.push(rule.cannot)
  }

  // No declared loss is filtered out — an earlier revision dropped "enrichable"
  // ones and silently under-reported npm-4 -> npm-1. But nor is any of them called
  // irrecoverable: whether a dropped field can be refilled depends on the target
  // having a carrier for it, which the contracts do not state. The per-pair
  // `LossEntry.rationale` in _matrix.ts does, at 592 chars median — too long for a
  // cell, so this column reports WHAT the target drops and leaves WHY to the source.
  const lost = c.lost.map((l) => l.feature)
  if (lost.length > 0) {
    codes.push(`\`PROJECTION_LOSS\` (${lost.map((f) => `\`${f}\``).join(', ')})`)
    fixes.push('`strict: false`')
    for (const f of lost) cannot.push(FEATURES[f])
  }

  if (codes.length === 0) {
    return { status: STATUS.clean, code: '—', fix: 'nothing; the lock alone is enough', cannot: '—' }
  }
  // Costs the caller nothing: no evidence to supply, and every dropped feature is
  // one the target would have dropped itself.
  const free = fixes.length === 1 && fixes[0] === '`strict: false`'
    && lost.every((f) => NON_DEGRADING.has(f))
  return {
    status: free ? STATUS.clean : STATUS.caveat,
    code: codes.join('<br>'),
    fix: fixes.join('<br>'),
    cannot: cannot.length ? cannot.join('; ') : '—',
  }
}

const order = (f) => ['npm', 'yarn-classic', 'yarn-berry', 'pnpm', 'bun', 'deno'].indexOf(familyOf(f))
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true })

export function render(CONTRACTS) {
const missing = [...new Set(CONTRACTS.flatMap((c) => c.lost.map((l) => l.feature)))]
  .filter((f) => !(f in FEATURES))
if (missing.length > 0) {
  throw new Error(`gen-pairs: unmapped loss features: ${missing.join(', ')}`)
}

const sorted = [...CONTRACTS].sort((a, b) =>
  order(a.from) - order(b.from)
  || byName(a.from, b.from)
  || order(a.to) - order(b.to)
  || byName(a.to, b.to))

// Grouped by the concrete source format, not the family: it drops the `From`
// column entirely, which is what stops a narrow cell wrapping `yarn-classic`
// across two lines at the hyphen. Nothing here uses a non-breaking hyphen — a
// lookalike U+2011 in a format id would survive copy-paste and fail silently.
const groups = new Map()
for (const c of sorted) {
  if (!groups.has(c.from)) groups.set(c.from, [])
  groups.get(c.from).push(c)
}

// Measured, not asserted: how far the declared contracts fall short of the
// structural requirements the overlay restores. Recomputed on every generation so
// the claim cannot outlive the matrix it describes.
const toBerry = CONTRACTS.filter((c) =>
  familyOf(c.to) === 'yarn-berry' && familyOf(c.from) !== 'yarn-berry' && !c.unsupportedReason)
const berryTotal = toBerry.length
const berryGap = toBerry.filter((c) => !c.lost.some((l) => l.feature === 'cacheKey')).length
const statuses = CONTRACTS.map((c) => recipe(c).status)
const nClean = statuses.filter((s) => s === STATUS.clean).length
const nCaveat = statuses.filter((s) => s === STATUS.caveat).length
const nRefused = statuses.filter((s) => s === STATUS.refused).length

const fromClassic = CONTRACTS.filter((c) => c.from === 'yarn-classic' && !c.unsupportedReason)
const classicTotal = fromClassic.length
const classicGap = fromClassic.filter((c) =>
  c.lost.length === 0 && !(c.enrichRequired ?? []).length).length

let md = `# Conversion pairs — every combination, one row each

Generated by \`scripts/gen-pairs.mjs\` from the declared interop contracts. Do not
edit by hand.

${CONTRACTS.length} ordered pairs across ${new Set(CONTRACTS.map((c) => c.from)).size} concrete formats.
Find your source format's section, then your target row. For what the columns mean
and how to supply evidence, see [CONVERT.md](./CONVERT.md).

Rows describe a lock that does not use the target-exclusive features listed in
[what you lose](./CONVERT.md#what-you-lose); a lock that does adds that loss on top.
"Add to the call" names the option that repairs the gap — everything under
"What the target drops" is what the target format does not carry in this pair.

**Dropped is not the same as unrecoverable.** Where the target does have a carrier
for a field, enrichment can refill it — cross-family tarball payload metadata is the
common case, restored authoritatively from \`sources.packuments\` or
\`sources.manifests\`. Where it has none, the field is gone whatever you supply: into
\`npm-1\`, for instance, the entry schema holds only version, resolved and integrity.
Two entries are never losses at all — \`workspace-rekey\` means the target re-keys
node identity and preserves the graph, and \`compressionLevel\` is a producer-faithful
repair every pinned Berry release performs itself. Only ${STATUS.refused} rows and the
reasons spelled out in the cell are categorically unrecoverable; for the per-pair
argument see \`LossEntry.rationale\` in \`src/test/interop/_matrix.ts\`.

| | Meaning | Pairs |
| :-: | --- | --: |
| ${STATUS.clean} | Nothing to supply. Anything in the last column is something the target manager would drop itself. | ${nClean} |
| ${STATUS.caveat} | It converts, but evidence must be supplied or a real feature drops. Read the row. | ${nCaveat} |
| ${STATUS.refused} | Refused before parsing. No option makes it work. | ${nRefused} |

## Why a row can be stricter than the interop matrix

Diffing this file against \`_matrix.ts\` will show requirements the matrix does not
declare. That is deliberate, not drift. The matrix declares what its **fixtures
prove**; a format's structural requirements are wider. Measured on the contracts
this file was generated from:

- **${berryGap} of ${berryTotal}** non-berry → yarn-berry pairs declare no artifact
  requirement, although a Berry checksum covers a zip only Yarn produces and must be
  recomputed from bytes.${berryGap === berryTotal
  ? ' Every single one — so this is a systematic blind spot in the matrix, not a\n  tally of exceptions, and the matrix is the thing to fix eventually.'
  : ''}
- **${classicGap} of ${classicTotal}** yarn-classic-source pairs declare nothing at
  all, although a \`yarn.lock\` carries no project root, omits independent workspace
  members, and cannot classify \`dev\` or \`peer\`.

So the generator applies a capability overlay of four rules on top of the declared
contracts, each traceable in \`scripts/gen-pairs.mjs\` to a measured fact. Where the
two disagree, these rows are the stricter and the more truthful.
`

for (const [from, rows] of groups) {
  md += `\n## From \`${from}\`\n\n`
  md += '| To | Expected diagnostic | Add to the call | What the target drops | |\n'
  md += '| --- | --- | --- | --- | :-: |\n'
  for (const c of rows) {
    const r = recipe(c)
    md += `| \`${c.to}\` | ${r.code} | ${r.fix} | ${r.cannot} | ${r.status} |\n`
  }
}

return md
}

// CLI: write the document. The check lives in src/test/e2e/pairs.mjs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contracts = await loadContracts()
  writeFileSync(PAIRS_PATH, render(contracts))
  console.log(`gen-pairs: wrote ${PAIRS_PATH} (${contracts.length} pairs)`)
}
