import {
  newBuilder,
  serializeNodeId,
  toTarballKey,
  type Diagnostic,
  type Edge,
  type EdgeTriple,
  type Graph,
  type Node,
  type NodeId,
  type TarballPayload,
} from '../graph.ts'
import type { TargetRequest } from '../completeness/types.ts'
import type { Packument, PackumentVersion, RegistryAdapter } from '../registry/types.ts'
import { parse as parseResolution } from '../recipe/resolution.ts'
import {
  yarnBerryBuiltinCompatIdentityOfResolution,
} from '../recipe/yarn-berry-builtin-compat.ts'
import {
  effectiveConditionsOfNode,
  rebindAdapterState as rebindYarnBerryAdapterState,
  withYarnBerryConditions,
  withYarnBerryEntryKeyDescriptors,
} from '../formats/_yarn-berry-core.ts'

const PINNED_TARGETS = Object.freeze([
  Object.freeze({ managerVersion: '4.13.0', format: 'yarn-berry-v8' }),
  Object.freeze({ managerVersion: '4.14.1', format: 'yarn-berry-v9' }),
] as const)

interface BarePatchChecksum {
  readonly kind: 'bare'
}

interface HashedPatchChecksum {
  readonly kind: 'hashed'
  readonly cacheKey: string
  readonly digestByVersion: Readonly<Record<string, string>>
}

interface YarnBerryPluginCompatProfile {
  readonly name: string
  readonly versions: readonly string[]
  readonly builtinSyntax: 'builtin' | '~builtin' | 'optional!builtin'
  readonly innerLocatorSpelling: 'bare' | 'npm-encoded'
  readonly locatorHash: string
  readonly injectedDependencies: Readonly<Record<string, string>>
  readonly patchChecksum: BarePatchChecksum | HashedPatchChecksum
  readonly targets: readonly Readonly<{
    managerVersion: string
    format: string
  }>[]
}

const PLUGIN_COMPAT_PROFILES: readonly YarnBerryPluginCompatProfile[] = Object.freeze([
  Object.freeze({
    name: 'fsevents',
    versions: Object.freeze(['2.3.2', '2.3.3']),
    builtinSyntax: 'optional!builtin',
    innerLocatorSpelling: 'npm-encoded',
    locatorHash: 'df0bf1',
    injectedDependencies: Object.freeze({ 'node-gyp': 'npm:latest' }),
    patchChecksum: Object.freeze({ kind: 'bare' }),
    targets: PINNED_TARGETS,
  }),
  Object.freeze({
    name: 'resolve',
    versions: Object.freeze(['1.22.8']),
    builtinSyntax: 'optional!builtin',
    innerLocatorSpelling: 'npm-encoded',
    locatorHash: 'c3c19d',
    injectedDependencies: Object.freeze({}),
    patchChecksum: Object.freeze({
      kind: 'hashed',
      cacheKey: '10c0',
      digestByVersion: Object.freeze({
        '1.22.8': '0446f024439cd2e50c6c8fa8ba77eaa8370b4180f401a96abf3d1ebc770ac51c1955e12764cde449fde3fff480a61f84388e3505ecdbab778f4bef5f8212c729',
      }),
    }),
    targets: PINNED_TARGETS,
  }),
  Object.freeze({
    name: 'typescript',
    versions: Object.freeze(['5.6.2']),
    builtinSyntax: 'optional!builtin',
    innerLocatorSpelling: 'npm-encoded',
    locatorHash: '8c6c40',
    injectedDependencies: Object.freeze({}),
    patchChecksum: Object.freeze({
      kind: 'hashed',
      cacheKey: '10c0',
      digestByVersion: Object.freeze({
        '5.6.2': '94eb47e130d3edd964b76da85975601dcb3604b0c848a36f63ac448d0104e93819d94c8bdf6b07c00120f2ce9c05256b8b6092d23cf5cf1c6fa911159e4d572f',
      }),
    }),
    targets: PINNED_TARGETS,
  }),
] as const)
const INSTALL_KINDS = new Set(['dep', 'dev', 'optional', 'bundled'])

