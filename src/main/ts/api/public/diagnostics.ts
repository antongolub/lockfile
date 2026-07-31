import type {
  Diagnostic as InternalDiagnostic,
  EdgeTriple as InternalEdgeTriple,
} from '../../graph.ts'
import type { EdgeTriple, NodeId, TarballKey } from './graph.ts'
import type { LockfileErrorCode } from './errors.ts'

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export type DiagnosticCode =
  | LockfileErrorCode
  | 'STORE_PATH_RESOLVED'
  | 'STORE_CANDIDATE_CORRUPT'
  | 'STORE_READ_FAILED'
  | 'STORE_WRITE_FAILED'
  | 'STORE_CAPACITY_EXCEEDED'
  | 'STORE_EVICTION_FAILED'
  | 'CONVERT_FROZEN_ORACLE_MISMATCH'
  | `BUN_${string}`
  | `COMPLETENESS_${string}`
  | `COMPLETION_${string}`
  | `CONVERT_${string}`
  | `DENO_${string}`
  | `ENRICH_${string}`
  | `INTEROP_${string}`
  | `LAYOUT_${string}`
  | `MODIFY_${string}`
  | `NPM_${string}`
  | `OVERRIDE_${string}`
  | `PNPM_${string}`
  | `PROJECTION_${string}`
  | `PRUNE_${string}`
  | `RECIPE_${string}`
  | `YARN_${string}`

export interface Diagnostic<
  Code extends DiagnosticCode = DiagnosticCode,
  Data extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly code: Code
  readonly subject?: NodeId | EdgeTriple | TarballKey
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly data?: Data
}

export type DiagnosticObserver = (diagnostic: Diagnostic) => void

export interface ObserveOptions {
  readonly onDiagnostic?: DiagnosticObserver
}

function isInternalEdgeTriple(value: unknown): value is InternalEdgeTriple {
  return value !== null
    && typeof value === 'object'
    && 'src' in value
    && 'dst' in value
    && 'kind' in value
}

function isPublicEdgeTriple(value: unknown): value is EdgeTriple {
  return value !== null
    && typeof value === 'object'
    && 'source' in value
    && 'target' in value
    && 'kind' in value
}

export function publicEdgeTriple(value: InternalEdgeTriple): EdgeTriple {
  return Object.freeze({ source: value.src, target: value.dst, kind: value.kind })
}

export function internalEdgeTriple(value: EdgeTriple): InternalEdgeTriple {
  return Object.freeze({ src: value.source, dst: value.target, kind: value.kind })
}

/** @internal Boundary adapter for diagnostics created by the pre-0.6 core. */
export function publicDiagnostic(value: InternalDiagnostic): Diagnostic {
  const subject = isInternalEdgeTriple(value.subject)
    ? publicEdgeTriple(value.subject)
    : value.subject
  return Object.freeze({
    code: value.code as DiagnosticCode,
    ...(subject === undefined ? {} : { subject }),
    severity: value.severity,
    message: value.message,
    ...(value.data === undefined ? {} : { data: Object.freeze({ ...value.data }) }),
  })
}

/** @internal Boundary adapter for caller-supplied graph diagnostics. */
export function internalDiagnostic(value: Diagnostic): InternalDiagnostic {
  const subject = isPublicEdgeTriple(value.subject)
    ? internalEdgeTriple(value.subject)
    : value.subject
  return Object.freeze({
    code: value.code,
    ...(subject === undefined ? {} : { subject }),
    severity: value.severity,
    message: value.message,
    ...(value.data === undefined ? {} : { data: { ...value.data } }),
  })
}

/** @internal Converts the public notification observer at one API boundary. */
export function internalObserver(
  observer: DiagnosticObserver | undefined,
): ((diagnostic: InternalDiagnostic) => void) | undefined {
  return observer === undefined ? undefined : diagnostic => observer(publicDiagnostic(diagnostic))
}
