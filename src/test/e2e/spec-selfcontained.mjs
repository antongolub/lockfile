#!/usr/bin/env node
// Fails when a format or package-manager spec depends on this repository's code.
//
// docs/spec/formats/** and docs/spec/pm/** are written to be lifted into their own
// repository, and to be enough on their own to implement a format. A path into
// src/ breaks both: it resolves to nothing once the specs move, and it invites
// "go read the code" where the document owes an explanation.
//
// Not covered: docs/spec/decisions/** and docs/spec/style/** — ADRs and working
// notes are internal records of how this implementation got here, so citing it is
// what they are for.
//
// Evidence is still welcome; it just has to be citable from outside. Name a
// real-world lock by upstream identity (`qiwi/uniconfig@c5e7d5a`), quote a
// producer run with its exact binary version, describe the algorithm instead of
// linking the module that runs it. See docs/spec/style/evidence.md.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const ZONES = ['docs/spec/formats', 'docs/spec/pm']

// One deliberate exception: the evidence section of the formats index points at
// the fixture tree for people working inside this repository, and says in the
// same breath that no claim depends on it.
const ALLOWED = new Set(['docs/spec/formats/README.md'])

const CODE_PATH = /src\/(?:main|test)\/[A-Za-z0-9_./*{},-]*/g

const walk = async (dir) => {
  const out = []
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...await walk(rel))
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

const findings = []
for (const zone of ZONES) {
  for (const file of await walk(zone)) {
    if (ALLOWED.has(file)) continue
    const lines = (await readFile(join(root, file), 'utf8')).split('\n')
    lines.forEach((line, i) => {
      // A path belonging to another project is evidence about that project, not a
      // dependency on ours — `antongolub/yarn-audit-fix` may cite its own files.
      if (/\b[\w-]+\/[\w-]+\b.{0,40}src\//.test(line) && !/\bsrc\/(main|test)\/ts?\b/.test(line)) return
      for (const hit of line.match(CODE_PATH) ?? []) {
        findings.push({ file, line: i + 1, hit })
      }
    })
  }
}

if (findings.length > 0) {
  console.error(`SPEC FAIL ${findings.length} reference(s) into this repository's code:`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.hit}`)
  console.error('\nCite evidence so it survives the move: upstream identity, a pinned')
  console.error('producer run, or the algorithm itself. See docs/spec/style/evidence.md.')
  process.exit(1)
}

const scanned = (await Promise.all(ZONES.map(walk))).flat().length
console.log(`SPEC PASS ${scanned} format/pm specs carry no path into src/`)
