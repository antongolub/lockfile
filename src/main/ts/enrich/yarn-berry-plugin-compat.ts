import {
  newBuilder,
  serializeNodeId,
  toTarballKey,
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
  yarnBerryFseventsCompatResolution,
} from '../recipe/yarn-berry-builtin-compat.ts'
import {
  effectiveConditionsOfNode,
  rebindAdapterState as rebindYarnBerryAdapterState,
  withYarnBerryConditions,
  withYarnBerryEntryKeyDescriptors,
} from '../formats/_yarn-berry-core.ts'

const FSEVENTS_NAME = 'fsevents'
const FSEVENTS_VERSION = '2.3.3'
const NODE_GYP_NAME = 'node-gyp'
const NODE_GYP_RANGE = 'npm:latest'
const SUPPORTED_TARGETS = new Map([
  ['4.13.0', 'yarn-berry-v8'],
  ['4.14.1', 'yarn-berry-v9'],
])
const INSTALL_KINDS = new Set(['dep', 'dev', 'optional', 'bundled'])

export interface YarnBerryPluginCompatResult {
  readonly graph: Graph
  readonly added: readonly NodeId[]
  readonly wired: readonly EdgeTriple[]
  readonly unwired: readonly EdgeTriple[]
  readonly rooted: readonly NodeId[]
  readonly unrooted: readonly NodeId[]
}

export function supportsYarnBerryPluginCompat(target: TargetRequest): boolean {
  return target.managerVersion !== undefined
    && SUPPORTED_TARGETS.get(target.managerVersion) === target.format
}

function compatPackumentVersion(value: PackumentVersion): PackumentVersion {
  const dependencies = Object.freeze({
    ...(value.dependencies ?? {}),
    [NODE_GYP_NAME]: NODE_GYP_RANGE,
  })
  return Object.freeze({
    ...value,
    dependencies,
  })
}

function compatVersion(
  name: string,
  value: PackumentVersion | undefined,
): PackumentVersion | undefined {
  return name === FSEVENTS_NAME && value?.version === FSEVENTS_VERSION
    ? compatPackumentVersion(value)
    : value
}

/**
 * Return a scoped, immutable registry view. Every non-fsevents observation is
 * returned by reference; only the pinned fsevents@2.3.3 manifest is projected.
 */
export function yarnBerryPluginCompatRegistry(
  registry: RegistryAdapter,
  target: TargetRequest,
): RegistryAdapter {
  if (!supportsYarnBerryPluginCompat(target)) return registry

  const packument = async (name: string): Promise<Packument | undefined> => {
    const value = await registry.packument(name)
    if (name !== FSEVENTS_NAME || value === undefined) return value
    const pinned = value.versions[FSEVENTS_VERSION]
    if (pinned === undefined) return value
    const versions = Object.freeze({
      ...value.versions,
      [FSEVENTS_VERSION]: compatPackumentVersion(pinned),
    })
    return Object.freeze({ ...value, versions })
  }
  const resolve = async (
    name: string,
    range: string,
  ): Promise<PackumentVersion | undefined> =>
    compatVersion(name, await registry.resolve(name, range))
  const manifest = registry.manifest === undefined
    ? undefined
    : async (name: string, version: string): Promise<PackumentVersion | undefined> =>
        compatVersion(name, await registry.manifest!(name, version))

  return Object.freeze({
    packument,
    resolve,
    ...(manifest === undefined ? {} : { manifest }),
    ...(registry.limit === undefined ? {} : { limit: registry.limit }),
  })
}

function plainBerryDescriptor(edge: Edge): string | undefined {
  if (edge.kind === 'peer') return undefined
  const range = edge.attrs?.overrideRange ?? edge.attrs?.range
  if (range === undefined) return undefined
  const normalized = range.includes(':') ? range : `npm:${range}`
  return `${FSEVENTS_NAME}@${normalized}`
}

function patchBerryDescriptor(plain: string): string {
  const range = plain.slice(`${FSEVENTS_NAME}@`.length).replace(':', '%3A')
  return `${FSEVENTS_NAME}@patch:${FSEVENTS_NAME}@${range}#optional!builtin<compat/fsevents>`
}

function platformPayload(
  base: TarballPayload | undefined,
  nativeResolution: string,
): TarballPayload {
  return Object.freeze({
    ...(base?.cpu === undefined ? {} : { cpu: [...base.cpu] }),
    ...(base?.os === undefined ? {} : { os: [...base.os] }),
    ...(base?.libc === undefined ? {} : { libc: [...base.libc] }),
    resolution: parseResolution(nativeResolution, {
      sourceKind: 'yarn-berry-locator',
      name: FSEVENTS_NAME,
    }),
    nativeResolution,
  })
}

