import type { Manifest } from '../graph.ts'
import type { EnrichSources } from '../enrich/facade.ts'
import type { FormatId } from '../api/format-contract.ts'
import type { TargetInput } from '../completeness/types.ts'
import type { ArtifactResourcePolicy } from '../recipe/artifact-envelope.ts'

/** Supplies an in-memory project file map. */
export interface ProjectInput {
  readonly files: Readonly<Record<string, string | Uint8Array>>
}

/** Selects project files from filesystem patterns. */
export interface ProjectPathInput {
  readonly patterns: readonly string[]
  readonly cwd?: string
}

export type ConvertInput = string | ProjectInput | ProjectPathInput

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
export interface ConvertCommonOptions {
  readonly strict?: boolean
  readonly from?: FormatId
  readonly sources?: EnrichSources
  readonly fs?: ConvertFileSystem
  readonly workspaceRoot?: string
  readonly manifests?: Record<string, Manifest>
  readonly lineEnding?: 'lf' | 'crlf'
  readonly cacheKey?: string
  /** Mandatory-on artifact safety envelope forwarded to enrichment. */
  readonly artifactResources?: ArtifactResourcePolicy
  readonly onDiagnostic?: (diagnostic: import('../graph.ts').Diagnostic) => void
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

/** Injects filesystem dependencies for conversion. */
export interface ConvertDependencies {
  readonly fs?: ConvertFileSystem
  readonly defaultFileSystem: () => Promise<ConvertFileSystem>
}
