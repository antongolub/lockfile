// bun-text-v2 adapter — bun `bun.lock` with `lockfileVersion: 2` (bun >= 1.4).
//
// Thin entry threading the v2 generation through `bun-text.ts`, the same shape as
// `pnpm-v6.ts` / `pnpm-v9.ts` over the pnpm flat core.
//
// The SCHEMA is identical to `bun-text`: measured against bun 1.3.14 and 1.4.0 on a
// project exercising workspaces, an alias, `overrides`, optional and peer dependencies
// with `peerDependenciesMeta`, `trustedDependencies` and the `workspace:` protocol, the
// two generations emit byte-identical locks apart from the integer. It is a separate
// format id anyway, because the generation has to be REQUESTABLE: converting into bun
// from another family has no bun source to inherit a generation from, and a bun-1.4
// user is entitled to the lock their own bun would write. Every other family already
// works this way — npm-1..4, pnpm-v5/v6/v9, deno-v2..v5.
//
// The pair is asymmetric on purpose: `bun-text` keeps its published name and means
// generation 1, rather than being renamed to `bun-text-v1` and breaking every consumer
// that already targets it.

import type { Diagnostic, Graph } from '../graph.ts'
import {
  BUN_TEXT_V2,
  check as checkGeneration,
  enrich as enrichGeneration,
  optimize as optimizeGeneration,
  parse as parseGeneration,
  stringify as stringifyGeneration,
  type BunTextEnrichOptions,
  type BunTextManifest,
  type BunTextOptimizeOptions,
  type BunTextParseOptions,
  type BunTextStringifyOptions,
} from './bun-text.ts'

export type BunTextV2ParseOptions = BunTextParseOptions
export type BunTextV2StringifyOptions = BunTextStringifyOptions
export type BunTextV2EnrichOptions = BunTextEnrichOptions
export type BunTextV2OptimizeOptions = BunTextOptimizeOptions
export type BunTextV2Manifest = BunTextManifest

export function check(input: string): boolean {
  return checkGeneration(input, BUN_TEXT_V2)
}

export function parse(input: string, options: BunTextV2ParseOptions = {}): Graph {
  return parseGeneration(input, options, BUN_TEXT_V2)
}

export function stringify(graph: Graph, options: BunTextV2StringifyOptions = {}): string {
  return stringifyGeneration(graph, options, BUN_TEXT_V2)
}

export function enrich(
  graph: Graph,
  options: BunTextV2EnrichOptions = {},
): { graph: Graph; diagnostics: Diagnostic[] } {
  return enrichGeneration(graph, options)
}

export function optimize(
  graph: Graph,
  options: BunTextV2OptimizeOptions = {},
): { graph: Graph; diagnostics: Diagnostic[] } {
  return optimizeGeneration(graph, options)
}
