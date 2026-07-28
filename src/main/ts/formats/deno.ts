// Deno native `deno.lock` adapter (v2-v5).
//
// This adapter deliberately projects only the npm resolution subgraph. JSR,
// remote modules, redirects and workspace configuration remain native sidecar
// state and are replayed only by the same-format emitter. Deno has no
// dev/prod distinction in the lockfile.

import { createHash } from 'node:crypto'
import {
  GraphError,
  newBuilder,
  serializeNodeId,
  type Diagnostic,
  type EdgeAttrs,
  type Graph,
  type MutateResult,
  type Mutator,
  type Node,
} from '../graph.ts'
import { LockfileError } from '../api/errors.ts'
import { emitSri, isEmptyIntegrity, parseSri } from '../recipe/integrity.ts'

export interface DenoParseOptions {}

export interface DenoStringifyOptions {
  lineEnding?: 'lf' | 'crlf'
  onDiagnostic?: (diagnostic: Diagnostic) => void
}

type DenoVersion = '2' | '3' | '4' | '5'
type JsonObject = Record<string, unknown>

interface DenoNpmPackageId {
  readonly name: string
  readonly version: string
  readonly peers: readonly DenoNpmPackageId[]
  readonly raw: string
  readonly rawSuffix: string
}

interface DenoNpmPackageEntry extends JsonObject {
  integrity?: string
  dependencies?: Record<string, string> | string[]
  optionalDependencies?: Record<string, string> | string[]
  optionalPeers?: Record<string, string> | string[]
  os?: string[]
  cpu?: string[]
  tarball?: string
  deprecated?: boolean
  scripts?: boolean
  bin?: boolean
}

interface DenoLayout {
  readonly version: DenoVersion
  readonly document: JsonObject
  readonly specifiers: Record<string, string>
  readonly npm: Record<string, DenoNpmPackageEntry>
  readonly jsr: Record<string, unknown>
  readonly remote: Record<string, unknown>
}

interface DenoSidecar {
  readonly version: DenoVersion
  readonly originalInput: string
  readonly document: JsonObject
  readonly nativeByNode: Map<string, string>
  readonly nodeByNative: Map<string, string>
  readonly parsedByNative: Map<string, DenoNpmPackageId>
  readonly bumpedFromNative: Map<string, string>
  readonly dirtyNative: ReadonlySet<string>
  readonly exactReplay: boolean
  readonly unrepresentable: readonly string[]
}

interface DenoParseContext {
  readonly builder: ReturnType<typeof newBuilder>
  readonly layout: DenoLayout
  readonly diagnostics: Diagnostic[]
  readonly edgeKeys: Set<string>
  readonly parsedByNative: Map<string, DenoNpmPackageId>
  readonly nativeByNode: Map<string, string>
  readonly nodeByNative: Map<string, string>
  readonly nativeByName: Map<string, string[]>
  readonly unrepresentable: string[]
}

const sidecarByGraph = new WeakMap<Graph, DenoSidecar>()

export function hasAdapterState(graph: Graph): boolean {
  return sidecarByGraph.has(graph)
}

function rememberSidecar(graph: Graph, sidecar: DenoSidecar): void {
  sidecarByGraph.set(graph, sidecar)
}

export function rebindAdapterState(
  source: Graph,
  target: Graph,
): Readonly<{ graph: Graph; invalidated: readonly string[] }> {
  const sidecar = sidecarByGraph.get(source)
  if (sidecar === undefined) return { graph: target, invalidated: [] }
  const nativeByNode = new Map<string, string>()
  const nodeByNative = new Map<string, string>()
  const invalidated: string[] = []
  for (const [nodeId, nativeId] of sidecar.nativeByNode) {
    if (target.getNode(nodeId) === undefined) {
      invalidated.push(nodeId)
      continue
    }
    nativeByNode.set(nodeId, nativeId)
    nodeByNative.set(nativeId, nodeId)
  }
  const next: DenoSidecar = {
    ...sidecar,
    nativeByNode,
    nodeByNative,
    exactReplay: false,
    unrepresentable: [...sidecar.unrepresentable],
  }
  rememberSidecar(target, next)
  return { graph: target, invalidated: invalidated.sort() }
}

export function check(input: string): boolean {
  if (hasConflictMarkers(input)) {
    return /"version"\s*:\s*"[2345]"/.test(input)
      && /"(?:npm|packages|remote|specifiers)"\s*:/.test(input)
  }
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return false
  }
  if (!isObject(value)) return false
  const version = value.version
  if (version !== '2' && version !== '3' && version !== '4' && version !== '5') return false
  if (version === '2') return isObject(value.npm) || isObject(value.remote)
  if (version === '3') {
    return isObject(value.packages)
      || isObject(value.remote)
      || isObject(value.workspace)
  }
  return isObject(value.npm)
    || isObject(value.jsr)
    || isObject(value.specifiers)
    || isObject(value.remote)
    || isObject(value.redirects)
    || isObject(value.workspace)
}

export function parse(input: string, _options: DenoParseOptions = {}): Graph {
  if (hasConflictMarkers(input)) {
    throw failure(
      'DENO_MERGE_CONFLICT: deno.lock contains unresolved git conflict markers; resolve the merge before mutation',
    )
  }
  const layout = parseLayout(input)
  validateNonNpmIntegrity(layout)
  const context = createParseContext(layout)
  registerNpmNodes(context)
  addNpmEdges(context)
  addRootSpecifierEdges(context)
  return sealDenoGraph(context, input)
}

