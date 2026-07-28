import type {
  Diagnostic,
  Graph,
  Manifest,
  OverrideConstraint,
} from '../graph.ts'

export type FormatId =
  | 'yarn-berry-v4'
  | 'yarn-berry-v5'
  | 'yarn-berry-v6'
  | 'yarn-berry-v7'
  | 'yarn-berry-v8'
  | 'yarn-berry-v9'
  | 'yarn-berry-v10'
  | 'yarn-classic'
  | 'npm-1'
  | 'npm-2'
  | 'npm-3'
  | 'npm-4'
  | 'pnpm-v5'
  | 'pnpm-v6'
  | 'pnpm-v9'
  | 'bun-text'
  | 'deno-v2'
  | 'deno-v3'
  | 'deno-v4'
  | 'deno-v5'
  | 'lockgraph'

export type DenoFormatId = Extract<FormatId, `deno-v${string}`>

export function isDenoFormat(format: string): format is DenoFormatId {
  return format === 'deno-v2'
    || format === 'deno-v3'
    || format === 'deno-v4'
    || format === 'deno-v5'
}

export interface ParseOptions {
  /**
   * Filesystem root for adapter parse hooks that read out-of-lockfile
   * sources (yarn-berry / pnpm v6 / pnpm v9 / npm-4 patch byte hashing per
   * ADR-0014 §4.F2). Adapters without out-of-lockfile reads ignore it.
   */
  workspaceRoot?: string
  /**
   * Declared manifests keyed by workspace path (ADR-0025). Supplies override
   * declarations + workspace context the lockfile alone cannot carry.
   */
  manifests?: Record<string, Manifest>
  /**
   * Canonical declared-override context for descriptor binding. This is the
   * direct counterpart to manifest capture and is also used by internal output
   * probes, where the emitted lock must be reparsed under the same policy that
   * governed the source graph.
   */
  overrides?: OverrideConstraint[]
  onDiagnostic?: (diagnostic: Diagnostic) => void
}

export interface StringifyOptions {
  strict?: boolean
  lineEnding?: 'lf' | 'crlf'
  cacheKey?: string
  /**
   * Caller-supplied canonical override constraints (ADR-0025). Each adapter
   * projects them to its native form (pnpm `overrides:` / npm
   * `packages[""].overrides`); yarn-berry emits a loss diagnostic.
   */
  overrides?: OverrideConstraint[]
  onDiagnostic?: (diagnostic: Diagnostic) => void
}

export interface FormatAdapterContract<ParseContext, StringifyContext> {
  readonly check: (input: string) => boolean
  readonly parse: (input: string, context: ParseContext) => Graph
  readonly stringify: (graph: Graph, context: StringifyContext) => string
}
