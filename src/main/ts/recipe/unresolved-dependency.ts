import type {
  Diagnostic,
  EdgeKind,
  Graph,
} from '../graph.ts'

export const UNRESOLVED_DEPENDENCY_FEATURE = 'unresolved-dependency-declaration'

export interface UnresolvedDependencyDeclaration {
  readonly src: string
  readonly kind: EdgeKind
  readonly name: string
  readonly descriptor: string
  readonly resolution?: string
  readonly channel?: string
}

interface UnresolvedDependencyDiagnosticData extends Record<string, unknown> {
  readonly feature: typeof UNRESOLVED_DEPENDENCY_FEATURE
  readonly unresolvedDependency: UnresolvedDependencyDeclaration
}

export function unresolvedDependencyData(
  declaration: UnresolvedDependencyDeclaration,
): UnresolvedDependencyDiagnosticData {
  return Object.freeze({
    feature: UNRESOLVED_DEPENDENCY_FEATURE,
    unresolvedDependency: Object.freeze({ ...declaration }),
  })
}

export function unresolvedDependencyDeclarationOf(
  diagnostic: Diagnostic,
): UnresolvedDependencyDeclaration | undefined {
  const data = diagnostic.data
  if (data?.feature !== UNRESOLVED_DEPENDENCY_FEATURE) return undefined
  const value = data.unresolvedDependency
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const declaration = value as Record<string, unknown>
  if (
    typeof declaration.src !== 'string'
    || !isEdgeKind(declaration.kind)
    || typeof declaration.name !== 'string'
    || typeof declaration.descriptor !== 'string'
    || (declaration.resolution !== undefined && typeof declaration.resolution !== 'string')
    || (declaration.channel !== undefined && typeof declaration.channel !== 'string')
  ) {
    return undefined
  }
  return Object.freeze({
    src: declaration.src,
    kind: declaration.kind,
    name: declaration.name,
    descriptor: declaration.descriptor,
    ...(declaration.resolution === undefined ? {} : { resolution: declaration.resolution }),
    ...(declaration.channel === undefined ? {} : { channel: declaration.channel }),
  })
}

export function unresolvedDependencyDeclarationsOf(
  graph: Graph,
): readonly UnresolvedDependencyDeclaration[] {
  return Object.freeze(graph.diagnostics()
    .map(unresolvedDependencyDeclarationOf)
    .filter((item): item is UnresolvedDependencyDeclaration =>
      item !== undefined && unresolvedDependencyDeclarationActive(graph, item)))
}

export function mergeUnresolvedDependencyDeclarations(
  graph: Graph,
  src: string,
  kind: EdgeKind,
  block: Record<string, string>,
  valueOf: (declaration: UnresolvedDependencyDeclaration) => string = item => item.descriptor,
  channel?: string,
): Record<string, string> {
  const merged = { ...block }
  for (const declaration of unresolvedDependencyDeclarationsOf(graph)) {
    if (
      declaration.src !== src
      || declaration.kind !== kind
      || (channel !== undefined && declaration.channel !== channel)
      || merged[declaration.name] !== undefined
    ) {
      continue
    }
    merged[declaration.name] = valueOf(declaration)
  }
  return merged
}

export function unresolvedDependencyProjectionKey(
  graph: Graph,
  declaration: UnresolvedDependencyDeclaration,
): string {
  const owner = graph.getNode(declaration.src)
  return JSON.stringify([
    owner?.workspacePath ?? null,
    owner?.name ?? declaration.src,
    owner?.version ?? null,
    owner?.peerContext ?? [],
    declaration.kind,
    declaration.name,
    declaration.descriptor,
  ])
}

function unresolvedDependencyDeclarationActive(
  graph: Graph,
  declaration: UnresolvedDependencyDeclaration,
): boolean {
  if (graph.getNode(declaration.src) === undefined) return false
  return !graph.out(declaration.src, declaration.kind).some(edge => {
    const target = graph.getNode(edge.dst)
    return (edge.attrs?.alias ?? target?.name) === declaration.name
  })
}

function isEdgeKind(value: unknown): value is EdgeKind {
  return value === 'dep'
    || value === 'dev'
    || value === 'optional'
    || value === 'peer'
    || value === 'bundled'
}