export function stringify(
  graph: Graph,
  options: DenoStringifyOptions = {},
): string {
  const sidecar = sidecarByGraph.get(graph)
  if (sidecar === undefined) {
    throw new LockfileError({
      code: 'CAPABILITY_LACK',
      message: 'deno emitter requires same-format native state',
    })
  }
  if (sidecar.exactReplay) return sidecar.originalInput
  if (sidecar.unrepresentable.length > 0) {
    throw new LockfileError({
      code: 'IRREDUCIBLE_LOSS',
      message: `deno emitter cannot safely represent mutation: ${sidecar.unrepresentable.join('; ')}`,
    })
  }
  return emitMutatedDocument(graph, sidecar, options)
}

function emitMutatedDocument(
  graph: Graph,
  sidecar: DenoSidecar,
  options: DenoStringifyOptions,
): string {
  const document = JSON.parse(JSON.stringify(sidecar.document)) as JsonObject
  const npm = mutableNpmRecord(document, sidecar.version)
  const specifiers = mutableSpecifierRecord(document, sidecar.version)
  const renameByOld = new Map<string, string>()
  for (const [nextNativeId, sourceNativeId] of sidecar.bumpedFromNative) {
    renameByOld.set(sourceNativeId, nextNativeId)
  }

  const currentNativeIds = new Set(sidecar.nodeByNative.keys())
  const nextNpm: Record<string, DenoNpmPackageEntry> = {}
  for (const [sourceNativeId, sourceEntry] of Object.entries(npm)) {
    const nativeId = renameByOld.get(sourceNativeId) ?? sourceNativeId
    if (!currentNativeIds.has(nativeId)) continue
    if (nextNpm[nativeId] !== undefined) {
      throw emitFailure(`native npm identity collision at ${nativeId}`)
    }
    nextNpm[nativeId] = sidecar.dirtyNative.has(nativeId)
      ? buildNpmEntry(graph, sidecar, nativeId, sourceEntry)
      : rewriteNpmEntryReferences(sourceEntry, renameByOld)
  }
  for (const nativeId of [...currentNativeIds].sort(compareStrings)) {
    if (nextNpm[nativeId] !== undefined) continue
    nextNpm[nativeId] = buildNpmEntry(graph, sidecar, nativeId)
  }
  replaceNpmRecord(document, sidecar.version, nextNpm)

  for (const [request, resolved] of Object.entries(specifiers)) {
    const rewritten = rewriteSpecifierResolution(sidecar.version, request, resolved, renameByOld)
    if (rewritten !== resolved) specifiers[request] = rewritten
  }

  const newline = options.lineEnding === 'crlf' ? '\r\n' : '\n'
  return JSON.stringify(document, null, 2).replaceAll('\n', newline) + newline
}

function mutableNpmRecord(
  document: JsonObject,
  version: DenoVersion,
): Record<string, DenoNpmPackageEntry> {
  if (version === '2') {
    const section = ensureObjectProperty(document, 'npm')
    return ensureObjectProperty(section, 'packages') as Record<string, DenoNpmPackageEntry>
  }
  if (version === '3') {
    const section = ensureObjectProperty(document, 'packages')
    return ensureObjectProperty(section, 'npm') as Record<string, DenoNpmPackageEntry>
  }
  return ensureObjectProperty(document, 'npm') as Record<string, DenoNpmPackageEntry>
}

function replaceNpmRecord(
  document: JsonObject,
  version: DenoVersion,
  npm: Record<string, DenoNpmPackageEntry>,
): void {
  if (version === '2') {
    ensureObjectProperty(document, 'npm').packages = npm
  } else if (version === '3') {
    ensureObjectProperty(document, 'packages').npm = npm
  } else {
    document.npm = npm
  }
}

function mutableSpecifierRecord(
  document: JsonObject,
  version: DenoVersion,
): Record<string, string> {
  if (version === '2') {
    return ensureObjectProperty(ensureObjectProperty(document, 'npm'), 'specifiers') as Record<string, string>
  }
  if (version === '3') {
    return ensureObjectProperty(ensureObjectProperty(document, 'packages'), 'specifiers') as Record<string, string>
  }
  return ensureObjectProperty(document, 'specifiers') as Record<string, string>
}

function ensureObjectProperty(object: JsonObject, key: string): JsonObject {
  const value = object[key]
  if (value === undefined) {
    const created: JsonObject = {}
    object[key] = created
    return created
  }
  return requiredObject(value, key)
}

