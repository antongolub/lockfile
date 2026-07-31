import type { Graph as InternalGraph } from '../../graph.ts'
import { LockfileError } from '../errors.ts'
import {
  prepareFrozen as prepareFrozenInternal,
} from '../../convert/orchestrator.ts'
import type { ConvertInput as InternalConvertInput } from '../../convert/types.ts'
import type {
  ConversionAssessment as InternalConversionAssessment,
  FrozenCandidate as InternalFrozenCandidate,
  FrozenPreparationOptions as InternalFrozenOptions,
} from '../../completeness/types.ts'
import type { FormatId } from '../format-contract.ts'
import type {
  ConversionAssessment,
  PackageManager,
  PinnedTargetRequest,
  ProjectEvidenceInput,
} from './assessment.ts'
import { internalEvidence } from './assessment.ts'
import {
  internalGraph,
  isPublicGraph,
  publicDiagnostics,
  type Graph,
} from './graph.ts'
import {
  internalDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
} from './diagnostics.ts'
import type {
  FileSource,
  OperationResult,
  OperationSources,
  ProjectionOptions,
} from './operation.ts'
import { internalProjectionOptions } from './options.ts'
import {
  publicPromise,
  rethrowPublic,
} from './errors.ts'
import {
  loadProjectFiles,
  renderCompanionFiles,
  type CompanionFile,
  type ConvertFileSystem,
} from './convert.ts'

export interface FrozenOptions extends Omit<ProjectionOptions, 'target' | 'strict'> {
  readonly target: PinnedTargetRequest
  readonly sourceFormat?: FormatId
  readonly fs?: ConvertFileSystem
  readonly lineEnding?: 'lf' | 'crlf'
  readonly evidence?: readonly ProjectEvidenceInput[]
}

export type ProjectFrozenOptions =
  Omit<FrozenOptions, 'sources'>
  & Readonly<{ sources?: Omit<OperationSources, 'manifests'> }>

export interface FrozenVerificationSubject {
  readonly protocol: 'lockgraph-frozen-projection/v1'
  readonly target: PinnedTargetRequest
  readonly projectionDigest: string
}

export interface FrozenCandidate extends FrozenVerificationSubject {
  readonly lockfile: string
  readonly companions: readonly CompanionFile[]
}

export interface FrozenCertificationOptions {
  readonly files: FileSource
  readonly cwd?: string
  readonly fs?: ConvertFileSystem
  readonly manager: Exclude<PackageManager, 'lockgraph'>
  readonly version: string
  readonly platform?: string
}

export interface FrozenVerificationReceipt extends FrozenVerificationSubject {
  readonly verification: 'frozen-verified'
  readonly platform: string
  readonly oracle: Readonly<{
    protocol: 'lockgraph-native-frozen/v1'
    manager: Exclude<PackageManager, 'lockgraph'>
    version: string
  }>
}

export interface FrozenPreparationResult extends OperationResult {
  readonly candidate: FrozenCandidate
  readonly assessment: ConversionAssessment
}

export interface FrozenConversionResult extends OperationResult {
  readonly lockfile: string
  readonly companions: readonly CompanionFile[]
  readonly verification: FrozenVerificationReceipt
  readonly assessment: ConversionAssessment
}

interface CandidateState {
  readonly internal: InternalFrozenCandidate
  readonly assessment: ConversionAssessment
  readonly target: PinnedTargetRequest
  readonly lockfile: string
  readonly companions: readonly CompanionFile[]
}

const candidates = new WeakMap<FrozenCandidate, CandidateState>()

function internalInput(input: string | Graph | FileSource, cwd?: string): InternalConvertInput {
  if (typeof input === 'string') return input
  if (isPublicGraph(input)) return internalGraph(input)
  return Array.isArray(input)
    ? { patterns: input, ...(cwd === undefined ? {} : { cwd }) }
    : { files: input as Readonly<Record<string, string | Uint8Array>> }
}

