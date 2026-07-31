import type {
  Diagnostic,
  Graph,
  Manifest,
  OverrideConstraint,
  PackageMetadataField,
  TarballPayload,
} from '../graph.ts'
import { LockfileError } from './errors.ts'
import type {
  FormatId,
  ParseOptions,
  StringifyOptions,
} from './format-contract.ts'
import {
  FORMAT_REGISTRY,
  checkFormat,
  detectFormat,
  formatAdapterStateCompatible,
  formatAdapterStateSubjects,
  hasFormatAdapterState,
  parseFormat,
  stringifyFormat,
  type StringifyDispatchContext,
} from './format-registry.ts'
import {
  adapterMutationLineageOf,
  attachParsedMutationLineage,
} from './mutation-lineage.ts'
import { getFlatSidecar } from '../formats/_npm-core.ts'
import { npm4ManifestExtensionFeatureOf } from '../formats/npm-4.ts'
import {
  getPnpmOverridesCanonical,
  pnpmManifestExtensionFeatureOf,
} from '../formats/_pnpm-flat-core.ts'
import { composeConditionsFromPayload } from '../formats/_yarn-berry-core.ts'
import * as bunText from '../formats/bun-text.ts'
import * as pnpmV5 from '../formats/pnpm-v5.ts'
import * as yarnClassic from '../formats/yarn-classic.ts'
import {
  attachParsedEvidence,
  type InternalEvidenceState,
} from '../completeness/evidence.ts'
import { detectGraphFeatures } from '../completeness/features.ts'
import { targetProfileOf } from '../completeness/targets.ts'
import type { ConversionContract } from '../completeness/types.ts'
import {
  dedupeProjectionLosses,
  blockingProjectionLosses,
  genericProjectionLoss,
  projectedStructuralMetadataDrops,
  projectionDiagnosticLosses,
  projectionError,
  projectionPreflightLosses,
  projectionWarning,
  type ProjectionResult,
} from '../completeness/projection.ts'
import { captureOverrides, reportYarnOverridesNotProjected, type OverridePM } from '../recipe/overrides.ts'
import { governingOverrideFor } from '../recipe/descriptor-resolve.ts'
import type { Integrity } from '../recipe/integrity.ts'
import type { ResolutionCanonical } from '../recipe/resolution.ts'
import {
  UNRESOLVED_DEPENDENCY_FEATURE,
  unresolvedDependencyDeclarationsOf,
  unresolvedDependencyProjectionKey,
} from '../recipe/unresolved-dependency.ts'
import {
  yarnBerryPluginCompatGapDiagnostics,
} from '../enrich/yarn-berry-plugin-compat.ts'
import {
  getManifestOverrides,
  mergeOverrides,
  rememberManifestOverrides,
} from '../recipe/override-carrier.ts'

// === PROJECTION-AWARE STRINGIFY =============================================

export type StringifyDispatchOptions = StringifyDispatchContext

function observedPolicyCarrier(
  format: FormatId,
  graph: Graph,
): readonly OverrideConstraint[] | null | undefined {
  const carrier = format === 'pnpm-v5'
    ? pnpmV5.getPnpmV5OverridesCanonical(graph)
    : format === 'pnpm-v6' || format === 'pnpm-v9'
      ? getPnpmOverridesCanonical(graph)
      : format === 'bun-text'
        ? bunText.getBunOverridesCanonical(graph)
        : undefined
  return format.startsWith('pnpm-') || format === 'bun-text'
    ? carrier ?? null
    : undefined
}

function observedManifestKnowledge(
  format: FormatId,
  graph: Graph,
): InternalEvidenceState['observedManifestKnowledge'] {
  if (format !== 'pnpm-v6' && format !== 'pnpm-v9' && format !== 'npm-4') return undefined
  const observed = format === 'npm-4'
    ? npm4ManifestExtensionFeatureOf(graph)
    : pnpmManifestExtensionFeatureOf(graph)
  if (!observed.available || observed.fingerprints.length === 0) return undefined
  return Object.freeze({
    knowledge: 'extended-fingerprinted',
    fingerprints: observed.fingerprints,
  })
}

export function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.severity,
    diagnostic.subject ?? null,
    diagnostic.message,
  ])
}

function uniqueDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const output = new Map<string, Diagnostic>()
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic)
    if (!output.has(key)) output.set(key, Object.freeze({ ...diagnostic }))
  }
  return Object.freeze([...output.values()])
}

export function stringifyProjected(
  format: FormatId,
  graph: Graph,
  options: StringifyDispatchOptions = {},
): ProjectionResult {
  const emittedDiagnostics: Diagnostic[] = []
  const lineage = adapterMutationLineageOf(graph)
  if (lineage !== undefined
    && !formatAdapterStateCompatible(lineage.sourceFormat, format)) {
    for (const subject of lineage.adapterStateSubjects) {
      emittedDiagnostics.push(assessedDiagnostic(
        'COMPLETENESS_ADAPTER_STATE_LOST',
        `${lineage.sourceFormat} native carrier ${JSON.stringify(subject)} is same-format only and is dropped by ${format}`,
        {
          feature: subject,
          sourceFormat: lineage.sourceFormat,
          target: format,
        },
      ))
    }
  }
  if (lineage?.mutated === true
    && lineage.adapterStateRequired
    && !hasFormatAdapterState(lineage.sourceFormat, graph)) {
    const subjects = lineage.adapterStateSubjects.length > 0
      ? lineage.adapterStateSubjects
      : ['adapter-state']
    for (const subject of subjects) {
      emittedDiagnostics.push(assessedDiagnostic(
        'COMPLETENESS_ADAPTER_STATE_LOST',
        `public mutation detached load-bearing ${lineage.sourceFormat} adapter state carrier ${JSON.stringify(subject)}; strict output cannot prove frozen fidelity`,
        {
          feature: subject,
          sourceFormat: lineage.sourceFormat,
          target: format,
        },
      ))
    }
  }
  if (options.overrides !== undefined
    && options.overrides.length > 0
    && format.startsWith('yarn')) {
    reportYarnOverridesNotProjected(options.overrides.length, diagnostic => {
      emittedDiagnostics.push(diagnostic)
    })
  }
  const output = stringifyFormat(format, graph, {
    ...options,
    onDiagnostic: diagnostic => emittedDiagnostics.push(diagnostic),
  })
  const preflight = projectionPreflightLosses(graph, {
    format,
    ...(options.targetVersion === undefined ? {} : { managerVersion: options.targetVersion }),
  })
  const emittedLosses = projectionDiagnosticLosses(emittedDiagnostics, format)
  let losses = dedupeProjectionLosses([...preflight, ...emittedLosses])
  const probeDiagnostics = projectionOutputDiagnostics(
    graph,
    output,
    format,
    options.overrides,
    options.pnpmWorkspaceNames,
    options.targetVersion,
  )
  if (blockingProjectionLosses(losses).length === 0 && probeDiagnostics.length > 0) {
    const classified = projectionDiagnosticLosses(probeDiagnostics, format)
    losses = dedupeProjectionLosses([
      ...losses,
      ...(classified.length > 0
        ? classified
        : [genericProjectionLoss(format, probeDiagnostics[0]!)]),
    ])
  }
  const diagnostics = uniqueDiagnostics([
    ...emittedDiagnostics,
    ...preflight.map(item => item.diagnostic),
    ...probeDiagnostics,
    ...losses.map(projectionWarning),
  ])
  for (const diagnostic of diagnostics) options.onDiagnostic?.(diagnostic)
  return Object.freeze({ output, diagnostics, losses })
}

// === FORMAT DETECTION AND PARSING ===========================================

/**
 * Runtime membership test over the shipped format ids. Argument-order dispatch
 * below relies on it: a lockfile body is never a bare format id, and a `Graph`
 * is never a string, so the two orders are always distinguishable.
 */
export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(FORMAT_REGISTRY, value)
}

/** Options bag carrying the format inline, mirroring `convert(input, { to })`. */
export type ParseOptionsWithFormat = ParseOptions & { format?: FormatId }
export type StringifyOptionsWithFormat = StringifyOptions & { format?: FormatId }

function requireFormat(format: FormatId | undefined, subject: 'parse' | 'stringify'): FormatId {
  if (format !== undefined) return format
  throw new LockfileError({
    code: 'INVALID_INPUT',
    message: subject === 'parse'
      ? 'parse: format could not be detected from the input; pass it explicitly'
      : 'stringify: target format is required; pass it as an argument or as options.format',
  })
}