interface YarnBerryPluginCompatVersion {
  readonly profile: YarnBerryPluginCompatProfile
  readonly version: string
}

interface PluginCompatCandidate {
  readonly profile: YarnBerryPluginCompatProfile
  readonly version: string
  readonly base: Node
  readonly baseConditions?: string
  readonly nativeResolution: string
  readonly patchId: NodeId
  readonly patch: Node
  readonly outgoing: readonly Edge[]
  readonly consumers: readonly Edge[]
  readonly baseDescriptors: readonly string[]
  readonly patchDescriptors: readonly string[]
}

interface YarnBerryPluginCompatGap {
  readonly base: NodeId
  readonly derivedSibling: NodeId
  readonly packageName: string
  readonly version: string
}

export interface YarnBerryPluginCompatResult {
  readonly graph: Graph
  readonly added: readonly NodeId[]
  readonly wired: readonly EdgeTriple[]
  readonly unwired: readonly EdgeTriple[]
  readonly rooted: readonly NodeId[]
  readonly unrooted: readonly NodeId[]
}

export function supportsYarnBerryPluginCompat(target: TargetRequest): boolean {
  return profilesForTarget(target).length > 0
}

function profilesForTarget(
  target: TargetRequest,
): readonly YarnBerryPluginCompatVersion[] {
  if (target.managerVersion === undefined) return []
  return PLUGIN_COMPAT_PROFILES.flatMap(profile =>
    profile.targets.some(pinned =>
      pinned.managerVersion === target.managerVersion
      && pinned.format === target.format)
      ? profile.versions.map(version => Object.freeze({ profile, version }))
      : [])
}

/** Detect a missing known sibling without claiming synthesis authority.
 *
 * A pinned target uses only its exact profile. A raw format probe has no
 * manager version, so it may use the format's pinned rows to fail closed on a
 * known missing overlay; it never calls the materializer or broadens
 * `supportsYarnBerryPluginCompat`.
 */
function gapsForTarget(
  graph: Graph,
  target: TargetRequest,
): readonly YarnBerryPluginCompatGap[] {
  const profiles = target.managerVersion === undefined
    ? PLUGIN_COMPAT_PROFILES.flatMap(profile =>
        profile.targets.some(pinned => pinned.format === target.format)
          ? profile.versions.map(version => Object.freeze({ profile, version }))
          : [])
    : profilesForTarget(target)
  const gaps = new Map<NodeId, YarnBerryPluginCompatGap>()
  for (const entry of profiles) {
    const baseId = serializeNodeId(entry.profile.name, entry.version, [])
    const base = graph.getNode(baseId)
    if (!isBareProfileNode(base, entry)) continue
    const identity = yarnBerryBuiltinCompatIdentityOfResolution(
      compatResolution(entry.profile, entry.version),
    )
    if (identity === undefined) continue
    const derivedSibling = serializeNodeId(
      entry.profile.name,
      entry.version,
      [],
      identity.patch,
    )
    if (graph.getNode(derivedSibling) !== undefined) continue
    const hasInstallConsumer = [...graph.in(base.id)].some(edge =>
      INSTALL_KINDS.has(edge.kind)
      && plainBerryDescriptor(edge, entry.profile.name) !== undefined)
    if (!hasInstallConsumer) continue
    gaps.set(derivedSibling, Object.freeze({
      base: base.id,
      derivedSibling,
      packageName: entry.profile.name,
      version: entry.version,
    }))
  }
  return Object.freeze([...gaps.values()])
}

/**
 * Report a known Berry target overlay gap caused by bypassing the target-aware
 * enrichment facade. This is diagnostic-only and deliberately does not expose
 * the order-sensitive materializer as public API.
 */
export function yarnBerryPluginCompatGapDiagnostics(
  graph: Graph,
  target: TargetRequest,
): readonly Diagnostic[] {
  return Object.freeze(gapsForTarget(graph, target).map(gap => Object.freeze({
    code: 'COMPLETENESS_TARGET_COMPATIBILITY_OVERLAY_REQUIRED',
    severity: 'error' as const,
    subject: gap.base,
    message: `Berry target-compatibility overlay did not run for ${gap.packageName}@${gap.version}; use enrich() with the pinned target after completion and before refurbish/stringify`,
    data: Object.freeze({
      feature: 'target-compatibility-overlay',
      target: target.format,
      ...(target.managerVersion === undefined
        ? {}
        : { managerVersion: target.managerVersion }),
      base: gap.base,
      derivedSibling: gap.derivedSibling,
      api: 'enrich',
    }),
  })))
}

