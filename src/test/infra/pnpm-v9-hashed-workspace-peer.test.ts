import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const input = readFileSync(resolve(
  here,
  '../resources/fixtures/real-world/angular-angular-main-45e8fb5/pnpm-lock.yaml',
), 'utf8')

const peerNames = [
  '@angular/compiler',
  '@angular/compiler-cli',
  '@angular/core',
  '@angular/localize',
  '@angular/platform-browser',
  '@angular/platform-server',
  '@angular/service-worker',
] as const

const unmatchedHash = '53b8fd9b7f33abb48dff18614cf85bde'
const verifiedHash = '76f7ce8ab1496e5ff1686e35b93237c8'

function hashedBuildId(graph: ReturnType<typeof parse>, digest: string): string {
  const matches = Array.from(graph.nodes()).filter(node => (
    node.name === '@angular/build'
    && node.version === '22.0.0-rc.2'
    && node.peerContext.includes(digest)
  ))
  expect(matches).toHaveLength(1)
  return matches[0]!.id
}

function workspacePeerAliases(graph: ReturnType<typeof parse>, sourceId: string): string[] {
  return graph.out(sourceId)
    .filter(edge => edge.kind === 'peer' && graph.getNode(edge.dst)?.workspacePath !== undefined)
    .map(edge => edge.attrs?.alias ?? graph.getNode(edge.dst)?.name ?? '')
    .sort()
}

function rewriteHashedSnapshot(
  source: string,
  digest: string,
  rewrite: (block: string) => string,
): string {
  const marker = `  '@angular/build@22.0.0-rc.2(${digest})':`
  const start = source.indexOf(marker)
  const end = source.indexOf("\n  '", start + marker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(0, start) + rewrite(source.slice(start, end)) + source.slice(end)
}

describe('pnpm-v9 hashed workspace peer recovery', () => {
  it('recovers one verified seven-peer set and leaves only seven declared drops', () => {
    const graph = parse('pnpm-v9', input)
    const codes = graph.diagnostics().map(diagnostic => diagnostic.code)

    expect(codes.filter(code => code === 'PNPM_WORKSPACE_LINK_PEER_BOUND')).toHaveLength(27)
    expect(codes.filter(code => code === 'PNPM_WORKSPACE_LINK_EDGE_DROPPED')).toHaveLength(7)
  })

  it('binds exactly the seven producer-hash-verified workspace peers', () => {
    const graph = parse('pnpm-v9', input)
    expect(workspacePeerAliases(graph, hashedBuildId(graph, verifiedHash))).toEqual([...peerNames].sort())
  })

  it('keeps a zero-preimage peer set fail-closed instead of guessing', () => {
    const graph = parse('pnpm-v9', input)
    const unmatchedId = hashedBuildId(graph, unmatchedHash)
    const drops = graph.diagnostics().filter(diagnostic => (
      diagnostic.code === 'PNPM_WORKSPACE_LINK_EDGE_DROPPED'
      && diagnostic.subject === unmatchedId
    ))

    expect(workspacePeerAliases(graph, unmatchedId)).toEqual([])
    expect(drops).toHaveLength(7)
  })

  it('retains the native digest keys and recovered edges through stringify and reparse', () => {
    const reparsed = parse('pnpm-v9', stringify(parse('pnpm-v9', input), 'pnpm-v9'))

    expect(workspacePeerAliases(reparsed, hashedBuildId(reparsed, verifiedHash))).toEqual([...peerNames].sort())
    expect(workspacePeerAliases(reparsed, hashedBuildId(reparsed, unmatchedHash))).toEqual([])
  })

  it('keeps an otherwise matching digest fail-closed when one peer name has two observable resolutions', () => {
    const ambiguous = rewriteHashedSnapshot(input, verifiedHash, block => block.replace(
      '      watchpack: 2.5.1\n',
      '      watchpack: 2.5.1(@types/node@20.19.41)\n',
    ))
    expect(ambiguous).not.toBe(input)

    const graph = parse('pnpm-v9', ambiguous)
    const sourceId = hashedBuildId(graph, verifiedHash)
    expect(workspacePeerAliases(graph, sourceId)).toEqual([])
    expect(graph.diagnostics().filter(diagnostic => (
      diagnostic.code === 'PNPM_WORKSPACE_LINK_EDGE_DROPPED'
      && diagnostic.subject === sourceId
    ))).toHaveLength(7)
  })
})