function isBarePinnedFsevents(node: Node | undefined): node is Node {
  return node !== undefined
    && node.name === FSEVENTS_NAME
    && node.version === FSEVENTS_VERSION
    && node.patch === undefined
    && node.source === undefined
    && node.workspacePath === undefined
    && node.peerContext.length === 0
}

/** Materialise the pinned fsevents base/patch pair as one all-or-nothing step. */
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
  if (!supportsYarnBerryPluginCompat(target)) return unchanged()

  const baseId = serializeNodeId(FSEVENTS_NAME, FSEVENTS_VERSION, [])
  const base = graph.getNode(baseId)
  if (!isBarePinnedFsevents(base)) return unchanged()
  const baseConditions = effectiveConditionsOfNode(graph, base, graph.tarballOf(base.id))

  const nativeResolution = yarnBerryFseventsCompatResolution()
  const identity = yarnBerryBuiltinCompatIdentityOfResolution(nativeResolution)
  if (identity === undefined) return unchanged()
  const patchId = serializeNodeId(FSEVENTS_NAME, FSEVENTS_VERSION, [], identity.patch)
  if (graph.getNode(patchId) !== undefined) return unchanged()

  const outgoing = [...graph.out(base.id)]
  const hasNodeGyp = outgoing.some(edge =>
    INSTALL_KINDS.has(edge.kind)
    && graph.getNode(edge.dst)?.name === NODE_GYP_NAME)
  if (!hasNodeGyp) return unchanged()

  const consumers = [...graph.in(base.id)]
    .filter(edge => INSTALL_KINDS.has(edge.kind))
  if (consumers.length === 0) return unchanged()

  const baseDescriptors = [...new Set(consumers
    .map(plainBerryDescriptor)
    .filter((value): value is string => value !== undefined))]
    .sort()
  if (baseDescriptors.length === 0) return unchanged()
  const patchDescriptors = baseDescriptors.map(patchBerryDescriptor)

  const patch: Node = Object.freeze({
    id: patchId,
    name: base.name,
    version: base.version,
    peerContext: [],
    patch: identity.patch,
  })
  // Sentinel-keyed nodes are deliberately immutable through the public Mutator.
  // Materialisation therefore rebuilds one sealed graph through Builder — the
  // same trusted path used by parsers — then rebinds the source Berry sidecar.
  const replacedConsumers = new Set(consumers)
  const builder = newBuilder()
  for (const node of graph.nodes()) builder.addNode(node)
  builder.addNode(patch)
  for (const node of graph.nodes()) {
    for (const edge of graph.out(node.id)) {
      if (replacedConsumers.has(edge)) continue
      builder.addEdge(edge.src, edge.dst, edge.kind, edge.attrs)
    }
  }
  for (const edge of outgoing) builder.addEdge(patchId, edge.dst, edge.kind, edge.attrs)
  for (const edge of consumers) builder.addEdge(edge.src, patchId, edge.kind, edge.attrs)

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
  builder.setTarball(
    { name: FSEVENTS_NAME, version: FSEVENTS_VERSION, patch: identity.patch },
    platformPayload(graph.tarballOf(base.id), nativeResolution),
  )
  for (const diagnostic of graph.diagnostics()) builder.diagnostic(diagnostic)
  const hints = graph.layoutHints()
  if (hints !== undefined) builder.layoutHints(hints)

  const rebound = rebindYarnBerryAdapterState(graph, builder.seal()).graph
  const withDescriptors = withYarnBerryEntryKeyDescriptors(rebound, new Map([
    [base.id, baseDescriptors],
    [patchId, patchDescriptors],
  ]))
  const withConditions = baseConditions === undefined
    ? withDescriptors
    : withYarnBerryConditions(withDescriptors, new Map([[patchId, baseConditions]]))
  const wired: EdgeTriple[] = [
    ...outgoing.map(edge => ({ src: patchId, dst: edge.dst, kind: edge.kind })),
    ...consumers.map(edge => ({ src: edge.src, dst: patchId, kind: edge.kind })),
  ]
  const unwired = consumers.map(edge => ({ src: edge.src, dst: base.id, kind: edge.kind }))
  const rooted = [...withConditions.roots()].filter(id => !graph.roots().has(id)).sort()
  const unrooted = [...graph.roots()].filter(id => !withConditions.roots().has(id)).sort()
  return Object.freeze({
    graph: withConditions,
    added: Object.freeze([patchId]),
    wired: Object.freeze(wired),
    unwired: Object.freeze(unwired),
    rooted: Object.freeze(rooted),
    unrooted: Object.freeze(unrooted),
  })
}