function compatPackumentVersion(
  value: PackumentVersion,
  injectedDependencies: Readonly<Record<string, string>>,
): PackumentVersion {
  if (Object.keys(injectedDependencies).length === 0) return value
  const dependencies = Object.freeze({
    ...(value.dependencies ?? {}),
    ...injectedDependencies,
  })
  return Object.freeze({
    ...value,
    dependencies,
  })
}

function compatVersion(
  profiles: readonly YarnBerryPluginCompatVersion[],
  name: string,
  value: PackumentVersion | undefined,
): PackumentVersion | undefined {
  if (value === undefined) return value
  const match = profiles.find(entry =>
    entry.profile.name === name && entry.version === value.version)
  return match === undefined
    ? value
    : compatPackumentVersion(value, match.profile.injectedDependencies)
}

/**
 * Return a scoped, immutable registry view. Every observation whose profile
 * declares no dependency injection is returned by reference; only the exact
 * pinned manifests with row-declared injections are projected.
 */
export function yarnBerryPluginCompatRegistry(
  registry: RegistryAdapter,
  target: TargetRequest,
): RegistryAdapter {
  const profiles = profilesForTarget(target)
  if (profiles.length === 0) return registry

  const packument = async (name: string): Promise<Packument | undefined> => {
    const value = await registry.packument(name)
    if (value === undefined) return value
    const versions = { ...value.versions }
    let changed = false
    for (const entry of profiles) {
      const { profile, version } = entry
      if (profile.name !== name
        || Object.keys(profile.injectedDependencies).length === 0) continue
      const pinned = value.versions[version]
      if (pinned === undefined) continue
      versions[version] = compatPackumentVersion(
        pinned,
        profile.injectedDependencies,
      )
      changed = true
    }
    return changed
      ? Object.freeze({ ...value, versions: Object.freeze(versions) })
      : value
  }
  const resolve = async (
    name: string,
    range: string,
  ): Promise<PackumentVersion | undefined> =>
    compatVersion(profiles, name, await registry.resolve(name, range))
  const manifest = registry.manifest === undefined
    ? undefined
    : async (name: string, version: string): Promise<PackumentVersion | undefined> =>
        compatVersion(profiles, name, await registry.manifest!(name, version))

  return Object.freeze({
    packument,
    resolve,
    ...(manifest === undefined ? {} : { manifest }),
    ...(registry.limit === undefined ? {} : { limit: registry.limit }),
  })
}

function plainBerryDescriptor(edge: Edge, packageName: string): string | undefined {
  if (edge.kind === 'peer') return undefined
  const range = edge.attrs?.overrideRange ?? edge.attrs?.range
  if (range === undefined) return undefined
  const normalized = range.includes(':') ? range : `npm:${range}`
  return `${packageName}@${normalized}`
}

function patchBerryDescriptor(
  plain: string,
  profile: YarnBerryPluginCompatProfile,
): string {
  const range = plain.slice(`${profile.name}@`.length)
  const inner = profile.innerLocatorSpelling === 'npm-encoded'
    ? range.replace(':', '%3A')
    : range.replace(/^npm:/, '')
  return `${profile.name}@patch:${profile.name}@${inner}#${builtinSourceOf(profile)}`
}

function builtinSourceOf(profile: YarnBerryPluginCompatProfile): string {
  return `${profile.builtinSyntax}<compat/${profile.name}>`
}

function compatResolution(
  profile: YarnBerryPluginCompatProfile,
  version: string,
): string {
  const inner = profile.innerLocatorSpelling === 'npm-encoded'
    ? `npm%3A${version}`
    : version
  return `${profile.name}@patch:${profile.name}@${inner}#${builtinSourceOf(profile)}::version=${version}&hash=${profile.locatorHash}`
}

