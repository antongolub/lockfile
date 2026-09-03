import type { EdgeKind, PackageMetadataField } from '../graph.ts'
import { isDenoFormat, type FormatId,
  isBunTextFormat,
} from '../api/format-contract.ts'
import {
  PACKAGE_METADATA_FIELDS,
} from '../registry/payload.ts'
import type {
  ResolvedTargetCapabilities,
  TargetCapability,
  TargetInput,
  TargetManager,
  TargetProfile,
  TargetRequest,
} from './types.ts'

// === VERSION PARSING ========================================================

interface ManagerVersion {
  major: number
  minor?: number
  patch?: number
  prerelease?: string
}

const versionPattern = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(value: string): ManagerVersion {
  const match = value.match(versionPattern)
  if (match === null) throw new TypeError(`invalid target manager version ${JSON.stringify(value)}`)
  return {
    major: Number(match[1]),
    ...(match[2] === undefined ? {} : { minor: Number(match[2]) }),
    ...(match[3] === undefined ? {} : { patch: Number(match[3]) }),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  }
}

function readonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const set = new Set(values)
  let view: ReadonlySet<T>
  view = Object.freeze({
    get size() { return set.size },
    has: (value: T) => set.has(value),
    entries: () => set.entries(),
    keys: () => set.keys(),
    values: () => set.values(),
    forEach: (callback: (value: T, key: T, source: ReadonlySet<T>) => void, thisArg?: unknown) => {
      set.forEach(value => callback.call(thisArg, value, value, view))
    },
    [Symbol.iterator]: () => set[Symbol.iterator](),
  })
  return view
}

// === CAPABILITY PROFILES ====================================================

const edges = (...kinds: EdgeKind[]): ReadonlySet<EdgeKind> => readonlySet(kinds)
const metadata = (...fields: PackageMetadataField[]): ReadonlySet<PackageMetadataField> => readonlySet(fields)

function targetManagerOf(format: FormatId): TargetManager {
  if (format.startsWith('npm-')) return 'npm'
  if (format.startsWith('yarn-')) return 'yarn'
  if (format.startsWith('pnpm-')) return 'pnpm'
  if (isBunTextFormat(format)) return 'bun'
  if (isDenoFormat(format)) return 'deno'
  return 'lockgraph'
}

function capabilities(
  value: ResolvedTargetCapabilities,
): Readonly<ResolvedTargetCapabilities> {
  return Object.freeze(value)
}

const npm1 = capabilities({
  edgeKinds: edges('dep', 'dev', 'optional', 'bundled'),
  workspaces: false,
  workspaceProtocol: false,
  peerRepresentation: 'none',
  patches: false,
  bundledDependencies: true,
  conditions: false,
  catalogs: false,
  integrity: 'tarball-sri',
  layout: 'generated',
  lockOverridesCarrier: false,
  overridesConfigLocation: 'none',
  comparesOverridesInFrozen: false,
  overridesGrammar: 'none',
  metadataFields: metadata(),
})