function internalOptions(options: FrozenOptions): InternalFrozenOptions {
  const { sourceFormat, evidence, ...common } = options
  return {
    ...internalProjectionOptions(common),
    ...(sourceFormat === undefined ? {} : { from: sourceFormat }),
    ...(options.fs === undefined ? {} : { fs: options.fs }),
    ...(options.lineEnding === undefined ? {} : { lineEnding: options.lineEnding }),
    ...(evidence === undefined
      ? {}
      : { evidenceInputs: evidence.map(internalEvidence) }),
  } as InternalFrozenOptions
}

function publicAssessment(
  assessment: InternalConversionAssessment,
  target: PinnedTargetRequest,
  manifestCoverage: 'partial' | 'complete',
): ConversionAssessment {
  return Object.freeze({
    status: assessment.status,
    contract: assessment.contract === 'snapshot' || assessment.contract === 'policy'
      ? assessment.contract
      : 'install',
    target,
    manifestCoverage,
    requirements: Object.freeze(assessment.requirements.map(requirement => Object.freeze({
      key: requirement.key,
      status: requirement.status,
      reasons: Object.freeze(requirement.diagnostics.map(
        diagnostic => diagnostic.code as DiagnosticCode,
      )),
    }))),
  })
}

function failedPreparation(
  assessment: InternalConversionAssessment,
  message: string,
): never {
  return rethrowPublic(new LockfileError({
    code: 'ENRICH_REQUIRED',
    message,
    diagnostics: assessment.diagnostics,
  }))
}

export function prepareFrozen(
  input: string | Graph,
  options: FrozenOptions,
): Promise<FrozenPreparationResult>
export function prepareFrozen(
  input: FileSource,
  options: ProjectFrozenOptions,
): Promise<FrozenPreparationResult>
export async function prepareFrozen(
  input: string | Graph | FileSource,
  options: FrozenOptions | ProjectFrozenOptions,
): Promise<FrozenPreparationResult> {
  const project = typeof input !== 'string' && !isPublicGraph(input)
  const files = project
    ? await loadProjectFiles(input as FileSource, options as ProjectFrozenOptions)
    : {}
  const prepared = await publicPromise(prepareFrozenInternal(
    internalInput(input, options.cwd),
    internalOptions(options),
  ))
  if (prepared.candidate === undefined) {
    return failedPreparation(prepared.assessment, 'prepareFrozen: frozen contract is not satisfied')
  }
  const target = Object.freeze({ ...options.target }) as PinnedTargetRequest
  const assessment = publicAssessment(
    prepared.assessment,
    target,
    project ? 'complete' : 'partial',
  )
  const companions = renderCompanionFiles(prepared.candidate.companions, files)
  const candidate: FrozenCandidate = Object.freeze({
    protocol: prepared.candidate.protocol,
    target,
    projectionDigest: prepared.candidate.projectionDigest,
    lockfile: prepared.candidate.lockfile,
    companions,
  })
  candidates.set(candidate, Object.freeze({
    internal: prepared.candidate,
    assessment,
    target,
    lockfile: candidate.lockfile,
    companions,
  }))
  return Object.freeze({
    candidate,
    assessment,
    diagnostics: publicDiagnostics(prepared.assessment.diagnostics),
  })
}

function managerOf(target: FormatId): Exclude<PackageManager, 'lockgraph'> | undefined {
  if (target.startsWith('npm-')) return 'npm'
  if (target.startsWith('yarn-')) return 'yarn'
  if (target.startsWith('pnpm-')) return 'pnpm'
  if (target === 'bun-text') return 'bun'
  if (target.startsWith('deno-')) return 'deno'
  return undefined
}

function cacheKeyOf(target: PinnedTargetRequest): string | undefined {
  return 'cacheKey' in target ? target.cacheKey : undefined
}