function buildNpmEntry(
  graph: Graph,
  sidecar: DenoSidecar,
  nativeId: string,
  previous?: DenoNpmPackageEntry,
): DenoNpmPackageEntry {
  const nodeId = sidecar.nodeByNative.get(nativeId)
  const node = nodeId === undefined ? undefined : graph.getNode(nodeId)
  if (nodeId === undefined || node === undefined) {
    throw emitFailure(`native npm identity ${nativeId} has no graph node`)
  }
  const payload = graph.tarballOf(nodeId)
  if (payload === undefined || payload.integrity === undefined || isEmptyIntegrity(payload.integrity)) {
    throw emitFailure(`npm ${nativeId} lacks registry integrity evidence`)
  }
  const integrity = emitSri(payload.integrity)
  if (
    payload.integrity.hashes.length !== 1
    || payload.integrity.hashes[0]?.algorithm !== 'sha512'
  ) {
    throw emitFailure(`npm ${nativeId} integrity evidence is not singular SHA-512 SRI`)
  }
  if (payload.resolution?.type !== 'tarball') {
    throw emitFailure(`npm ${nativeId} lacks tarball resolution evidence`)
  }

  const entry: DenoNpmPackageEntry = { integrity }
  const defaultUrl = defaultNpmTarballUrl(node.name, node.version)
  if (previous?.tarball !== undefined || payload.resolution.url !== defaultUrl) {
    entry.tarball = payload.resolution.url
  }
  if (payload.os !== undefined) entry.os = [...payload.os]
  if (payload.cpu !== undefined) entry.cpu = [...payload.cpu]
  if (payload.deprecated !== undefined) entry.deprecated = true
  if (payload.hasInstallScript === true) entry.scripts = true
  if (payload.bin !== undefined) entry.bin = true

  const dependencies = dependencyBlockForEmit(graph, sidecar, nodeId, 'dep')
  const optionalDependencies = dependencyBlockForEmit(graph, sidecar, nodeId, 'optional')
  if (dependencies !== undefined) entry.dependencies = dependencies
  if (optionalDependencies !== undefined) entry.optionalDependencies = optionalDependencies
  const optionalPeers = Object.entries(payload.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta.optional === true)
    .map(([name]) => name)
    .sort(compareStrings)
  if (optionalPeers.length > 0) entry.optionalPeers = optionalPeers
  return entry
}

function dependencyBlockForEmit(
  graph: Graph,
  sidecar: DenoSidecar,
  srcId: string,
  kind: 'dep' | 'optional',
): Record<string, string> | string[] | undefined {
  const edges = graph.out(srcId, kind).slice().sort((a, b) => {
    const alias = compareStrings(a.attrs?.alias ?? '', b.attrs?.alias ?? '')
    return alias !== 0 ? alias : compareStrings(a.dst, b.dst)
  })
  if (edges.length === 0) return undefined
  if (sidecar.version === '2' || sidecar.version === '3') {
    const output: Record<string, string> = {}
    for (const edge of edges) {
      const target = graph.getNode(edge.dst)
      const nativeId = sidecar.nativeByNode.get(edge.dst)
      if (target === undefined || nativeId === undefined) {
        throw emitFailure(`${srcId} dependency ${edge.dst} lacks native Deno identity`)
      }
      output[edge.attrs?.alias ?? target.name] = nativeId
    }
    return output
  }

  const nativeIdsByName = new Map<string, string[]>()
  for (const [nodeId, nativeId] of sidecar.nativeByNode) {
    const node = graph.getNode(nodeId)
    if (node === undefined) continue
    const values = nativeIdsByName.get(node.name)
    if (values === undefined) nativeIdsByName.set(node.name, [nativeId])
    else values.push(nativeId)
  }
  return edges.map(edge => {
    const target = graph.getNode(edge.dst)
    const nativeId = sidecar.nativeByNode.get(edge.dst)
    if (target === undefined || nativeId === undefined) {
      throw emitFailure(`${srcId} dependency ${edge.dst} lacks native Deno identity`)
    }
    const alias = edge.attrs?.alias
    if (alias !== undefined) return `${alias}@npm:${nativeId}`
    return (nativeIdsByName.get(target.name)?.length ?? 0) === 1
      ? target.name
      : nativeId
  })
}

function rewriteSpecifierResolution(
  version: DenoVersion,
  request: string,
  resolved: string,
  renameByOld: ReadonlyMap<string, string>,
): string {
  if (version === '2') return renameByOld.get(resolved) ?? resolved
  if (version === '3') {
    const prefix = resolved.startsWith('npm:') ? 'npm:' : ''
    const body = prefix === '' ? resolved : resolved.slice(prefix.length)
    const next = renameByOld.get(body)
    return next === undefined ? resolved : `${prefix}${next}`
  }
  const name = npmTargetNameFromSpecifier(request)
  if (name === undefined) return resolved
  const oldNativeId = `${name}@${resolved}`
  const next = renameByOld.get(oldNativeId)
  if (next === undefined) return resolved
  return splitNameAndTail(next)?.tail ?? resolved
}

function rewriteNpmEntryReferences(
  entry: DenoNpmPackageEntry,
  renameByOld: ReadonlyMap<string, string>,
): DenoNpmPackageEntry {
  const rewritten = { ...entry }
  for (const key of ['dependencies', 'optionalDependencies'] as const) {
    const block = entry[key]
    if (Array.isArray(block)) {
      rewritten[key] = block.map(reference =>
        rewriteNativeReference(reference, renameByOld))
    } else if (isObject(block)) {
      rewritten[key] = Object.fromEntries(Object.entries(block).map(([name, reference]) => [
        name,
        typeof reference === 'string'
          ? rewriteNativeReference(reference, renameByOld)
          : reference,
      ]))
    }
  }
  return rewritten
}

