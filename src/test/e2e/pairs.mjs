#!/usr/bin/env node
// Fails when docs/arch/PAIRS.md no longer matches the interop contracts it is
// derived from. The rendering itself lives in scripts/gen-pairs.mjs; this file
// exists separately because it is allowed to break the build and that one is not.

import { readFileSync } from 'node:fs'
import { loadContracts, PAIRS_PATH, render } from '../../../scripts/gen-pairs.mjs'

const contracts = await loadContracts()
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

console.log(`PAIRS PASS ${contracts.length} pairs match the interop contracts`)