function targetLockfile(format: FormatId): string {
  if (format.startsWith('npm-')) return 'package-lock.json'
  if (format.startsWith('yarn-')) return 'yarn.lock'
  if (format.startsWith('pnpm-')) return 'pnpm-lock.yaml'
  if (format === 'bun-text') return 'bun.lock'
  if (format.startsWith('deno-')) return 'deno.lock'
  return 'lockgraph.lockgraph'
}

function text(content: string | Uint8Array | undefined): string | undefined {
  if (content === undefined || typeof content === 'string') return content
  return new TextDecoder('utf-8', { fatal: true }).decode(content)
}

function fileContent(
  files: Readonly<Record<string, string | Uint8Array>>,
  name: string,
): string | undefined {
  const exact = text(files[name])
  if (exact !== undefined) return exact
  const candidates = Object.keys(files)
    .filter(candidate => candidate.endsWith(`/${name}`))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
  return candidates.length === 0 ? undefined : text(files[candidates[0]!])
}

function mismatch(message: string, data?: Readonly<Record<string, unknown>>): never {
  const diagnostic: Diagnostic = Object.freeze({
    code: 'CONVERT_FROZEN_ORACLE_MISMATCH',
    severity: 'error',
    message,
    ...(data === undefined ? {} : { data }),
  })
  throw new LockfileError({
    code: 'FORMAT_MISMATCH',
    message,
    diagnostics: [internalDiagnostic(diagnostic)],
  })
}

export async function certifyFrozen(
  candidate: FrozenCandidate,
  options: FrozenCertificationOptions,
): Promise<FrozenConversionResult> {
  const state = candidates.get(candidate)
  if (state === undefined) mismatch('certifyFrozen: candidate was not created by this runtime')
  if (candidate.protocol !== state.internal.protocol
    || candidate.projectionDigest !== state.internal.projectionDigest
    || candidate.lockfile !== state.lockfile
    || candidate.target.format !== state.target.format
    || candidate.target.managerVersion !== state.target.managerVersion
    || cacheKeyOf(candidate.target) !== cacheKeyOf(state.target)
    || candidate.companions !== state.companions) {
    mismatch('certifyFrozen: candidate projection state changed after preparation')
  }
  const expectedManager = managerOf(candidate.target.format)
  if (expectedManager === undefined || options.manager !== expectedManager) {
    mismatch('certifyFrozen: executed manager does not match the candidate target', {
      expected: expectedManager,
      actual: options.manager,
    })
  }
  const version = options.version.trim().replace(/^v(?=\d)/, '')
  if (version !== candidate.target.managerVersion) {
    mismatch('certifyFrozen: executed manager version does not match the pinned target', {
      expected: candidate.target.managerVersion,
      actual: version,
    })
  }
  const files = await loadProjectFiles(options.files, {
    target: candidate.target,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.fs === undefined ? {} : { fs: options.fs }),
  })
  const lockPath = targetLockfile(candidate.target.format)
  if (fileContent(files, lockPath) !== candidate.lockfile) {
    mismatch(`certifyFrozen: ${lockPath} differs from the prepared candidate`)
  }
  for (const companion of candidate.companions) {
    if (fileContent(files, companion.path) !== companion.content) {
      mismatch(`certifyFrozen: ${companion.path} differs from the prepared candidate`)
    }
  }
  const platform = options.platform ?? process.platform
  const verification: FrozenVerificationReceipt = Object.freeze({
    protocol: candidate.protocol,
    target: candidate.target,
    projectionDigest: candidate.projectionDigest,
    verification: 'frozen-verified',
    platform,
    oracle: Object.freeze({
      protocol: 'lockgraph-native-frozen/v1',
      manager: options.manager,
      version,
    }),
  })
  return Object.freeze({
    lockfile: candidate.lockfile,
    companions: candidate.companions,
    verification,
    assessment: state.assessment,
    diagnostics: Object.freeze([]),
  })
}