function rewriteNativeReference(
  reference: string,
  renameByOld: ReadonlyMap<string, string>,
): string {
  const direct = renameByOld.get(reference)
  if (direct !== undefined) return direct
  const npmMarker = reference.indexOf('@npm:')
  if (npmMarker >= 0) {
    const prefix = reference.slice(0, npmMarker + '@npm:'.length)
    const next = renameByOld.get(reference.slice(npmMarker + '@npm:'.length))
    if (next !== undefined) return `${prefix}${next}`
  }
  if (reference.startsWith('npm:')) {
    const next = renameByOld.get(reference.slice('npm:'.length))
    if (next !== undefined) return `npm:${next}`
  }
  return reference
}

function npmTargetNameFromSpecifier(request: string): string | undefined {
  if (!request.startsWith('npm:')) return undefined
  const body = request.slice('npm:'.length)
  const split = splitNameAndTail(body)
  if (split === undefined) return body
  if (!split.tail.startsWith('npm:')) return split.name
  return splitNameAndTail(split.tail.slice('npm:'.length))?.name
}

function emitFailure(message: string): LockfileError {
  return new LockfileError({ code: 'IRREDUCIBLE_LOSS', message: `deno emitter: ${message}` })
}

function parseLayout(input: string): DenoLayout {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch (error) {
    throw new LockfileError({
      code: 'PARSE_FAILED',
      message: `deno adapter: invalid JSON: ${(error as Error).message}`,
      cause: error,
    })
  }
  if (!isObject(value)) throw failure('deno adapter: top-level value must be an object')
  const version = value.version
  if (version !== '2' && version !== '3' && version !== '4' && version !== '5') {
    throw new LockfileError({
      code: 'FORMAT_MISMATCH',
      message: `deno adapter: expected version 2-5, got ${JSON.stringify(version)}`,
    })
  }

  let npmValue: unknown
  let specifiersValue: unknown
  if (version === '2') {
    const npmSection = optionalObject(value.npm, 'npm')
    npmValue = npmSection.packages
    specifiersValue = npmSection.specifiers
  } else if (version === '3') {
    const packages = optionalObject(value.packages, 'packages')
    npmValue = packages.npm
    specifiersValue = packages.specifiers
  } else {
    npmValue = value.npm
    specifiersValue = value.specifiers
  }

  return {
    version,
    document: value,
    specifiers: stringRecord(specifiersValue, 'specifiers'),
    npm: npmRecord(npmValue),
    jsr: optionalObject(version === '3' ? optionalObject(value.packages, 'packages').jsr : value.jsr, 'jsr'),
    remote: optionalObject(value.remote, 'remote'),
  }
}

function createParseContext(layout: DenoLayout): DenoParseContext {
  return {
    builder: newBuilder(),
    layout,
    diagnostics: [],
    edgeKeys: new Set(),
    parsedByNative: new Map(),
    nativeByNode: new Map(),
    nodeByNative: new Map(),
    nativeByName: new Map(),
    unrepresentable: [],
  }
}

function registerNpmNodes(context: DenoParseContext): void {
  const canonicalCounts = new Map<string, number>()
  for (const nativeId of Object.keys(context.layout.npm).sort(compareStrings)) {
    const parsed = parseNpmPackageId(nativeId)
    context.parsedByNative.set(nativeId, parsed)
    const ids = context.nativeByName.get(parsed.name)
    if (ids === undefined) context.nativeByName.set(parsed.name, [nativeId])
    else ids.push(nativeId)
    const canonical = canonicalNodeId(parsed)
    canonicalCounts.set(canonical, (canonicalCounts.get(canonical) ?? 0) + 1)
  }

  for (const [nativeId, entry] of Object.entries(context.layout.npm).sort(compareEntries)) {
    const parsed = context.parsedByNative.get(nativeId)!
    const canonical = canonicalNodeId(parsed)
    const peerContext = canonicalPeerContext(
      parsed,
      (canonicalCounts.get(canonical) ?? 0) > 1,
      peer => resolvePeerNativeId(context, peer, entry) !== undefined,
    )
    const nodeId = serializeNodeId(parsed.name, parsed.version, peerContext)
    if (context.nativeByNode.has(nodeId)) {
      throw failure(`deno adapter: native npm ids collapse onto canonical NodeId ${nodeId}`)
    }
    const node: Node = {
      id: nodeId,
      name: parsed.name,
      version: parsed.version,
      peerContext,
    }
    context.builder.addNode(node)
    context.nativeByNode.set(nodeId, nativeId)
    context.nodeByNative.set(nativeId, nodeId)
    recordTarball(context, node, nativeId, entry)
  }
}

function recordTarball(
  context: DenoParseContext,
  node: Node,
  nativeId: string,
  entry: DenoNpmPackageEntry,
): void {
  const tarball = entry.tarball ?? defaultNpmTarballUrl(node.name, node.version)
  const payload: {
    integrity?: ReturnType<typeof parseSri>
    resolution: { type: 'tarball'; url: string }
    nativeResolution?: string
    os?: string[]
    cpu?: string[]
    deprecated?: string
    hasInstallScript?: boolean
    bin?: string
  } = {
    resolution: { type: 'tarball', url: tarball },
  }
  if (entry.tarball !== undefined) payload.nativeResolution = entry.tarball
  if (entry.integrity !== undefined) {
    const integrity = parseSri(entry.integrity, 'sri')
    if (
      isEmptyIntegrity(integrity)
      || integrity.hashes.length !== 1
      || integrity.hashes[0]?.algorithm !== 'sha512'
      || emitSri(integrity) !== entry.integrity
    ) {
      throw failure(`deno adapter: npm ${nativeId} integrity must be canonical SHA-512 SRI`)
    }
    payload.integrity = integrity
  } else if (entry.tarball === undefined) {
    throw failure(`deno adapter: npm ${nativeId} is missing both integrity and explicit tarball`)
  }
  if (entry.os !== undefined) payload.os = validateStringArray(entry.os, `npm.${nativeId}.os`)
  if (entry.cpu !== undefined) payload.cpu = validateStringArray(entry.cpu, `npm.${nativeId}.cpu`)
  if (entry.deprecated === true) payload.deprecated = 'deprecated'
  if (entry.scripts === true) payload.hasInstallScript = true
  if (entry.bin === true) payload.bin = ''
  context.builder.setTarball({ name: node.name, version: node.version }, payload)
}

