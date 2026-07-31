import {
  LockfileError as InternalLockfileError,
  type ProjectionLoss as InternalProjectionLoss,
  type ProjectionRemedy as InternalProjectionRemedy,
} from '../errors.ts'
import type { FormatId } from '../format-contract.ts'
import {
  publicDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
} from './diagnostics.ts'

export type LockfileErrorCode =
  | 'PARSE_FAILED'
  | 'FORMAT_DETECT_FAILED'
  | 'FORMAT_MISMATCH'
  | 'CAPABILITY_LACK'
  | 'IRREDUCIBLE_LOSS'
  | 'INVALID_INPUT'
  | 'ENRICH_REQUIRED'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVARIANT_VIOLATION'

export type ProjectionLossClass =
  | 'enrichable'
  | 'inherent-meaningful'
  | 'berry-checksum'
  | 'structural-expected'

export type ProjectionRemedy =
  | Readonly<{
      kind: 'supply'
      source: 'packuments' | 'artifacts' | 'manifests' | 'policy'
      subject?: string
    }>
  | Readonly<{ kind: 'use-convert'; contract: 'install' }>
  | Readonly<{ kind: 'allow-loss'; strict: false }>
  | Readonly<{ kind: 'verify-target'; requirement: 'pinned-frozen-oracle' }>

export interface ProjectionLoss {
  readonly class: ProjectionLossClass
  readonly feature: string
  readonly target: FormatId
  readonly subject?: Diagnostic['subject']
  readonly remedy: ProjectionRemedy
  readonly reason: DiagnosticCode
}

export interface LockfileError extends Error {
  readonly code: LockfileErrorCode
  readonly diagnostics: readonly Diagnostic[]
  readonly losses?: readonly ProjectionLoss[]
  readonly cause?: unknown
}

interface LockfileErrorConstructor {
  readonly prototype: LockfileError
  new(options: Readonly<{
    code: LockfileErrorCode
    message?: string
    cause?: unknown
    diagnostics?: readonly Diagnostic[]
    losses?: readonly ProjectionLoss[]
  }>): LockfileError
}

/** The public constructor is the core runtime identity with a stable 0.6 view. */
export const LockfileError = InternalLockfileError as unknown as LockfileErrorConstructor

function publicRemedy(value: InternalProjectionRemedy): ProjectionRemedy {
  switch (value.kind) {
    case 'supply':
      return Object.freeze({
        kind: 'supply',
        source: value.source === 'registry'
          ? 'packuments'
          : value.source === 'config'
            ? 'policy'
            : value.source,
        ...(value.subject === undefined ? {} : { subject: value.subject }),
      })
    case 'use-project-api':
      return Object.freeze({ kind: 'use-convert', contract: 'install' })
    case 'allow-loss':
      return Object.freeze({ kind: 'allow-loss', strict: false })
    case 'verify-target':
      return Object.freeze({ ...value })
  }
}

function publicLoss(value: InternalProjectionLoss): ProjectionLoss {
  const diagnostic = publicDiagnostic(value.diagnostic)
  return Object.freeze({
    class: value.class,
    feature: value.feature,
    target: value.target,
    ...(diagnostic.subject === undefined ? {} : { subject: diagnostic.subject }),
    remedy: publicRemedy(value.remedy),
    reason: diagnostic.code,
  })
}

/** @internal Re-forms core failures at the stable caller boundary. */
export function rethrowPublic(error: unknown): never {
  if (!(error instanceof InternalLockfileError)) throw error
  const converted = new InternalLockfileError({
    code: error.code,
    message: error.message,
    ...(error.cause === undefined ? {} : { cause: error.cause }),
    diagnostics: error.diagnostics.map(publicDiagnostic) as never,
    ...(error.losses === undefined
      ? {}
      : { losses: error.losses.map(publicLoss) as never }),
  })
  converted.stack = error.stack
  throw converted
}

/** @internal Async counterpart used by public operation facades. */
export async function publicPromise<Value>(value: Promise<Value>): Promise<Value> {
  try {
    return await value
  } catch (error) {
    return rethrowPublic(error)
  }
}
