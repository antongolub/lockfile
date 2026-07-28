import { describe, expect, it } from 'vitest'
import { assertConversionContract } from '../_assert.ts'
import { convert, parseFormat, stringifyFormat } from '../_dispatch.ts'
import { CONTRACTS, type ConversionContract } from '../_matrix.ts'
import { activeContract, observeInteropDiagnostics } from '../_observe.ts'
import { emptyGraph } from '../_snapshot.ts'

// Synthetic-graph adversarial: starts from an in-memory empty graph rather than
// a parseable source string, so it bypasses `convert` (which requires a valid
// source lockfile — yarn-classic empty-graph emit produces a header the classic
// parser rejects, tracked under the empty-classic-emit stub). Surface coverage
// is still real-graph comparison via `observeInteropDiagnostics`.
describe('interop adversarial §8.1 — empty graph conversion', () => {
  const graph = emptyGraph()

  for (const contract of CONTRACTS) {
    const title = contract.unsupportedReason === undefined
      ? `${contract.from} -> ${contract.to} keeps the graph empty and emits no spurious interop diagnostics`
      : `${contract.from} -> ${contract.to} fails closed before attempting empty-graph projection`
    it(title, () => {
      if (contract.unsupportedReason !== undefined) {
        expect(() => convert({
          from: contract.from,
          to: contract.to,
          source: 'this must not be parsed',
          mode: 'naive',
        })).toThrow(
          `convert: unsupported ${contract.from} -> ${contract.to}: ${contract.unsupportedReason}`,
        )
        return
      }
      const sourceLockfile = contract.from.startsWith('deno-v')
        ? emptyDenoLock(contract.from as Extract<typeof contract.from, `deno-v${string}`>)
        : stringifyEmpty(contract.from).lockfile
      const sourceGraph = contract.from.startsWith('deno-v')
        ? parseFormat(contract.from, sourceLockfile)
        : graph
      const emitted = stringifyEmpty(contract.to, sourceGraph)
      const destinationGraph = parseFormat(contract.to, emitted.lockfile)
      const interopDiagnostics = observeInteropDiagnostics(contract, {
        sourceGraph,
        destinationGraph,
        sourceLockfile,
        destinationLockfile: emitted.lockfile,
        mode: 'naive',
      })
      const observedContract = activeContract(contract, {
        sourceGraph,
        destinationGraph,
        sourceLockfile,
        destinationLockfile: emitted.lockfile,
        mode: 'naive',
      })

      assertConversionContract(observedContract, {
        graphSource: sourceGraph,
        graphDestination: destinationGraph,
        diagnostics: [...emitted.diagnostics, ...interopDiagnostics],
        mode: 'naive',
        fixture: 'empty-graph',
        graphReentered: isSameFamily(contract) ? parseFormat(contract.from, stringifyEmpty(contract.from, destinationGraph).lockfile) : undefined,
      })
    })
  }
})

function stringifyEmpty(format: ConversionContract['from'], graph = emptyGraph()) {
  return stringifyFormat(format, graph)
}

function emptyDenoLock(format: Extract<ConversionContract['from'], `deno-v${string}`>): string {
  const version = format.slice('deno-v'.length)
  return version === '2'
    ? `{\n  "version": "2",\n  "remote": {},\n  "npm": {\n    "specifiers": {},\n    "packages": {}\n  }\n}\n`
    : version === '3'
      ? `{\n  "version": "3",\n  "packages": {\n    "specifiers": {},\n    "jsr": {},\n    "npm": {}\n  },\n  "remote": {}\n}\n`
      : `{\n  "version": "${version}",\n  "specifiers": {},\n  "jsr": {},\n  "npm": {},\n  "remote": {}\n}\n`
}

function isSameFamily(contract: ConversionContract): boolean {
  return contract.from.startsWith('yarn-berry-') && contract.to.startsWith('yarn-berry-')
}
