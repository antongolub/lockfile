import path from 'node:path'
import type { Graph as InternalGraph } from '../../graph.ts'
import { LockfileError } from './errors.ts'
import { emitYaml, readYaml, type YamlMap } from '../../formats/_pnpm-yaml.ts'
import {
  convert as convertInternal,
  convertProjectRuntime,
} from '../../convert/orchestrator.ts'
import type {
  ConvertInput as InternalConvertInput,
  ConvertOptions as InternalConvertOptions,
} from '../../convert/types.ts'
import type { CompanionSetOperation } from '../../completeness/types.ts'
import type { FormatId } from '../format-contract.ts'
import type {
  ConversionContract,
  ProjectEvidenceInput,
} from './assessment.ts'
import { internalEvidence } from './assessment.ts'
import {
  internalGraph,
  isPublicGraph,
  type Graph,
} from './graph.ts'
import type {
  FileSource,
  OperationSources,
  ProjectionOptions,
} from './operation.ts'
import { internalProjectionOptions } from './options.ts'
import { publicPromise } from './errors.ts'

export interface ConvertGlobOptions {
  readonly cwd: string
  readonly onlyFiles: true
  readonly followSymbolicLinks: false
}

export interface ConvertFileSystem {
  readFile(path: string): Promise<string | Uint8Array>
  glob(patterns: readonly string[], options: ConvertGlobOptions): Promise<readonly string[]>
  realpath(path: string): Promise<string>
}

export interface ConvertOptions extends ProjectionOptions {
  readonly contract?: ConversionContract
  readonly sourceFormat?: FormatId
  readonly fs?: ConvertFileSystem
  readonly lineEnding?: 'lf' | 'crlf'
  readonly evidence?: readonly ProjectEvidenceInput[]
}

export type ProjectConvertOptions =
  Omit<ConvertOptions, 'contract' | 'sources'>
  & Readonly<{
    contract?: 'install'
    sources?: Omit<OperationSources, 'manifests'>
  }>

export interface CompanionFile {
  readonly path: string
  readonly content: string
}

export interface ProjectOutput {
  readonly lockfile: string
  readonly companions: readonly CompanionFile[]
}

function internalOptions(options: ConvertOptions): InternalConvertOptions {
  if ('to' in options || 'targetVersion' in options) {
    throw new LockfileError({
      code: 'INVALID_INPUT',
      message: 'target cannot be combined with removed to or targetVersion fields',
    })
  }
  const {
    sourceFormat,
    contract,
    ...common
  } = options
  return {
    ...internalProjectionOptions(common),
    ...(sourceFormat === undefined ? {} : { from: sourceFormat }),
    ...(contract === undefined
      ? {}
      : { contract: contract === 'install' ? 'project' : contract }),
    ...(options.fs === undefined ? {} : { fs: options.fs }),
    ...(options.lineEnding === undefined ? {} : { lineEnding: options.lineEnding }),
    ...(options.evidence === undefined
      ? {}
      : { evidence: options.evidence.map(internalEvidence) }),
  } as InternalConvertOptions
}

function isInternalGraph(input: unknown): input is InternalGraph {
  return input !== null
    && typeof input === 'object'
    && !isPublicGraph(input)
    && typeof (input as Partial<InternalGraph>).getNode === 'function'
    && typeof (input as Partial<InternalGraph>).nodes === 'function'
}

function isLegacyProjectInput(input: unknown): input is InternalConvertInput {
  return input !== null
    && typeof input === 'object'
    && ('files' in input || 'patterns' in input)
}

function decode(content: string | Uint8Array | undefined): string | undefined {
  if (content === undefined || typeof content === 'string') return content
  return new TextDecoder('utf-8', { fatal: true }).decode(content)
}