export function check(input: string, format: FormatId): boolean
export function check(format: FormatId, input: string): boolean
export function check(a: string, b: string): boolean {
  const legacy = isFormatId(a) && !isFormatId(b)
  return checkFormat((legacy ? a : b) as FormatId, legacy ? b : a)
}

export function detect(input: string): FormatId | undefined {
  return detectFormat(input)
}

export function parse(input: string, format?: FormatId, options?: ParseOptions): Graph
export function parse(input: string, options: ParseOptionsWithFormat): Graph
export function parse(format: FormatId, input: string, options?: ParseOptions): Graph
export function parse(
  a: string,
  b?: FormatId | string | ParseOptionsWithFormat,
  c?: ParseOptions,
): Graph {
  // Legacy format-first order stays callable; everything else reads input-first.
  if (isFormatId(a) && typeof b === 'string' && !isFormatId(b))
    return parseResolved(a, b, c ?? {})

  if (typeof b === 'string')
    return parseResolved(b as FormatId, a, c ?? {})

  const { format, ...rest } = (b ?? {}) as ParseOptionsWithFormat
  return parseResolved(format ?? detectFormat(a), a, rest)
}

function parseResolved(
  requested: FormatId | undefined,
  input: string,
  options: ParseOptions = {},
): Graph {
  const format = requireFormat(requested, 'parse')
  if (options.sources?.policy !== undefined && options.overrides !== undefined) {
    throw new LockfileError({
      code: 'INVALID_INPUT',
      message: 'parse: sources.policy cannot be combined with legacy overrides',
    })
  }
  const declaredOverrides = options.sources?.policy === undefined
    ? options.overrides
    : [...options.sources.policy.overrides]
  // Capture manifest override authority before parse because yarn edge binding
  // needs the canonical override map while resolving descriptors.
  const manifestOverrides = options.manifests !== undefined
    ? captureManifestOverrides(format, options.manifests, options.onDiagnostic)
    : undefined
  const overrides = manifestOverrides === undefined
    ? declaredOverrides
    : mergeOverrides(declaredOverrides ?? [], manifestOverrides)
  let graph = parseFormat(format, input, {
    workspaceRoot: options.cwd ?? options.workspaceRoot,
    overrides,
    manifests: options.manifests,
  })
  if (format === 'yarn-classic' && options.manifests !== undefined) {
    const enriched = yarnClassic.enrich(graph, undefined, {
      manifests: options.manifests,
      overrides,
    })
    graph = enriched.graph
    if (options.onDiagnostic !== undefined) {
      for (const diagnostic of enriched.diagnostics) options.onDiagnostic(diagnostic)
    }
  }
  if (overrides !== undefined && overrides.length > 0) {
    rememberManifestOverrides(graph, overrides)
  }
  if (options.onDiagnostic !== undefined) {
    for (const diagnostic of graph.diagnostics()) options.onDiagnostic(diagnostic)
  }
  attachParsedEvidence(
    graph,
    format,
    options.manifests,
    observedPolicyCarrier(format, graph),
    observedManifestKnowledge(format, graph),
  )
  attachParsedMutationLineage(
    graph,
    format,
    hasFormatAdapterState(format, graph),
    formatAdapterStateSubjects(format, graph),
  )
  return graph
}

// === OVERRIDES AND STRINGIFY DISPATCH =======================================

/** Map a FormatId to its override grammar family (ADR-0025 §6 capture). */
export function packageManagerFamilyOf(format: FormatId): OverridePM {
  if (format.startsWith('yarn')) return 'yarn'
  if (format.startsWith('pnpm')) return 'pnpm'
  return 'npm'
}

function captureManifestOverrides(
  format: FormatId,
  manifests: Record<string, Manifest>,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
): OverrideConstraint[] {
  const pm = packageManagerFamilyOf(format)
  let captured: OverrideConstraint[] = []
  for (const key of Object.keys(manifests).sort()) {
    const manifest = manifests[key]!
    if (manifest.overrides !== undefined && manifest.overrides.length > 0) {
      captured = mergeOverrides(captured, manifest.overrides)
      continue
    }
    const block =
      pm === 'npm' ? manifest.native?.npmOverrides
        : pm === 'yarn' ? manifest.native?.yarnResolutions
          : manifest.native?.pnpmOverrides
    if (block === undefined) continue
    captured = mergeOverrides(
      captured,
      captureOverrides(block, pm, onDiagnostic).canonical,
    )
  }
  return captured
}

