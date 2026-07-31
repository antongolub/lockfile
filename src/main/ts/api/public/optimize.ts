import type { Graph as InternalGraph } from '../../graph.ts'
import {
  removeUnreachable as removeUnreachableInternal,
  type RemoveUnreachableOptions as InternalRemoveOptions,
  type RemoveUnreachableResult as InternalRemoveResult,
} from '../../optimize/optimize.ts'
import {
  internalGraph,
  isPublicGraph,
  publicDiagnostics,
  publicGraph,
  type Graph,
  type NodeId,
} from './graph.ts'
import type {
  GraphOperationResult,
  ObserveOptions,
} from './operation.ts'
import { internalObserver } from './diagnostics.ts'
import { rethrowPublic } from './errors.ts'

export interface RemoveUnreachableOptions extends ObserveOptions {
  readonly preserve?: ReadonlySet<NodeId>
}

export interface RemoveUnreachableResult extends GraphOperationResult {
  readonly removed: readonly NodeId[]
}

export function removeUnreachable(
  graph: Graph,
  options?: RemoveUnreachableOptions,
): RemoveUnreachableResult
/** @internal Core-graph compatibility; stripped from the declaration. */
export function removeUnreachable(
  graph: InternalGraph,
  options?: InternalRemoveOptions,
): InternalRemoveResult
export function removeUnreachable(
  graph: Graph | InternalGraph,
  options: RemoveUnreachableOptions | InternalRemoveOptions = {},
): RemoveUnreachableResult | InternalRemoveResult {
  if (!isPublicGraph(graph)) {
    return removeUnreachableInternal(graph as InternalGraph, options as InternalRemoveOptions)
  }
  const publicOptions = options as RemoveUnreachableOptions
  let result: InternalRemoveResult
  try {
    result = removeUnreachableInternal(internalGraph(graph), {
      ...(publicOptions.preserve === undefined ? {} : { preserve: publicOptions.preserve }),
      ...(publicOptions.onDiagnostic === undefined
        ? {}
        : { onDiagnostic: internalObserver(publicOptions.onDiagnostic) }),
    })
  } catch (error) {
    return rethrowPublic(error)
  }
  return Object.freeze({
    graph: publicGraph(result.graph),
    diagnostics: publicDiagnostics(result.diagnostics),
    removed: Object.freeze([...result.removed]),
  })
}