function addNpmEdges(context: DenoParseContext): void {
  for (const [nativeId, entry] of Object.entries(context.layout.npm).sort(compareEntries)) {
    const srcId = context.nodeByNative.get(nativeId)!
    addDependencyBlock(context, srcId, entry.dependencies, 'dep')
    addDependencyBlock(context, srcId, entry.optionalDependencies, 'optional', true)
    addDependencyBlock(context, srcId, entry.optionalPeers, 'optional', true)

    const parsed = context.parsedByNative.get(nativeId)!
    const seenPeerBases = new Set<string>()
    for (const peer of parsed.peers) {
      const peerBase = serializeNodeId(peer.name, peer.version, [])
      if (seenPeerBases.has(peerBase)) continue
      seenPeerBases.add(peerBase)
      const peerNativeId = resolvePeerNativeId(context, peer, entry)
      if (peerNativeId === undefined) {
        context.diagnostics.push({
          code: 'DENO_PEER_PROJECTION_UNRESOLVED',
          subject: srcId,
          severity: 'warning',
          message: `deno adapter: native peer ${peer.name}@${peer.version} remains authoritative in the preserved suffix because no unique npm package can be projected`,
        })
        continue
      }
      const dstId = context.nodeByNative.get(peerNativeId)
      if (dstId === undefined) {
        throw failure(`deno adapter: npm ${nativeId} peer ${peerNativeId} is missing`)
      }
      addEdgeOnce(context, srcId, dstId, 'peer')
    }
  }
}

function resolvePeerNativeId(
  context: DenoParseContext,
  peer: DenoNpmPackageId,
  entry: DenoNpmPackageEntry,
): string | undefined {
  const exact = serializeNativePackageId(peer)
  if (context.parsedByNative.has(exact)) return exact
  const candidates = (context.nativeByName.get(peer.name) ?? [])
    .filter(nativeId => context.parsedByNative.get(nativeId)?.version === peer.version)
  if (candidates.length === 1) return candidates[0]!

  const referenced = dependencyRefs(context, entry)
    .filter(ref => ref.alias === peer.name)
    .map(ref => ref.nativeId)
    .filter(nativeId => context.parsedByNative.get(nativeId)?.version === peer.version)
  const unique = [...new Set(referenced)]
  if (unique.length === 1) return unique[0]!
  return undefined
}

function dependencyRefs(
  context: DenoParseContext,
  entry: DenoNpmPackageEntry,
): Array<{ alias: string; nativeId: string }> {
  const refs: Array<{ alias: string; nativeId: string }> = []
  for (const block of [entry.dependencies, entry.optionalDependencies, entry.optionalPeers]) {
    if (block === undefined) continue
    if (Array.isArray(block)) {
      for (const value of block) refs.push(dependencyRefFromCompact(context, value))
    } else {
      for (const [alias, nativeId] of Object.entries(block)) refs.push({ alias, nativeId })
    }
  }
  return refs
}

function addDependencyBlock(
  context: DenoParseContext,
  srcId: string,
  raw: Record<string, string> | string[] | undefined,
  kind: 'dep' | 'optional' | 'peer',
  allowMissing = false,
): void {
  if (raw === undefined) return
  const refs = Array.isArray(raw)
    ? raw.map(value => dependencyRefFromCompact(context, value))
    : Object.entries(raw).sort(compareEntries).map(([alias, nativeId]) => ({ alias, nativeId }))
  for (const ref of refs) {
    const dstId = context.nodeByNative.get(ref.nativeId)
    if (dstId === undefined) {
      const qualifier = allowMissing ? 'optional ' : ''
      context.diagnostics.push({
        code: allowMissing
          ? 'DENO_OPTIONAL_DEP_PROJECTION_UNRESOLVED'
          : 'DENO_DEP_PROJECTION_UNRESOLVED',
        subject: srcId,
        severity: 'warning',
        message: `deno adapter: ${qualifier}native reference ${ref.nativeId} has no npm package to project`,
      })
      context.unrepresentable.push(`${srcId} references missing native npm package ${ref.nativeId}`)
      continue
    }
    const target = context.parsedByNative.get(ref.nativeId)!
    const attrs: EdgeAttrs = {}
    if (ref.alias !== target.name) attrs.alias = ref.alias
    if (kind === 'optional') attrs.optional = true
    addEdgeOnce(context, srcId, dstId, kind, attrs)
  }
}