const npm3 = capabilities({
  ...npm1,
  edgeKinds: edges('dep', 'dev', 'optional', 'peer', 'bundled'),
  workspaces: true,
  peerRepresentation: 'declared',
  overridesConfigLocation: 'manifest',
  overridesGrammar: 'npm-nested',
  metadataFields: metadata(
    'engines',
    'funding',
    'license',
    'bin',
    'deprecated',
    'cpu',
    'os',
    'libc',
    'hasInstallScript',
    'bundledDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ),
})

const npm4 = capabilities({
  ...npm3,
  patches: true,
})

const yarnClassic = capabilities({
  edgeKinds: edges('dep', 'optional'),
  workspaces: true,
  workspaceProtocol: false,
  peerRepresentation: 'none',
  patches: false,
  bundledDependencies: false,
  conditions: false,
  catalogs: false,
  integrity: 'tarball-sri',
  layout: 'none',
  lockOverridesCarrier: false,
  overridesConfigLocation: 'manifest',
  comparesOverridesInFrozen: false,
  overridesGrammar: 'yarn-selective',
  metadataFields: metadata(),
})

function yarnBerry(format: FormatId): Readonly<ResolvedTargetCapabilities> {
  return capabilities({
    edgeKinds: edges('dep', 'dev', 'optional', 'peer'),
    workspaces: true,
    workspaceProtocol: true,
    peerRepresentation: 'virtualized',
    patches: true,
    bundledDependencies: false,
    conditions: format !== 'yarn-berry-v4',
    catalogs: format === 'yarn-berry-v8'
      || format === 'yarn-berry-v9'
      || format === 'yarn-berry-v10',
    integrity: 'berry-zip',
    layout: 'none',
    lockOverridesCarrier: false,
    overridesConfigLocation: 'manifest',
    comparesOverridesInFrozen: false,
    overridesGrammar: 'yarn-selective',
    metadataFields: format === 'yarn-berry-v4'
      ? metadata('bin', 'peerDependencies', 'peerDependenciesMeta')
      : metadata('bin', 'cpu', 'os', 'libc', 'peerDependencies', 'peerDependenciesMeta'),
  })
}

function pnpm(
  patches: boolean,
  lockOverridesCarrier: boolean,
  comparesOverridesInFrozen: boolean,
  overridesConfigLocation: ResolvedTargetCapabilities['overridesConfigLocation'],
  catalogs: boolean,
  metadataFields: ReadonlySet<PackageMetadataField>,
): Readonly<ResolvedTargetCapabilities> {
  return capabilities({
    edgeKinds: edges('dep', 'dev', 'optional', 'peer'),
    workspaces: true,
    workspaceProtocol: true,
    peerRepresentation: 'virtualized',
    patches,
    bundledDependencies: false,
    conditions: false,
    catalogs,
    integrity: 'tarball-sri',
    layout: 'none',
    lockOverridesCarrier,
    overridesConfigLocation,
    comparesOverridesInFrozen,
    overridesGrammar: 'pnpm-flat',
    metadataFields,
  })
}

const pnpmV5Metadata = metadata('engines', 'bin', 'cpu', 'os', 'peerDependencies')
const pnpmModernMetadata = metadata(
  'engines',
  'bin',
  'deprecated',
  'cpu',
  'os',
  'libc',
  'peerDependencies',
  'peerDependenciesMeta',
)

const pnpmV6 = pnpm(true, true, true, 'manifest', false, pnpmModernMetadata)

const bunText = capabilities({
  edgeKinds: edges('dep', 'dev', 'optional', 'peer'),
  workspaces: true,
  workspaceProtocol: true,
  peerRepresentation: 'declared',
  patches: false,
  bundledDependencies: false,
  conditions: false,
  catalogs: false,
  integrity: 'tarball-sri',
  layout: 'none',
  lockOverridesCarrier: true,
  overridesConfigLocation: 'manifest',
  comparesOverridesInFrozen: true,
  overridesGrammar: 'bun-flat',
  metadataFields: metadata('bin', 'cpu', 'os', 'peerDependencies'),
})

const deno = capabilities({
  edgeKinds: edges('dep', 'optional', 'peer'),
  workspaces: false,
  workspaceProtocol: false,
  peerRepresentation: 'virtualized',
  patches: false,
  bundledDependencies: false,
  conditions: false,
  catalogs: false,
  integrity: 'tarball-sri',
  layout: 'none',
  lockOverridesCarrier: false,
  overridesConfigLocation: 'none',
  comparesOverridesInFrozen: false,
  overridesGrammar: 'none',
  metadataFields: metadata(
    'bin',
    'deprecated',
    'cpu',
    'os',
    'hasInstallScript',
    'peerDependencies',
    'peerDependenciesMeta',
  ),
})

const lockgraph = capabilities({
  edgeKinds: edges('dep', 'dev', 'optional', 'peer', 'bundled'),
  workspaces: true,
  workspaceProtocol: true,
  peerRepresentation: 'virtualized',
  patches: true,
  bundledDependencies: true,
  conditions: true,
  catalogs: false,
  integrity: 'canonical',
  layout: 'encoded',
  lockOverridesCarrier: false,
  overridesConfigLocation: 'none',
  comparesOverridesInFrozen: false,
  overridesGrammar: 'none',
  metadataFields: metadata(...PACKAGE_METADATA_FIELDS),
})

// === COMPATIBILITY GUARDS ===================================================

/**
 * Which manager versions WRITE each format.
 *
 * This is the same data every format spec carries in its "Writers — PM semvers
 * that emit this format" table, so it is kept in the shape a reader can check
 * against that table one row at a time. It was a nested ternary ladder; a row
 * that disagrees with its spec is now visible without tracing a chain.
 *
 * `minor ?? -1` keeps an absent minor below every threshold. `prerelease` gates
 * the Berry generations whose feature landed only in a stable release.
 */
const FORMAT_WRITERS: Partial<Record<FormatId, (v: ManagerVersion) => boolean>> = {
  'npm-1': v => v.major >= 5 && v.major <= 6,
  'npm-2': v => v.major >= 7 && v.major <= 8,
  'npm-3': v => v.major >= 9,
  'npm-4': v => v.major >= 12,
  'yarn-classic': v => v.major === 1,
  'pnpm-v5': v => v.major >= 3 && v.major <= 7,
  'pnpm-v6': v => v.major === 8,
  'pnpm-v9': v => v.major >= 9,
  'bun-text': v => v.major > 1 || (v.major === 1 && (v.minor ?? -1) >= 2),
  // bun writes generation 2 from 1.4; below that it writes 1 and REFUSES a 2.
  'bun-text-v2': v => v.major > 1 || (v.major === 1 && (v.minor ?? -1) >= 4),
  'yarn-berry-v4': v => v.major >= 2,
  'yarn-berry-v5': v => v.major > 3 || (v.major === 3 && (v.minor ?? -1) >= 1),
  'yarn-berry-v6': v => v.major > 3 || (v.major === 3 && (v.minor ?? -1) >= 2),
  'yarn-berry-v7': v => yarnV7Compatible(v),
  'yarn-berry-v8': v => v.major >= 4 && v.prerelease === undefined,
  'yarn-berry-v9': v => v.major > 4
    || (v.major === 4 && (v.minor ?? -1) >= 14 && v.prerelease === undefined),
  'yarn-berry-v10': v => v.major > 4
    || (v.major === 4 && (v.minor ?? -1) >= 17 && v.prerelease === undefined),
  // `lockgraph` has no producer to be compatible with, so no row: the default
  // below refuses it, which is what the ladder did explicitly.
}

function assertCompatible(format: FormatId, version: ManagerVersion | undefined): void {
  if (version === undefined) return
  // Every Deno generation is written by some Deno 1+; the format itself pins
  // which, so the version check stays at the family level.
  const writes = isDenoFormat(format)
    ? (v: ManagerVersion) => v.major >= 1
    : FORMAT_WRITERS[format]
  if (writes === undefined || !writes(version)) {
    throw new TypeError(`target manager version is incompatible with ${format}`)
  }
}

function yarnV7Compatible(version: ManagerVersion): boolean {
  if (version.major > 4) return true
  if (version.major < 4) return false
  if (version.prerelease === undefined) return true
  const match = version.prerelease.match(/^rc\.(\d+)$/)
  return match !== null && Number(match[1]) >= 27
}

function pnpmV5(
  version: ManagerVersion | undefined,
): { capabilities: Readonly<ResolvedTargetCapabilities>; ambiguous: readonly TargetCapability[] } {
  if (version === undefined) {
    return {
      capabilities: pnpm(false, false, false, 'manifest', false, pnpmV5Metadata),
      ambiguous: ['lockOverridesCarrier', 'comparesOverridesInFrozen'],
    }
  }
  const carriesOverrides = version.major >= 6
  return {
    capabilities: pnpm(false, carriesOverrides, carriesOverrides, 'manifest', false, pnpmV5Metadata),
    ambiguous: [],
  }
}

function npmV2(
  version: ManagerVersion | undefined,
): { capabilities: Readonly<ResolvedTargetCapabilities>; ambiguous: readonly TargetCapability[] } {
  const supportsOverrides = version?.major === 8
    && version.minor !== undefined
    && version.minor >= 3
  const ambiguous = version === undefined || (version.major === 8 && version.minor === undefined)
    ? ['overridesConfigLocation', 'overridesGrammar'] as const
    : []
  return {
    capabilities: capabilities({
      ...npm3,
      overridesConfigLocation: supportsOverrides ? 'manifest' : 'none',
      overridesGrammar: supportsOverrides ? 'npm-nested' : 'none',
    }),
    ambiguous,
  }
}

function pnpmV9(
  version: ManagerVersion | undefined,
): { capabilities: Readonly<ResolvedTargetCapabilities>; ambiguous: readonly TargetCapability[] } {
  const catalogs = version === undefined
    ? false
    : version.major > 9 || (version.major === 9 && (version.minor ?? 0) >= 5)
  const configLocation = version !== undefined && version.major >= 11
    ? 'workspace-yaml'
    : 'manifest'
  const ambiguous: TargetCapability[] = []
  if (version === undefined || (version.major === 9 && version.minor === undefined)) {
    ambiguous.push('catalogs')
  }
  if (version === undefined) ambiguous.push('overridesConfigLocation')
  return {
    capabilities: pnpm(true, true, true, configLocation, catalogs, pnpmModernMetadata),
    ambiguous,
  }
}

function resolvedCapabilities(
  format: FormatId,
  version: ManagerVersion | undefined,
): { capabilities: Readonly<ResolvedTargetCapabilities>; ambiguous: readonly TargetCapability[] } {
  switch (format) {
    case 'npm-1': return { capabilities: npm1, ambiguous: [] }
    case 'npm-2': return npmV2(version)
    case 'npm-3': return { capabilities: npm3, ambiguous: [] }
    case 'npm-4': return { capabilities: npm4, ambiguous: [] }
    case 'yarn-classic': return { capabilities: yarnClassic, ambiguous: [] }
    case 'yarn-berry-v4':
    case 'yarn-berry-v5':
    case 'yarn-berry-v6':
    case 'yarn-berry-v7':
    case 'yarn-berry-v8':
    case 'yarn-berry-v9':
    case 'yarn-berry-v10': return { capabilities: yarnBerry(format), ambiguous: [] }
    case 'pnpm-v5': return pnpmV5(version)
    case 'pnpm-v6': return { capabilities: pnpmV6, ambiguous: [] }
    case 'pnpm-v9': return pnpmV9(version)
    case 'bun-text':
    case 'bun-text-v2': return { capabilities: bunText, ambiguous: [] }
    case 'deno-v2':
    case 'deno-v3':
    case 'deno-v4':
    case 'deno-v5': return { capabilities: deno, ambiguous: [] }
    case 'lockgraph': return { capabilities: lockgraph, ambiguous: [] }
  }
}

// === TARGET RESOLUTION ======================================================

export function targetRequestOf(input: TargetInput): TargetRequest {
  return typeof input === 'string' ? Object.freeze({ format: input }) : input
}

export function targetProfileOf(request: TargetRequest): TargetProfile {
  const version = request.managerVersion === undefined ? undefined : parseVersion(request.managerVersion)
  assertCompatible(request.format, version)
  const resolved = resolvedCapabilities(request.format, version)
  return Object.freeze({
    manager: targetManagerOf(request.format),
    format: request.format,
    ...(request.managerVersion === undefined ? {} : { managerVersion: request.managerVersion }),
    capabilities: resolved.capabilities,
    ambiguousCapabilities: readonlySet(resolved.ambiguous),
    provenance: 'builtin',
  })
}