export function overridesOf(graph: Graph): OverrideConstraint[] {
  const manifest = getManifestOverrides(graph) ?? []
  const lockBorne =
    getFlatSidecar(graph)?.rootMeta?.overrides
      ?? getPnpmOverridesCanonical(graph)
      ?? pnpmV5.getPnpmV5OverridesCanonical(graph)
      ?? bunText.getBunOverridesCanonical(graph)
      ?? []
  return mergeOverrides(mergeOverrides(lockBorne, manifest), pinnedOverrides(graph))
}

/** Recreate the declared policy context needed to reparse an emitted yarn lock.
 *
 * A yarn lock does not encode whether an otherwise-identical descriptor binding
 * was selected normally, by `--force`, or by a project resolution. The source
 * graph does: every governed edge carries `overrideRange`. Turn those stamps
 * into exact, parent-scoped constraints and merge them over any caller/carrier
 * authority so the output probe resolves and re-attributes exactly those edges
 * without inventing governance for an ordinary out-of-range binding.
 */
export function reparseOverrideContext(
  graph: Graph,
  declared: readonly OverrideConstraint[] = [],
): OverrideConstraint[] {
  const governed: OverrideConstraint[] = []
  for (const source of graph.nodes()) {
    for (const edge of graph.out(source.id)) {
      const range = edge.attrs?.range
      const to = edge.attrs?.overrideRange
      const target = graph.getNode(edge.dst)
      if (range === undefined || to === undefined || target === undefined) continue
      governed.push({
        package: edge.attrs?.alias ?? target.name,
        parentPath: [source.name],
        versionCondition: range,
        to,
        origin: 'yarn',
      })
    }
  }
  return mergeOverrides(
    mergeOverrides(getManifestOverrides(graph) ?? [], declared),
    governed,
  )
}

function pinnedOverrides(graph: Graph): OverrideConstraint[] {
  const output: OverrideConstraint[] = []
  for (const diagnostic of graph.diagnostics()) {
    if (diagnostic.code !== 'MODIFY_OVERRIDE_PINNED') continue
    const packageName = diagnostic.data?.package
    const to = diagnostic.data?.to
    if (typeof packageName === 'string' && typeof to === 'string') {
      output.push({ package: packageName, to })
    }
  }
  return output
}

export function stringify(graph: Graph, format?: FormatId, options?: StringifyOptions): string
export function stringify(graph: Graph, options: StringifyOptionsWithFormat): string
export function stringify(format: FormatId, graph: Graph, options?: StringifyOptions): string
export function stringify(
  a: FormatId | Graph,
  b?: FormatId | Graph | StringifyOptionsWithFormat,
  c?: StringifyOptions,
): string {
  if (isFormatId(a)) return stringifyResolved(a, b as Graph, c ?? {})
  const graph = a as Graph
  if (typeof b === 'string') return stringifyResolved(b as FormatId, graph, c ?? {})
  const { format, ...rest } = (b ?? {}) as StringifyOptionsWithFormat
  return stringifyResolved(format, graph, rest)
}

function stringifyResolved(
  requested: FormatId | undefined,
  graph: Graph,
  options: StringifyOptions = {},
): string {
  const format = requireFormat(requested, 'stringify')
  if (options.sources?.policy !== undefined && options.overrides !== undefined) {
    throw new LockfileError({
      code: 'INVALID_INPUT',
      message: 'stringify: sources.policy cannot be combined with legacy overrides',
    })
  }
  const projected = stringifyProjected(format, graph, {
    ...options,
    overrides: options.sources?.policy === undefined
      ? options.overrides
      : [...options.sources.policy.overrides],
  })
  const blocking = blockingProjectionLosses(projected.losses)
  if ((options.strict ?? true) && blocking.length > 0) {
    throw new LockfileError(projectionError(blocking))
  }
  return projected.output
}

// === CANONICAL GRAPH SNAPSHOTS ==============================================