function dependencyRefFromCompact(
  context: DenoParseContext,
  value: string,
): { alias: string; nativeId: string } {
  const split = splitNameAndTail(value)
  if (split === undefined) {
    const candidates = context.nativeByName.get(value) ?? []
    if (candidates.length !== 1) {
      throw failure(`deno adapter: compact npm dependency ${value} is not uniquely resolvable`)
    }
    return { alias: value, nativeId: candidates[0]! }
  }
  if (split.tail.startsWith('npm:')) {
    const target = split.tail.slice('npm:'.length)
    const targetSplit = splitNameAndTail(target)
    if (targetSplit === undefined) {
      throw failure(`deno adapter: invalid npm alias dependency ${value}`)
    }
    return { alias: split.name, nativeId: target }
  }
  return { alias: split.name, nativeId: value }
}

function addRootSpecifierEdges(context: DenoParseContext): void {
  if (Object.keys(context.layout.specifiers).length === 0) return
  const root: Node = { id: '@0.0.0', name: '', version: '0.0.0', peerContext: [], workspacePath: '' }
  context.builder.addNode(root)
  const seen = new Set<string>()
  for (const [request, resolved] of Object.entries(context.layout.specifiers).sort(compareEntries)) {
    const ref = nativeIdFromSpecifier(context.layout.version, request, resolved)
    if (ref === undefined) continue
    const dstId = context.nodeByNative.get(ref.nativeId)
    if (dstId === undefined) {
      throw failure(`deno adapter: specifier ${request} references missing npm package ${ref.nativeId}`)
    }
    const identity = `${dstId}\0${ref.alias ?? ''}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const attrs: EdgeAttrs = { range: request }
    if (ref.alias !== undefined) attrs.alias = ref.alias
    context.builder.addEdge(root.id, dstId, 'dep', attrs)
  }
}

function nativeIdFromSpecifier(
  version: DenoVersion,
  request: string,
  resolved: string,
): { nativeId: string; alias?: string } | undefined {
  if (version === '2') {
    const requestParts = splitNameAndTail(request)
    const resolvedParts = splitNameAndTail(resolved)
    if (resolvedParts === undefined) return undefined
    const alias = requestParts?.name ?? request
    return alias === resolvedParts.name ? { nativeId: resolved } : { nativeId: resolved, alias }
  }
  if (!request.startsWith('npm:')) return undefined
  const requestBody = request.slice('npm:'.length)
  const requestParts = splitNameAndTail(requestBody)
  const name = requestParts?.name ?? requestBody
  if (version === '3') {
    const nativeId = resolved.startsWith('npm:') ? resolved.slice('npm:'.length) : resolved
    const target = splitNameAndTail(nativeId)
    if (target === undefined) return undefined
    return target.name === name ? { nativeId } : { nativeId, alias: name }
  }
  const nativeId = `${name}@${resolved}`
  return { nativeId }
}

function addEdgeOnce(
  context: DenoParseContext,
  src: string,
  dst: string,
  kind: 'dep' | 'optional' | 'peer',
  attrs?: EdgeAttrs,
): void {
  const key = `${src}\0${dst}\0${kind}\0${attrs?.alias ?? ''}`
  if (context.edgeKeys.has(key)) return
  context.edgeKeys.add(key)
  context.builder.addEdge(src, dst, kind, Object.keys(attrs ?? {}).length === 0 ? undefined : attrs)
}

function sealDenoGraph(context: DenoParseContext, input: string): Graph {
  for (const diagnostic of context.diagnostics) context.builder.diagnostic(diagnostic)
  try {
    const graph = context.builder.seal()
    const sidecar: DenoSidecar = {
      version: context.layout.version,
      originalInput: input,
      document: context.layout.document,
      nativeByNode: context.nativeByNode,
      nodeByNative: context.nodeByNative,
      parsedByNative: context.parsedByNative,
      bumpedFromNative: new Map(),
      dirtyNative: new Set(),
      exactReplay: true,
      unrepresentable: [...new Set(context.unrepresentable)].sort(),
    }
    return withSidecarPropagation(graph, sidecar)
  } catch (error) {
    if (error instanceof GraphError) {
      throw failure(`deno adapter seal failed: ${error.message}`)
    }
    throw error
  }
}

function withSidecarPropagation(graph: Graph, sidecar: DenoSidecar): Graph {
  const proxy: Graph = {
    getNode: (...args) => graph.getNode(...args),
    nodes: () => graph.nodes(),
    byName: (...args) => graph.byName(...args),
    roots: () => graph.roots(),
    out: (...args) => graph.out(...args),
    in: (...args) => graph.in(...args),
    walk: (...args) => graph.walk(...args),
    topoSort: () => graph.topoSort(),
    subgraph: (...args) => graph.subgraph(...args),
    diff: (...args) => graph.diff(...args),
    tarball: (...args) => graph.tarball(...args),
    tarballOf: (...args) => graph.tarballOf(...args),
    tarballs: () => graph.tarballs(),
    diagnostics: () => graph.diagnostics(),
    layoutHints: () => graph.layoutHints(),
    mutate(transaction: (mutator: Mutator) => void): MutateResult {
      const result = graph.mutate(transaction)
      const next = remapSidecarAfterMutation(sidecar, result)
      return { ...result, graph: withSidecarPropagation(result.graph, next) }
    },
  }
  rememberSidecar(graph, sidecar)
  rememberSidecar(proxy, sidecar)
  return proxy
}

function remapSidecarAfterMutation(sidecar: DenoSidecar, result: MutateResult): DenoSidecar {
  const replacementByOld = new Map<string, string>()
  for (const record of result.applied) {
    if ((record.kind === 'node-replaced' || record.kind === 'peer-context-replaced') && record.oldSubject !== undefined) {
      replacementByOld.set(record.oldSubject, record.subject)
    }
  }

  const directBumps: Array<{ from: DenoNpmPackageId; toVersion: string }> = []
  for (const [oldNodeId, nativeId] of sidecar.nativeByNode) {
    const nextNodeId = replacementByOld.get(oldNodeId)
    if (nextNodeId === undefined) continue
    const nextNode = result.graph.getNode(nextNodeId)
    const parsed = sidecar.parsedByNative.get(nativeId)
    if (
      nextNode !== undefined
      && parsed !== undefined
      && nextNode.name === parsed.name
      && nextNode.version !== parsed.version
    ) {
      directBumps.push({ from: parsed, toVersion: nextNode.version })
    }
  }

  const nativeByNode = new Map<string, string>()
  const nodeByNative = new Map<string, string>()
  const parsedByNative = new Map<string, DenoNpmPackageId>()
  const bumpedFromNative = new Map(sidecar.bumpedFromNative)
  const dirtyNative = new Set<string>()
  const unrepresentable = [...sidecar.unrepresentable]
  for (const [oldNodeId, nativeId] of sidecar.nativeByNode) {
    const nextNodeId = replacementByOld.get(oldNodeId) ?? oldNodeId
    const nextNode = result.graph.getNode(nextNodeId)
    if (nextNode === undefined) continue
    const oldParsed = sidecar.parsedByNative.get(nativeId)
    if (oldParsed === undefined) continue
    if (nextNode.name !== oldParsed.name) {
      unrepresentable.push(`renamed native npm identity ${nativeId} to ${nextNodeId}`)
      continue
    }
    const rewritten = rewriteNativePackageId(oldParsed, directBumps)
    const nextNativeId = serializeNativePackageId(rewritten)
    if (nextNode.version !== rewritten.version) {
      unrepresentable.push(`native npm identity ${nativeId} cannot prove version ${nextNode.version}`)
      continue
    }
    const sourceNativeId = sidecar.bumpedFromNative.get(nativeId) ?? nativeId
    if (nextNativeId !== nativeId) {
      bumpedFromNative.delete(nativeId)
      bumpedFromNative.set(nextNativeId, sourceNativeId)
      dirtyNative.add(nextNativeId)
    } else if (sidecar.dirtyNative.has(nativeId)) {
      dirtyNative.add(nextNativeId)
    }
    if (nodeByNative.has(nextNativeId)) {
      unrepresentable.push(`native npm identity collision at ${nextNativeId}`)
      continue
    }
    nativeByNode.set(nextNodeId, nextNativeId)
    nodeByNative.set(nextNativeId, nextNodeId)
    parsedByNative.set(nextNativeId, rewritten)
  }

  for (const node of result.graph.nodes()) {
    if (node.workspacePath !== undefined || nativeByNode.has(node.id)) continue
    if (node.peerContext.length > 0 || node.patch !== undefined || node.source !== undefined) {
      unrepresentable.push(`added npm node ${node.id} without proved native Deno identity`)
      continue
    }
    const nativeId = `${node.name}@${node.version}`
    if (nodeByNative.has(nativeId)) {
      unrepresentable.push(`added npm node ${node.id} collides at native identity ${nativeId}`)
      continue
    }
    nativeByNode.set(node.id, nativeId)
    nodeByNative.set(nativeId, node.id)
    parsedByNative.set(nativeId, parseNpmPackageId(nativeId))
    dirtyNative.add(nativeId)
  }

  for (const record of result.applied) {
    if (record.kind === 'edge-added' || record.kind === 'edge-removed') {
      const nativeId = nativeByNode.get(record.subject.src)
      if (nativeId !== undefined) dirtyNative.add(nativeId)
    } else if (record.kind === 'tarball-set' || record.kind === 'tarball-removed') {
      for (const [nodeId, nativeId] of nativeByNode) {
        const node = result.graph.getNode(nodeId)
        if (node !== undefined && `${node.name}@${node.version}` === record.subject) {
          dirtyNative.add(nativeId)
        }
      }
    }
  }

  return {
    ...sidecar,
    nativeByNode,
    nodeByNative,
    parsedByNative,
    bumpedFromNative,
    dirtyNative,
    exactReplay: sidecar.exactReplay && result.applied.length === 0,
    unrepresentable: [...new Set(unrepresentable)].sort(),
  }
}

function rewriteNativePackageId(
  id: DenoNpmPackageId,
  bumps: readonly { from: DenoNpmPackageId; toVersion: string }[],
): DenoNpmPackageId {
  const matching = bumps.find(bump => sameNativeTree(id, bump.from))
  const peers = id.peers.map(peer => rewriteNativePackageId(peer, bumps))
  return {
    ...id,
    version: matching?.toVersion ?? id.version,
    peers,
  }
}

function sameNativeTree(a: DenoNpmPackageId, b: DenoNpmPackageId): boolean {
  return a.name === b.name
    && a.version === b.version
    && a.peers.length === b.peers.length
    && a.peers.every((peer, index) => sameNativeTree(peer, b.peers[index]!))
}

function parseNpmPackageId(raw: string): DenoNpmPackageId {
  const parsed = parseNpmPackageIdAt(raw, 0, 0)
  if (parsed.offset !== raw.length) {
    throw failure(`deno adapter: invalid npm package id ${JSON.stringify(raw)}`)
  }
  return parsed.id
}

function parseNpmPackageIdAt(
  raw: string,
  offset: number,
  level: number,
): { id: DenoNpmPackageId; offset: number } {
  const start = offset
  let at = -1
  for (let i = offset; i < raw.length; i++) {
    if (i > offset && raw[i] === '@') {
      at = i
      break
    }
  }
  if (at < 0) throw failure(`deno adapter: invalid npm package id ${JSON.stringify(raw)}`)
  let end = at + 1
  while (end < raw.length && raw[end] !== '_') end++
  const encodedName = raw.slice(offset, at)
  const version = raw.slice(at + 1, end)
  if (encodedName === '' || version === '') {
    throw failure(`deno adapter: invalid npm package id ${JSON.stringify(raw)}`)
  }
  const peers: DenoNpmPackageId[] = []
  offset = end
  while (offset < raw.length) {
    let underscores = 0
    while (raw[offset + underscores] === '_') underscores++
    if (underscores !== level + 1) break
    const peer = parseNpmPackageIdAt(raw, offset + underscores, level + 1)
    peers.push(peer.id)
    offset = peer.offset
  }
  const name = level === 0 ? encodedName : encodedName.replaceAll('+', '/')
  const baseEnd = end
  return {
    id: {
      name,
      version,
      peers,
      raw: raw.slice(start, offset),
      rawSuffix: raw.slice(baseEnd, offset),
    },
    offset,
  }
}

function canonicalNodeId(id: DenoNpmPackageId): string {
  return serializeNodeId(id.name, id.version, canonicalPeerContext(id))
}

function canonicalPeerContext(
  id: DenoNpmPackageId,
  forceDiscriminator = false,
  isEdgeBearing: (peer: DenoNpmPackageId) => boolean = () => true,
): string[] {
  const peerByBase = new Map<string, string>()
  let lostDuplicate = false
  for (const peer of id.peers) {
    if (!isEdgeBearing(peer)) {
      lostDuplicate = true
      continue
    }
    const base = serializeNodeId(peer.name, peer.version, [])
    if (peerByBase.has(base)) {
      lostDuplicate = true
      continue
    }
    peerByBase.set(base, canonicalNodeId(peer))
  }
  const peers = [...peerByBase.values()]
  if ((lostDuplicate || forceDiscriminator) && id.rawSuffix !== '') {
    peers.push(createHash('sha256').update(id.rawSuffix).digest('hex'))
  }
  return peers.sort(compareStrings)
}

function serializeNativePackageId(id: DenoNpmPackageId, level = 0): string {
  const name = level === 0 ? id.name : id.name.replaceAll('/', '+')
  let value = `${name}@${id.version}`
  for (const peer of id.peers) {
    value += '_'.repeat(level + 1) + serializeNativePackageId(peer, level + 1)
  }
  return value
}

function defaultNpmTarballUrl(name: string, version: string): string {
  const scope = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : undefined
  const unscoped = scope === undefined ? name : name.slice(scope.length).replace(/^\/+/, '')
  return `https://registry.npmjs.org/${name}/-/${unscoped}-${version}.tgz`
}

function validateNonNpmIntegrity(layout: DenoLayout): void {
  for (const [name, value] of Object.entries(layout.jsr)) {
    if (!isObject(value) || typeof value.integrity !== 'string' || !/^[0-9a-f]{64}$/.test(value.integrity)) {
      throw failure(`deno adapter: jsr ${name} integrity must be lowercase SHA-256 hex`)
    }
  }
  for (const [url, value] of Object.entries(layout.remote)) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw failure(`deno adapter: remote ${url} integrity must be lowercase SHA-256 hex`)
    }
  }
}