/** @internal Shared by the frozen facade; not part of the package surface. */
export async function loadProjectFiles(
  source: FileSource,
  options: ProjectConvertOptions,
): Promise<Readonly<Record<string, string | Uint8Array>>> {
  if (!Array.isArray(source)) {
    return source as Readonly<Record<string, string | Uint8Array>>
  }
  const fs = options.fs ?? (await import('../../convert/node-fs.ts')).nodeFileSystem
  const root = await fs.realpath(options.cwd ?? process.cwd())
  const matches = await fs.glob(source, {
    cwd: root,
    onlyFiles: true,
    followSymbolicLinks: false,
  })
  const files: Record<string, string | Uint8Array> = {}
  for (const match of matches) {
    const absolute = path.isAbsolute(match) ? match : path.resolve(root, match)
    const resolved = await fs.realpath(absolute)
    const relative = path.relative(root, resolved).split(path.sep).join('/')
    if (relative === '..' || relative.startsWith('../')) {
      throw new TypeError(`convert: project path escapes cwd: ${match}`)
    }
    files[relative] = await fs.readFile(resolved)
  }
  return files
}

function companionSource(
  files: Readonly<Record<string, string | Uint8Array>>,
  name: CompanionSetOperation['path'],
): string | undefined {
  const exact = decode(files[name])
  if (exact !== undefined) return exact
  const candidates = Object.keys(files)
    .filter(candidate => candidate.endsWith(`/${name}`))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
  return candidates.length === 0 ? undefined : decode(files[candidates[0]!])
}

function setPointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const segments = pointer.split('/').slice(1).map(segment =>
    segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let target = root
  for (const segment of segments.slice(0, -1)) {
    const current = target[segment]
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      target[segment] = {}
    }
    target = target[segment] as Record<string, unknown>
  }
  const leaf = segments.at(-1)
  if (leaf !== undefined) target[leaf] = value
}

/** @internal Shared by the frozen facade; not part of the package surface. */
export function renderCompanionFiles(
  patches: readonly CompanionSetOperation[],
  files: Readonly<Record<string, string | Uint8Array>>,
): readonly CompanionFile[] {
  const grouped = new Map<CompanionSetOperation['path'], CompanionSetOperation[]>()
  for (const patch of patches) {
    const values = grouped.get(patch.path) ?? []
    values.push(patch)
    grouped.set(patch.path, values)
  }
  const output: CompanionFile[] = []
  for (const [file, operations] of grouped) {
    const source = companionSource(files, file)
    const document = file === 'package.json'
      ? (source === undefined ? {} : JSON.parse(source)) as Record<string, unknown>
      : (source === undefined ? {} : readYaml(source))
    for (const operation of operations) setPointer(document, operation.pointer, operation.value)
    const content = file === 'package.json'
      ? `${JSON.stringify(document, null, 2)}\n`
      : emitYaml(document as YamlMap, { topLevelOrder: Object.keys(document) })
    output.push(Object.freeze({ path: file, content }))
  }
  return Object.freeze(output.sort((left, right) => left.path.localeCompare(right.path)))
}

export function convert(input: string, options: ConvertOptions): Promise<string>
export function convert(input: Graph, options: ConvertOptions): Promise<string>
export function convert(input: FileSource, options: ProjectConvertOptions): Promise<ProjectOutput>
/** @internal Source compatibility for the pre-0.6 conversion boundary. */
export function convert(input: InternalConvertInput, options: InternalConvertOptions): Promise<string>
export async function convert(
  input: string | Graph | InternalGraph | FileSource | InternalConvertInput,
  options: ConvertOptions | ProjectConvertOptions | InternalConvertOptions,
): Promise<string | ProjectOutput> {
  const publicOperation = isPublicGraph(input)
    || (typeof input === 'string' && 'target' in options)
  if (publicOperation) {
    return publicPromise(convertInternal(
      (isPublicGraph(input) ? internalGraph(input) : input) as InternalConvertInput,
      internalOptions(options as ConvertOptions),
    ))
  }
  if (typeof input === 'string' || isInternalGraph(input) || isLegacyProjectInput(input)) {
    return convertInternal(input as InternalConvertInput, options as InternalConvertOptions)
  }
  const projectOptions = options as ProjectConvertOptions
  const files = await loadProjectFiles(input as FileSource, projectOptions)
  const runtime = await publicPromise(convertProjectRuntime(
    Array.isArray(input)
      ? { patterns: input, ...(projectOptions.cwd === undefined ? {} : { cwd: projectOptions.cwd }) }
      : { files },
    internalOptions({ ...projectOptions, contract: 'install' }),
  ))
  return Object.freeze({
    lockfile: runtime.lockfile,
    companions: renderCompanionFiles(runtime.companions, files),
  })
}