export function assessedDiagnostic(
  code: string,
  message: string,
  data?: Record<string, unknown>,
): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    ...(data === undefined ? {} : { data }),
  }
}

export function stableValue(
  value: unknown,
  stack: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value !== 'object') return value
  if (stack.has(value)) throw new TypeError('cyclic value in canonical graph projection')
  stack.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => stableValue(item, stack))
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item, stack)]))
  } finally {
    stack.delete(value)
  }
}

function sortByStableJson<T>(values: T[]): T[] {
  // The index is deliberately per call: each value is serialized once without
  // letting same-identity graph mutations stale a shared summary.
  return values
    .map(value => ({ key: JSON.stringify(value), value }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(entry => entry.value)
}

export function canonicalGraphSnapshot(
  graph: Graph,
  contract: ConversionContract,
  overrides?: readonly OverrideConstraint[],
  workspaceNames?: ReadonlyMap<string, string>,
  projectedResolutions?: ReadonlyMap<string, ResolutionCanonical>,
  projectedIntegrities?: ReadonlyMap<string, Integrity | undefined>,
  projectedMetadataDrops?: ReadonlyMap<string, ReadonlySet<PackageMetadataField>>,
  projectNativeBerryWorkspaceRoot = false,
): string {
  const projectedRootIds = new Map<string, string>()
  if (projectNativeBerryWorkspaceRoot) {
    for (const node of graph.nodes()) {
      if (node.workspacePath === '') {
        projectedRootIds.set(node.id, `${node.name}@0.0.0-use.local`)
      }
    }
  }
  const projectedNodeId = (id: string): string => projectedRootIds.get(id) ?? id
  const nodes = sortByStableJson([...graph.nodes()].map(node => stableValue({
    id: projectedNodeId(node.id),
    name: node.name,
    version: projectedRootIds.has(node.id) ? '0.0.0-use.local' : node.version,
    peerContext: node.peerContext,
    ...(node.patch === undefined ? {} : { patch: node.patch }),
    ...(node.source === undefined ? {} : { source: node.source }),
    ...(node.workspacePath === undefined ? {} : { workspacePath: node.workspacePath }),
  })))
  const edges = sortByStableJson([...graph.nodes()].flatMap(node => [...graph.out(node.id)])
    .map(edge => {
      const source = graph.getNode(edge.src)
      const target = graph.getNode(edge.dst)
      const declaredRange = edge.attrs?.range
      const descriptor = edge.attrs?.alias ?? target?.name
      const projectedRange = source?.workspacePath !== undefined
        && descriptor !== undefined
        && declaredRange !== undefined
        && overrides !== undefined
        ? governingOverrideFor(
            descriptor,
            [workspaceNames?.get(source.id) ?? source.name],
            overrides,
            declaredRange,
          )?.to
        : undefined
      return stableValue({
        src: projectedNodeId(edge.src),
        dst: projectedNodeId(edge.dst),
        kind: edge.kind,
        ...(edge.attrs === undefined ? {} : {
          attrs: {
            ...(declaredRange === undefined ? {} : { range: projectedRange ?? declaredRange }),
            ...(contract === 'snapshot' || edge.attrs.overrideRange === undefined
              ? {}
              : { overrideRange: edge.attrs.overrideRange }),
            ...(edge.attrs.optional === undefined ? {} : { optional: edge.attrs.optional }),
            ...(edge.attrs.workspace === undefined ? {} : { workspace: edge.attrs.workspace }),
            ...(edge.attrs.alias === undefined ? {} : { alias: edge.attrs.alias }),
            ...(edge.attrs.workspaceRange === undefined ? {} : {
              workspaceRange: edge.attrs.workspaceRange,
            }),
          },
        }),
      })
    }))
  const tarballs = [...graph.tarballs()].flatMap(([key, payload]) => {
    const resolution = projectedResolutions?.get(key) ?? payload.resolution
    const integrity = projectedIntegrities?.has(key)
      ? projectedIntegrities.get(key)
      : payload.integrity
    const metadataDrops = projectedMetadataDrops?.get(key)
    const projected = {
      ...(integrity === undefined ? {} : { integrity }),
      ...(payload.berryChecksumCacheKey === undefined ? {} : {
        berryChecksumCacheKey: payload.berryChecksumCacheKey,
      }),
      ...(payload.engines === undefined || metadataDrops?.has('engines') ? {} : { engines: payload.engines }),
      ...(payload.funding === undefined || metadataDrops?.has('funding') ? {} : { funding: payload.funding }),
      ...(payload.license === undefined || metadataDrops?.has('license') ? {} : { license: payload.license }),
      ...(payload.bin === undefined || metadataDrops?.has('bin') ? {} : { bin: payload.bin }),
      ...(payload.deprecated === undefined || metadataDrops?.has('deprecated') ? {} : { deprecated: payload.deprecated }),
      ...(payload.cpu === undefined || metadataDrops?.has('cpu') ? {} : { cpu: payload.cpu }),
      ...(payload.os === undefined || metadataDrops?.has('os') ? {} : { os: payload.os }),
      ...(payload.libc === undefined || metadataDrops?.has('libc') ? {} : { libc: payload.libc }),
      ...(payload.hasInstallScript === undefined || metadataDrops?.has('hasInstallScript') ? {} : {
        hasInstallScript: payload.hasInstallScript,
      }),
      ...(payload.bundledDependencies === undefined || metadataDrops?.has('bundledDependencies') ? {} : {
        bundledDependencies: payload.bundledDependencies,
      }),
      ...(resolution === undefined ? {} : { resolution }),
      ...(payload.peerDependencies === undefined || metadataDrops?.has('peerDependencies') ? {} : {
        peerDependencies: payload.peerDependencies,
      }),
      ...(payload.peerDependenciesMeta === undefined || metadataDrops?.has('peerDependenciesMeta') ? {} : {
        peerDependenciesMeta: payload.peerDependenciesMeta,
      }),
    }
    // A payload whose only content was a target-dropped structural-expected metadata
    // field (a completed node carrying only `engines`) projects to `{}`; the target
    // reparse emits no tarball entry for such a node, so omit it for a symmetric
    // snapshot — an empty payload carries no canonical fact (ADR-0038 §8, CASE-A).
    return Object.keys(projected).length === 0 ? [] : [[key, stableValue(projected)] as const]
  })
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify({
    nodes,
    edges,
    roots: [...graph.roots()].map(projectedNodeId).sort(),
    tarballs,
  })
}

// === PROJECTION SNAPSHOTS ===================================================

/** Snapshot the graph as the target adapter will project it. Most targets use
 * the canonical graph unchanged. Yarn classic is the exception for freshly
 * minted registry tarballs: it rehosts their canonical URL to the configured /
 * inferred classic registry while native entries remain verbatim. */
export function canonicalProjectionGraphSnapshot(
  graph: Graph,
  target: FormatId,
  contract: ConversionContract,
  overrides?: readonly OverrideConstraint[],
  workspaceNames?: ReadonlyMap<string, string>,
): string {
  // `registryFor` intentionally isn't threaded through this strict comparator:
  // generic StringifyOptions cannot carry it, while the direct classic
  // stringify API that can has no projection comparator. This is therefore
  // safely over-strict today; exposing `registryFor` generically must also plumb
  // it through this projection boundary.
  const projectedResolutions = target === 'yarn-classic'
    ? yarnClassic.projectedCanonicalResolutions(graph)
    : undefined
  const projectedIntegrities = target === 'yarn-classic'
    ? yarnClassic.projectedCanonicalIntegrities(graph)
    : undefined
  const projectedMetadataDrops = projectedConditionsMetadataDrops(
    graph,
    target,
    projectedStructuralMetadataDrops(graph, target),
  )
  return canonicalGraphSnapshot(
    graph,
    contract,
    overrides,
    workspaceNames,
    projectedResolutions,
    projectedIntegrities,
    projectedMetadataDrops,
    target.startsWith('yarn-berry-'),
  )
}

const CONDITION_METADATA_FIELDS = ['os', 'cpu', 'libc'] as const

/** Berry serializes platform metadata through `conditions:` and reparses it as
 * a scalar sidecar fact. Avoid comparing the same fact again as structured
 * tarball metadata, but only for fields the current composer actually carries. */
function projectedConditionsMetadataDrops(
  graph: Graph,
  target: FormatId,
  structural: ReadonlyMap<string, ReadonlySet<PackageMetadataField>> | undefined,
): ReadonlyMap<string, ReadonlySet<PackageMetadataField>> | undefined {
  if (!target.startsWith('yarn-berry-')
    || !targetProfileOf({ format: target }).capabilities.conditions) return structural

  const projected = new Map<string, ReadonlySet<PackageMetadataField>>(structural)
  for (const [key, payload] of graph.tarballs()) {
    const represented = CONDITION_METADATA_FIELDS.filter(field => {
      const values = payload[field]
      if (values === undefined) return false
      return composeConditionsFromPayload({ [field]: values } as TarballPayload) !== undefined
    })
    if (represented.length === 0) continue
    projected.set(key, Object.freeze(new Set([
      ...(projected.get(key) ?? []),
      ...represented,
    ])))
  }
  return projected.size === 0 ? undefined : projected
}

function projectionOutputDiagnostics(
  graph: Graph,
  output: string,
  target: FormatId,
  overrides?: readonly OverrideConstraint[],
  workspaceNames?: ReadonlyMap<string, string>,
  targetVersion?: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!checkFormat(target, output)) {
    return Object.freeze([assessedDiagnostic(
      'COMPLETENESS_OUTPUT_FORMAT_REJECTED',
      'target adapter rejected emitted output',
      { target },
    )])
  }

  let reparsed: Graph
  try {
    const reparseOverrides = reparseOverrideContext(graph, overrides)
    reparsed = parse(target, output, {
      ...(reparseOverrides.length === 0 ? {} : { overrides: reparseOverrides }),
    })
  } catch (error) {
    return Object.freeze([assessedDiagnostic(
      'COMPLETENESS_OUTPUT_PARSE_FAILED',
      error instanceof Error ? error.message : 'target output parse failed',
      { target },
    )])
  }

  const comparisonOverrides = target.startsWith('pnpm-') ? overrides : undefined
  const overlayGaps = yarnBerryPluginCompatGapDiagnostics(graph, {
    format: target,
    ...(targetVersion === undefined ? {} : { managerVersion: targetVersion }),
  })
  diagnostics.push(...overlayGaps)
  if (canonicalProjectionGraphSnapshot(graph, target, 'project', comparisonOverrides, workspaceNames)
    !== canonicalProjectionGraphSnapshot(reparsed, target, 'project', comparisonOverrides, workspaceNames)) {
    if (overlayGaps.length === 0) diagnostics.push(assessedDiagnostic(
      'COMPLETENESS_OUTPUT_GRAPH_MISMATCH',
      'target output does not preserve the canonical graph',
      { target },
    ))
  }
  const sourceFeatures = detectGraphFeatures(graph)
  const targetFeatures = detectGraphFeatures(reparsed)
  const targetUnresolved = new Set(
    unresolvedDependencyDeclarationsOf(reparsed)
      .map(declaration => unresolvedDependencyProjectionKey(reparsed, declaration)),
  )
  for (const declaration of unresolvedDependencyDeclarationsOf(graph)) {
    if (targetUnresolved.has(unresolvedDependencyProjectionKey(graph, declaration))) continue
    diagnostics.push(assessedDiagnostic(
      'COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED',
      `target output drops unresolved ${declaration.kind} declaration ${declaration.name}@${declaration.descriptor} from ${declaration.src}`,
      {
        feature: UNRESOLVED_DEPENDENCY_FEATURE,
        target,
        unresolvedDependency: declaration,
      },
    ))
  }
  const sidecarFacts = [
    ['conditions', sourceFeatures.attribution.berryConditions, targetFeatures.attribution.berryConditions],
    ['catalogs', sourceFeatures.attribution.pnpmCatalogs, targetFeatures.attribution.pnpmCatalogs],
  ] as const
  for (const [feature, sourceFact, targetFact] of sidecarFacts) {
    if (sourceFact.present !== targetFact.present
      || (sourceFact.present && targetFact.fingerprint !== sourceFact.fingerprint)) {
      diagnostics.push(assessedDiagnostic(
        'COMPLETENESS_OUTPUT_FEATURE_MISMATCH',
        'target output changes or drops a sidecar-owned graph feature',
        { target, feature },
      ))
    }
  }
  return Object.freeze(diagnostics)
}
