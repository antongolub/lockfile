import type { Graph, Manifest } from '../graph.ts'
import type { EnrichSources } from '../enrich/facade.ts'
import type { FormatId } from '../api/format-contract.ts'
import type { TargetInput } from '../completeness/types.ts'
import type { ArtifactResourcePolicy } from '../recipe/artifact-envelope.ts'
import type {
  FileSource,
  OperationSources,
  ProjectionOptions,
} from '../api/operation.ts'
import type {
  ConversionContract,
  ProjectEvidenceInput,
} from '../completeness/types.ts'

/** Supplies an in-memory project file map. */
export interface ProjectInput {
  readonly files: Readonly<Record<string, string | Uint8Array>>
}

/** Selects project files from filesystem patterns. */
export interface ProjectPathInput {
  readonly patterns: readonly string[]
  readonly cwd?: string
}

export type ConvertInput = string | Graph | ProjectInput | ProjectPathInput

/** Constrains filesystem globbing for deterministic conversion. */
export interface ConvertGlobOptions {
  readonly cwd: string
  readonly onlyFiles: true
  readonly followSymbolicLinks: false
}

/** Defines filesystem access required by path-based conversion. */
export interface ConvertFileSystem {
  readonly readFile: (path: string) => Promise<string | Uint8Array>
  readonly glob: (
    patterns: readonly string[],
    options: ConvertGlobOptions,
  ) => Promise<readonly string[]>
  readonly realpath: (path: string) => Promise<string>
}

/** Configures one conversion. */
export interface ConvertCommonOptions extends Omit<ProjectionOptions, 'sources' | 'target'> {
  readonly contract?: ConversionContract | 'install'
  readonly from?: FormatId
  readonly sources?: EnrichSources
  readonly fs?: ConvertFileSystem
  readonly workspaceRoot?: string
  readonly manifests?: Record<string, Manifest>
  readonly lineEnding?: 'lf' | 'crlf'
  readonly evidence?: readonly ProjectEvidenceInput[]
  readonly cacheKey?: string
  /** Mandatory-on artifact safety envelope forwarded to enrichment. */
  readonly artifactResources?: ArtifactResourcePolicy
}

interface ConvertTargetOptions {
  readonly target: TargetInput
  readonly to?: never
  readonly targetVersion?: never
}

interface LegacyConvertTargetOptions {
  readonly target?: never
  /** @deprecated Use target. */
  readonly to: FormatId
  /** @deprecated Use target.managerVersion. */
  readonly targetVersion?: string
}

/** Configures one conversion. */
export type ConvertOptions = ConvertCommonOptions & (
  | ConvertTargetOptions
  | LegacyConvertTargetOptions
)

/** Project conversion derives install completeness from one FileSource. */
export type ProjectConvertOptions =
  Omit<ProjectionOptions, 'sources'>
  & Readonly<{
    readonly contract?: 'install'
    readonly sources?: Omit<OperationSources, 'manifests'>
    readonly sourceFormat?: FormatId
    readonly fs?: ConvertFileSystem
    readonly lineEnding?: 'lf' | 'crlf'
    readonly evidence?: readonly ProjectEvidenceInput[]
  }>

/** One complete companion file emitted beside a project lockfile. */
export interface CompanionFile {
  readonly path: string
  readonly content: string
}

/** Product of the FileSource overload of convert. */
export interface ProjectOutput {
  readonly lockfile: string
  readonly companions: readonly CompanionFile[]
}

/** @internal Public FileSource spelling retained here for overload implementation. */
export type ProjectFileSource = FileSource

/** Injects filesystem dependencies for conversion. */
export interface ConvertDependencies {
  readonly fs?: ConvertFileSystem
  readonly defaultFileSystem: () => Promise<ConvertFileSystem>
}
