/**
 * Same-format carrier for producer-tolerated, adapter-unknown top-level keys.
 *
 * Values are detached from the parser result so later emitter construction
 * cannot mutate the captured input. `order` records the complete source
 * top-level schedule: surviving source keys retain their positions and newly
 * synthesised modeled keys append in the emitter's canonical order.
 */
export interface UnknownTopLevelState {
  readonly values: Readonly<Record<string, unknown>>
  readonly order: readonly string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

export function cloneUnknownValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneUnknownValue)
  if (!isObject(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) output[key] = cloneUnknownValue(item)
  return output
}

export function captureUnknownTopLevel(
  source: Readonly<Record<string, unknown>>,
  knownKeys: readonly string[],
): UnknownTopLevelState | undefined {
  const known = new Set(knownKeys)
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) values[key] = cloneUnknownValue(value)
  }
  if (Object.keys(values).length === 0) return undefined
  return Object.freeze({
    values: Object.freeze(values),
    order: Object.freeze(Object.keys(source)),
  })
}

/** Merge the carrier behind modeled output: modeled fields always win. */
export function mergeUnknownTopLevel(
  modeled: Readonly<Record<string, unknown>>,
  state: UnknownTopLevelState | undefined,
): Record<string, unknown> {
  if (state === undefined) return { ...modeled }
  const combined: Record<string, unknown> = { ...modeled }
  for (const [key, value] of Object.entries(state.values)) {
    if (!Object.prototype.hasOwnProperty.call(combined, key)) {
      combined[key] = cloneUnknownValue(value)
    }
  }
  const ordered: Record<string, unknown> = {}
  for (const key of state.order) {
    if (Object.prototype.hasOwnProperty.call(combined, key)) ordered[key] = combined[key]
  }
  for (const [key, value] of Object.entries(combined)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) ordered[key] = value
  }
  return ordered
}

/**
 * Subject labels for one captured carrier, `<scope>:<key>`, sorted by key.
 *
 * A verbatim-replayed key is still a DECLARED loss the moment the graph is
 * projected to another format, so every captured key has to be nameable —
 * silent preservation that turns into silent loss at the format boundary is
 * the failure this reporting exists to prevent. `scope` distinguishes the
 * carriers a format may hold at once (project top level, per-workspace
 * manifest, …).
 */
export function unknownKeySubjects(
  state: UnknownTopLevelState | undefined,
  scope: string,
): readonly string[] {
  return state === undefined
    ? []
    : Object.keys(state.values).sort().map(key => `${scope}:${key}`)
}

export function unknownTopLevelSubjects(
  state: UnknownTopLevelState | undefined,
): readonly string[] {
  return unknownKeySubjects(state, 'top-level')
}