function compatPayload(
  base: TarballPayload | undefined,
  nativeResolution: string,
  entry: YarnBerryPluginCompatVersion,
): TarballPayload {
  const {
    integrity: _integrity,
    berryChecksumCacheKey: _berryChecksumCacheKey,
    resolution: _resolution,
    nativeResolution: _nativeResolution,
    ...metadata
  } = base ?? {}
  const checksum = entry.profile.patchChecksum
  const digest = checksum.kind === 'hashed'
    ? checksum.digestByVersion[entry.version]
    : undefined
  return Object.freeze({
    ...metadata,
    ...(digest === undefined ? {} : {
      integrity: {
        hashes: [{
          algorithm: 'sha512',
          digest,
          origin: 'berry-zip' as const,
        }],
      },
      berryChecksumCacheKey: checksum.kind === 'hashed'
        ? checksum.cacheKey
        : undefined,
    }),
    resolution: parseResolution(nativeResolution, {
      sourceKind: 'yarn-berry-locator',
      name: entry.profile.name,
    }),
    nativeResolution,
  })
}

function isBareProfileNode(
  node: Node | undefined,
  entry: YarnBerryPluginCompatVersion,
): node is Node {
  return node !== undefined
    && node.name === entry.profile.name
    && node.version === entry.version
    && node.patch === undefined
    && node.source === undefined
    && node.workspacePath === undefined
    && node.peerContext.length === 0
}

function candidateOf(
  graph: Graph,
  entry: YarnBerryPluginCompatVersion,
): PluginCompatCandidate | undefined {
  const { profile, version } = entry
  if (profile.patchChecksum.kind === 'hashed'
    && !/^[0-9a-f]{128}$/.test(
      profile.patchChecksum.digestByVersion[version] ?? '',
    )) return undefined
  const baseId = serializeNodeId(profile.name, version, [])
  const base = graph.getNode(baseId)
  if (!isBareProfileNode(base, entry)) return undefined

  const nativeResolution = compatResolution(profile, version)
  const identity = yarnBerryBuiltinCompatIdentityOfResolution(nativeResolution)
  if (identity === undefined) return undefined
  const patchId = serializeNodeId(profile.name, version, [], identity.patch)
  if (graph.getNode(patchId) !== undefined) return undefined

  const outgoing = [...graph.out(base.id)]
  for (const [name, range] of Object.entries(profile.injectedDependencies)) {
    if (!outgoing.some(edge =>
      INSTALL_KINDS.has(edge.kind)
      && graph.getNode(edge.dst)?.name === name
      && (edge.attrs?.overrideRange ?? edge.attrs?.range)?.replace(/^npm:/, '')
        === range.replace(/^npm:/, ''))) return undefined
  }

  const consumers = [...graph.in(base.id)]
    .filter(edge => INSTALL_KINDS.has(edge.kind))
  if (consumers.length === 0) return undefined

  const baseDescriptors = [...new Set(consumers
    .map(edge => plainBerryDescriptor(edge, profile.name))
    .filter((value): value is string => value !== undefined))]
    .sort()
  if (baseDescriptors.length === 0) return undefined

  return Object.freeze({
    profile,
    version,
    base,
    baseConditions: effectiveConditionsOfNode(graph, base, graph.tarballOf(base.id)),
    nativeResolution,
    patchId,
    patch: Object.freeze({
      id: patchId,
      name: base.name,
      version: base.version,
      peerContext: [],
      patch: identity.patch,
    }),
    outgoing: Object.freeze(outgoing),
    consumers: Object.freeze(consumers),
    baseDescriptors: Object.freeze(baseDescriptors),
    patchDescriptors: Object.freeze(baseDescriptors.map(plain =>
      patchBerryDescriptor(plain, profile))),
  })
}