function hasConflictMarkers(input: string): boolean {
  return /^(?:<{7}|\|{7}|={7}|>{7})(?: .*)?$/m.test(input)
}

function splitNameAndTail(value: string): { name: string; tail: string } | undefined {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '@') return { name: value.slice(0, i), tail: value.slice(i + 1) }
  }
  return undefined
}

function npmRecord(value: unknown): Record<string, DenoNpmPackageEntry> {
  const object = optionalObject(value, 'npm')
  for (const [key, entry] of Object.entries(object)) {
    if (!isObject(entry)) throw failure(`deno adapter: npm.${key} must be an object`)
  }
  return object as Record<string, DenoNpmPackageEntry>
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const object = optionalObject(value, path)
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== 'string') throw failure(`deno adapter: ${path}.${key} must be a string`)
  }
  return object as Record<string, string>
}

function requiredObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw failure(`deno adapter: ${path} must be an object`)
  return value
}

function optionalObject(value: unknown, path: string): JsonObject {
  if (value === undefined) return {}
  return requiredObject(value, path)
}

function validateStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw failure(`deno adapter: ${path} must be a string array`)
  }
  return [...value]
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function failure(message: string): LockfileError {
  return new LockfileError({ code: 'PARSE_FAILED', message })
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareEntries(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  return compareStrings(a[0], b[0])
}
