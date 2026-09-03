#!/usr/bin/env node
// Fails when docs/arch/PAIRS.md no longer matches the interop contracts it is
// derived from. The rendering itself lives in scripts/gen-pairs.mjs; this file
// exists separately because it is allowed to break the build and that one is not.

import { readFileSync } from 'node:fs'
import { loadContracts, loadConvertibleFormats, PAIRS_PATH, render } from '../../../scripts/gen-pairs.mjs'

const contracts = await loadContracts()

// COVERAGE, checked before staleness. A format that is registered but absent from the
// matrix renders no rows, so the document still matches what the matrix produces and a
// pure staleness check passes — which is exactly how `bun-text-v2` reached parse, emit
// and detection with zero declared conversion pairs.
const formats = await loadConvertibleFormats()
const declared = new Set(contracts.flatMap(pair => [pair.from, pair.to]))
const uncovered = formats.filter(id => !declared.has(id))
const stray = [...declared].filter(id => !formats.includes(id))
const wanted = formats.length * (formats.length - 1)

if (uncovered.length > 0 || stray.length > 0 || contracts.length !== wanted) {
  console.error('PAIRS FAIL the interop matrix does not cover every convertible format')
  if (uncovered.length > 0) console.error(`  registered but undeclared: ${uncovered.join(', ')}`)
  if (stray.length > 0) console.error(`  declared but not registered: ${stray.join(', ')}`)
  console.error(`  ${formats.length} formats need ${wanted} ordered pairs; the matrix declares ${contracts.length}`)
  process.exit(1)
}

const expected = render(contracts)
const actual = readFileSync(PAIRS_PATH, 'utf8')

if (actual !== expected) {
  const a = actual.split('\n')
  const e = expected.split('\n')
  const at = a.findIndex((line, i) => line !== e[i])
  console.error('PAIRS FAIL docs/arch/PAIRS.md is stale — run `node scripts/gen-pairs.mjs`')
  console.error(`  first difference at line ${at + 1}`)
  console.error(`  on disk:  ${a[at] ?? '<end of file>'}`)
  console.error(`  expected: ${e[at] ?? '<end of file>'}`)
  process.exit(1)
}

console.log(`PAIRS PASS ${contracts.length} pairs cover all ${formats.length} convertible formats and match the contracts`)