/** Materialise every eligible builtin-compat base/patch pair as one sealed step. */
export function materializeYarnBerryPluginCompat(
  graph: Graph,
  target: TargetRequest,
): YarnBerryPluginCompatResult {
  const unchanged = (): YarnBerryPluginCompatResult =>
    Object.freeze({
      graph,
      added: Object.freeze([]),
      wired: Object.freeze([]),
      unwired: Object.freeze([]),
      rooted: Object.freeze([]),
      unrooted: Object.freeze([]),
    })
  const candidates = profilesForTarget(target)
    .map(entry => candidateOf(graph, entry))
    .filter((candidate): candidate is PluginCompatCandidate => candidate !== undefined)
  if (candidates.length === 0) return unchanged()

  // Sentinel-keyed nodes are deliberately immutable through the public Mutator.
  // Materialisation therefore rebuilds one sealed graph through Builder — the
  // same trusted path used by parsers — then rebinds the source Berry sidecar.
  const replacedConsumers = new Set(candidates.flatMap(candidate => candidate.consumers))
  const builder = newBuilder()
  for (const node of graph.nodes()) builder.addNode(node)
  for (const candidate of candidates) builder.addNode(candidate.patch)
  for (const node of graph.nodes()) {
    for (const edge of graph.out(node.id)) {
      if (replacedConsumers.has(edge)) continue
      builder.addEdge(edge.src, edge.dst, edge.kind, edge.attrs)
    }
  }
  for (const candidate of candidates) {
    for (const edge of candidate.outgoing) {
      builder.addEdge(candidate.patchId, edge.dst, edge.kind, edge.attrs)
    }
    for (const edge of candidate.consumers) {
      builder.addEdge(edge.src, candidate.patchId, edge.kind, edge.attrs)
    }
  }

  const copiedTarballs = new Set<string>()
  for (const node of graph.nodes()) {
    const key = toTarballKey(node)
    if (copiedTarballs.has(key)) continue
    const payload = graph.tarballOf(node.id)
    if (payload === undefined) continue
    copiedTarballs.add(key)
    builder.setTarball({
      name: node.name,
      version: node.version,
      patch: node.patch,
      source: node.source,
    }, payload)
  }
  for (const candidate of candidates) {
    builder.setTarball({
      name: candidate.profile.name,
      version: candidate.version,
      patch: candidate.patch.patch,
    }, compatPayload(
      graph.tarballOf(candidate.base.id),
      candidate.nativeResolution,
      { profile: candidate.profile, version: candidate.version },
    ))
  }
  for (const diagnostic of graph.diagnostics()) builder.diagnostic(diagnostic)
  const hints = graph.layoutHints()
  if (hints !== undefined) builder.layoutHints(hints)

  const rebound = rebindYarnBerryAdapterState(graph, builder.seal()).graph
  const descriptors = new Map<NodeId, readonly string[]>()
  const conditions = new Map<NodeId, string>()
  for (const candidate of candidates) {
    descriptors.set(candidate.base.id, candidate.baseDescriptors)
    descriptors.set(candidate.patchId, candidate.patchDescriptors)
    if (candidate.baseConditions !== undefined) {
      conditions.set(candidate.patchId, candidate.baseConditions)
    }
  }
  const withDescriptors = withYarnBerryEntryKeyDescriptors(rebound, descriptors)
  const withConditions = withYarnBerryConditions(withDescriptors, conditions)
  const wired: EdgeTriple[] = candidates.flatMap(candidate => [
    ...candidate.outgoing.map(edge => ({
      src: candidate.patchId,
      dst: edge.dst,
      kind: edge.kind,
    })),
    ...candidate.consumers.map(edge => ({
      src: edge.src,
      dst: candidate.patchId,
      kind: edge.kind,
    })),
  ])
  const unwired: EdgeTriple[] = candidates.flatMap(candidate =>
    candidate.consumers.map(edge => ({
      src: edge.src,
      dst: candidate.base.id,
      kind: edge.kind,
    })))
  const rooted = [...withConditions.roots()].filter(id => !graph.roots().has(id)).sort()
  const unrooted = [...graph.roots()].filter(id => !withConditions.roots().has(id)).sort()
  return Object.freeze({
    graph: withConditions,
    added: Object.freeze(candidates.map(candidate => candidate.patchId)),
    wired: Object.freeze(wired),
    unwired: Object.freeze(unwired),
    rooted: Object.freeze(rooted),
    unrooted: Object.freeze(unrooted),
  })
}
