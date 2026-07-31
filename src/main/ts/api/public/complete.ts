import type { Graph as InternalGraph } from '../../graph.ts'
import {
  complete as completeInternal,
  engines as enginesInternal,
  license as licenseInternal,
  selectConstrained as selectConstrainedInternal,
  type CompleteOptions as InternalCompleteOptions,
  type CompleteResult as InternalCompleteResult,
} from '../../complete/operation.ts'
import type { CompletionBudget } from '../../complete/backtrack.ts'
import type { OnUnevaluable } from '../../complete/constraints.ts'
import {
  internalGraph,
  internalOverride,
  isPublicGraph,
  publicDiagnostics,
  publicGraph,
  type EdgeTriple,
  type Graph,
  type NodeId,
  type OverrideConstraint,
} from './graph.ts'
import { publicEdgeTriple } from './diagnostics.ts'
import type { GraphFrontier } from './modify.ts'
import type { GraphOperationResult, OperationOptions } from './operation.ts'
import { internalProjectionOptions } from './options.ts'
import type {
  PackumentVersion,
  RegistryAdapter,
} from './registry.ts'
import { publicPromise } from './errors.ts'

export type Awaitable<T> = T | Promise<T>
export type ConditionVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason?: string }>
  | Readonly<{ ok: 'unevaluable'; reason?: string }>

export interface ConditionContext {
  readonly name: string
  readonly version: string
  readonly candidate: PackumentVersion
  manifest(): Promise<PackumentVersion | undefined>
  readonly registry: RegistryAdapter
}

export interface Condition {
  readonly kind: string
  readonly cost?: number
  evaluate(context: ConditionContext): Awaitable<ConditionVerdict>
}

export interface RejectedCandidate {
  readonly name: string
  readonly version: string
  readonly condition: string
  readonly reason?: string
}

export interface SelectConstrainedOptions {
  readonly registry: RegistryAdapter
  readonly conditions: readonly Condition[]
  readonly onUnevaluable?: OnUnevaluable
}

export interface SelectConstrainedResult {
  readonly selected?: PackumentVersion
  readonly rejected: readonly RejectedCandidate[]
}

export const engines = enginesInternal as unknown as (
  required: Readonly<Record<string, string>>,
  options?: Readonly<{ mode?: 'lenient' | 'strict' }>,
) => Condition

export const license = licenseInternal as unknown as (options: Readonly<{
  allow?: readonly string[]
  deny?: readonly string[]
}>) => Condition

export const selectConstrained = selectConstrainedInternal as unknown as (
  name: string,
  range: string,
  options: SelectConstrainedOptions,
) => Promise<SelectConstrainedResult>

export interface CompleteOptions extends OperationOptions {
  readonly seed?: GraphFrontier
  readonly pruneOrphans?: boolean
  readonly resolution?: 'highest' | 'prefer-existing'
  readonly overrides?: readonly OverrideConstraint[]
  readonly constraints?: readonly Condition[]
  readonly onUnevaluable?: OnUnevaluable
  readonly budget?: CompletionBudget
}

export interface CompleteResult extends GraphOperationResult {
  readonly added: readonly NodeId[]
  readonly wired: readonly EdgeTriple[]
  readonly removed: readonly NodeId[]
}

export function complete(graph: Graph, options: CompleteOptions): Promise<CompleteResult>
/** @internal Core-graph compatibility; stripped from the declaration. */
export function complete(
  graph: InternalGraph,
  options: InternalCompleteOptions,
): Promise<InternalCompleteResult>
export async function complete(
  graph: Graph | InternalGraph,
  options: CompleteOptions | InternalCompleteOptions,
): Promise<CompleteResult | InternalCompleteResult> {
  if (!isPublicGraph(graph)) {
    return completeInternal(graph as InternalGraph, options as InternalCompleteOptions)
  }
  const publicOptions = options as CompleteOptions
  const result = await publicPromise(completeInternal(internalGraph(graph), {
    ...internalProjectionOptions(publicOptions),
    ...(publicOptions.seed === undefined ? {} : { seed: publicOptions.seed }),
    ...(publicOptions.pruneOrphans === undefined
      ? {}
      : { pruneOrphans: publicOptions.pruneOrphans }),
    ...(publicOptions.resolution === undefined ? {} : { resolution: publicOptions.resolution }),
    ...(publicOptions.overrides === undefined
      ? {}
      : { overrides: publicOptions.overrides.map(internalOverride) }),
    ...(publicOptions.constraints === undefined
      ? {}
      : { constraints: publicOptions.constraints as InternalCompleteOptions['constraints'] }),
    ...(publicOptions.onUnevaluable === undefined
      ? {}
      : { onUnevaluable: publicOptions.onUnevaluable }),
    ...(publicOptions.budget === undefined ? {} : { budget: publicOptions.budget }),
  } as InternalCompleteOptions))
  return Object.freeze({
    graph: publicGraph(result.graph),
    diagnostics: publicDiagnostics(result.diagnostics),
    added: Object.freeze([...result.added]),
    wired: Object.freeze(result.wired.map(publicEdgeTriple)),
    removed: Object.freeze([...result.removed]),
  })
}

export type { CompletionBudget, OnUnevaluable }
