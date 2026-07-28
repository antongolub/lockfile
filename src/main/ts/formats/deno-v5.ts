import type { Graph } from '../graph.ts'
import {
  checkVersion,
  parseVersion,
  stringifyVersion,
  type DenoParseOptions,
  type DenoStringifyOptions,
} from './_deno-core.ts'

export type { DenoParseOptions, DenoStringifyOptions } from './_deno-core.ts'

export function check(input: string): boolean {
  return checkVersion(input, '5')
}

export function parse(input: string, options: DenoParseOptions = {}): Graph {
  return parseVersion(input, '5', options)
}

export function stringify(
  graph: Graph,
  options: DenoStringifyOptions = {},
): string {
  return stringifyVersion(graph, '5', options)
}
