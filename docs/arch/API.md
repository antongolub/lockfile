# API reference

| Name | Operates on | Summary |
|---|---|---|
| [`detect`](#detect) | lockfile | Identify a lockfile's format. |
| [`check`](#check) | lockfile | Test bytes against one format. |
| [`parse`](#parse) | lockfile → graph | Read a lockfile into a graph. |
| [`stringify`](#stringify) | graph → lockfile | Emit a graph for a target format. |
| [`convert`](#convert) | lockfile → lockfile | Parse, enrich and emit in one call. |
| [`modify`](#modify) | graph | Apply edits and report the frontier. |
| [`complete`](#complete) | graph | Resolve and wire what a change introduced. |
| [`removeUnreachable`](#removeunreachable) | graph | Sweep nodes unreachable from the workspaces. |
| [`selectConstrained`](#selectconstrained) | registry | Pick a version satisfying range and conditions. |
| [`enrich`](#enrich) | graph | Fill everything the target format requires. |
| [`prepareFrozen`](#preparefrozen) | lockfile → candidate | Build a candidate for a pinned manager version. |
| [`certifyFrozen`](#certifyfrozen) | candidate + files | Bind a manager run to that candidate. |
| [`liveRegistry`](#liveregistry) | — | Network-backed registry adapter. |
| [`frozenRegistry`](#frozenregistry) | graph | Registry adapter backed by the graph. |
| [`resolveRegistry`](#resolveregistry) | — | Resolve registry config from the project. |
| [`defaultFetch`](#defaultfetch) | — | Default transport. |
| [`lockgraphStore`](#lockgraphstore) | — | Construct a verified-byte store. |
| [`engines`](#engines) | — | Condition on a candidate's `engines`. |
| [`license`](#license) | — | Condition on a candidate's licence. |
| [`LockfileError`](#lockfileerror) | — | The only thrown type. |

Shared shapes: [common options](#common-options) · [target](#target) ·
[sources](#sources) · [guards](#guards) · [store](#store) · [contracts](#contracts)

---

## detect

<!-- readme-example id="api-sig-detect" mode="signature" -->
```ts
function detect(input: string): FormatId | undefined
```

Identifies a lockfile's format from its bytes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input` | `string` | yes | Lockfile text. |

**Returns** `FormatId`, or `undefined` when no format matches.

**Throws** nothing.

<!-- readme-example id="api-detect" mode="typecheck" -->
```ts
import { readFile } from 'node:fs/promises'
import { detect } from 'lockgraph'

detect(await readFile('pnpm-lock.yaml', 'utf8'))   // 'pnpm-v9'
detect('not a lockfile')                           // undefined
```

## check

<!-- readme-example id="api-sig-check" mode="signature" -->
```ts
function check(input: string, format: FormatId): boolean
```

Tests whether bytes are a specific format.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input` | `string` | yes | Lockfile text. |
| `format` | `FormatId` | yes | Format to test against. |

**Returns** `boolean`.

**Throws** nothing.

## parse

<!-- readme-example id="api-sig-parse" mode="signature" -->
```ts
function parse(input: string, format?: FormatId, options?: ParseOptions): Graph
```

Reads a lockfile into a `Graph`. Synchronous; performs no network access. Reads
workspace and override material from the project, controlled by `cwd` and
`sources.policy`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `input` | `string` | yes | | Lockfile text. |
| `format` | `FormatId` | no | detected | Source format. |
| `options.cwd` | `string` | no | `process.cwd()` | Discovery start for workspace and policy material. |
| `options.sources.policy` | `PmConfigEvidence` | no | discovered | Package-manager configuration evidence. |
| `options.onDiagnostic` | `DiagnosticObserver` | no | | Non-fatal findings, in emission order. |

**Returns** `Graph`.

**Throws** `LockfileError` — `PARSE_FAILED`, `FORMAT_DETECT_FAILED`, `FORMAT_MISMATCH`.

<!-- readme-example id="api-parse" mode="typecheck" -->
```ts
import { readFile } from 'node:fs/promises'
import { parse } from 'lockgraph'

const graph = parse(await readFile('pnpm-lock.yaml', 'utf8'))
graph.roots()                 // workspace node ids
graph.byName('lodash')        // every lodash node id
graph.overrides()             // overrides the lock pins
graph.diagnostics()           // findings from parsing
```

## stringify

<!-- readme-example id="api-sig-stringify" mode="signature" -->
```ts
function stringify(graph: Graph, target: TargetInput, options?: StringifyOptions): string
```

Emits a graph as a lockfile. `target` is required: a graph does not imply a format.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `graph` | `Graph` | yes | | Graph to emit. |
| `target` | `TargetInput` | yes | | See [target](#target). |
| `options.strict` | `boolean` | no | `true` | `false` emits despite projection loss and reports it. |
| `options.lineEnding` | `'lf' \| 'crlf'` | no | source | Line endings. |
| `options.sources.policy` | `PmConfigEvidence` | no | discovered | Configuration evidence. |
| `options.onDiagnostic` | `DiagnosticObserver` | no | | Non-fatal findings. |

**Returns** `string`.

**Throws** `LockfileError` — `ENRICH_REQUIRED` when the target needs material the
graph does not carry; `IRREDUCIBLE_LOSS` under `strict`.

## convert

<!-- readme-example id="api-sig-convert" mode="signature" -->
```ts
function convert(input: string, options: ConvertOptions): Promise<string>
function convert(input: Graph, options: ConvertOptions): Promise<string>
function convert(input: FileSource, options: ProjectConvertOptions): Promise<ProjectOutput>
```

`parse` + `enrich` + `stringify`. Asynchronous because filling gaps may read
manifests, a registry or cached archives.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `input` | `string \| Graph \| FileSource` | yes | | Lockfile text, a graph, or the project's files. |
| `options.sourceFormat` | `FormatId` | no | detected | Source format. |
| `options.contract` | `ConversionContract` | no | `'snapshot'` | See [contracts](#contracts). |
| `options.strict` | `boolean` | no | `true` | As `stringify`. |
| `options.lineEnding` | `'lf' \| 'crlf'` | no | source | Line endings. |
| `options.evidence` | `ProjectEvidenceInput[]` | no | discovered | Pre-read project evidence. |
| `options.fs` | `ConvertFileSystem` | no | node fs | Filesystem for the project form. |

Plus [common options](#common-options).

**Returns** `Promise<string>`; `Promise<ProjectOutput>` for a `FileSource` input.

**Throws** `LockfileError` — `ENRICH_REQUIRED`, `IRREDUCIBLE_LOSS`, `CAPABILITY_LACK`,
`INVALID_INPUT`.

<!-- readme-example id="api-convert" mode="typecheck" -->
```ts
import { readFile } from 'node:fs/promises'
import { convert } from 'lockgraph'

await convert(await readFile('pnpm-lock.yaml', 'utf8'), { target: 'npm-3' })

await convert(await readFile('yarn.lock', 'utf8'), {
  target: 'yarn-berry-v10',
  sources: { artifacts: ['yarn-berry:.yarn/cache', 'npm'] },
})
```

### Project form

`convert(FileSource, ProjectConvertOptions)` returns `{ lockfile, companions }`.
Companions are the other files the target manager needs changed with the lock; the
set depends on the format pair and is computed per conversion.

| Field | Difference from `ConvertOptions` |
|---|---|
| `contract` | only `'install'` |
| `sources.manifests` | absent — the project input is the manifest authority |

Coverage is derived from the root manifest and the workspace topology it declares. A
manifest set that does not cover the discovered workspaces produces a diagnostic.

## modify

<!-- readme-example id="api-sig-modify" mode="signature" -->
```ts
function modify(
  graph: Graph,
  change: Modification | readonly Modification[],
  options: ModifyOptions,
): Promise<ModifyResult>
```

Applies edits to a graph. A list is applied in order; diagnostics and frontier state
are collected once for the whole batch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `graph` | `Graph` | yes | Graph to edit. |
| `change` | `Modification \| Modification[]` | yes | One edit or an ordered batch. |
| `options` | `ModifyOptions` | yes | [common options](#common-options). |

**`Modification` variants**

| `kind` | Fields |
|---|---|
| `replaceVersion` | `selector: ReplaceVersionSelector`, `to: string` |
| `pinOverride` | `name: string`, `to: string` |
| `addDependency` | `parent: NodeId`, `name: string`, `range: string`, `edge: EdgeKind` |
| `removeDependency` | `parent: NodeId`, `name: string` |
| `applyPatch` | `ApplyPatchSpec` |
| `filterLicense` | allow / deny sets |

**Returns** `ModifyResult`

| Field | Type | Description |
|---|---|---|
| `graph` | `Graph` | The edited graph. |
| `applied` | `GraphChange[]` | What each edit did. |
| `frontier` | `GraphFrontier` | `{ added, orphaned }` — pass to `complete` as `seed`. |
| `diagnostics` | `Diagnostic[]` | In emission order. |

**Throws** `LockfileError` — `INVALID_INPUT`, `CAPABILITY_LACK`.

<!-- readme-example id="api-modify" mode="typecheck" -->
```ts
import { readFile } from 'node:fs/promises'
import { complete, modify, parse } from 'lockgraph'

const target = 'npm-3'
const graph = parse(await readFile('package-lock.json', 'utf8'))

const bumped = await modify(graph, [
  { kind: 'replaceVersion', selector: { name: 'lodash' }, to: '4.17.21' },
  { kind: 'pinOverride', name: 'minimist', to: '1.2.8' },
], { target })

await complete(bumped.graph, { target, seed: bumped.frontier, pruneOrphans: true })
```

## complete

<!-- readme-example id="api-sig-complete" mode="signature" -->
```ts
function complete(graph: Graph, options: CompleteOptions): Promise<CompleteResult>
```

Resolves the transitive dependencies a change introduced, wires their edges, and
optionally retires what it stranded.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `graph` | `Graph` | yes | | Graph to settle. |
| `options.seed` | `GraphFrontier` | no | whole graph | Bounds the pass to one change's delta. Normally `modify(...).frontier`. |
| `options.pruneOrphans` | `boolean` | no | `false` | Retire nodes the seeded change left with no incoming edge. |
| `options.resolution` | `'highest' \| 'prefer-existing'` | no | `'highest'` | `'prefer-existing'` reuses versions already in the lock. |
| `options.overrides` | `OverrideConstraint[]` | no | declared | Overrides the result must honour. |
| `options.constraints` | `Condition[]` | no | | See [`engines`](#engines), [`license`](#license). |
| `options.onUnevaluable` | `OnUnevaluable` | no | | Behaviour when a condition cannot be decided. |
| `options.budget` | `CompletionBudget` | no | | Bounds resolution work. |

Plus [common options](#common-options).

**Returns** `CompleteResult` — `{ graph, added: NodeId[], wired: EdgeTriple[], removed: NodeId[], diagnostics }`.

**Throws** `LockfileError` — `COMPLETION_FAILED`, `INVALID_INPUT`.

## removeUnreachable

<!-- readme-example id="api-sig-removeunreachable" mode="signature" -->
```ts
function removeUnreachable(
  graph: Graph,
  options?: RemoveUnreachableOptions,
): RemoveUnreachableResult
```

Mark-and-sweep from the workspaces. Synchronous, deterministic, idempotent. Refuses a
graph with no workspace anchor rather than removing everything.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `graph` | `Graph` | yes | Graph to sweep. |
| `options.preserve` | `ReadonlySet<NodeId>` | no | Nodes to keep regardless of reachability. |
| `options.onDiagnostic` | `DiagnosticObserver` | no | Non-fatal findings. |

**Returns** `RemoveUnreachableResult` — `{ graph, removed: NodeId[], diagnostics }`.
`removed` is content-sorted.

**Throws** nothing; a rootless graph is reported as a diagnostic.

## selectConstrained

<!-- readme-example id="api-sig-selectconstrained" mode="signature" -->
```ts
function selectConstrained(
  name: string,
  range: string,
  options: SelectConstrainedOptions,
): Promise<SelectConstrainedResult>
```

Picks the version of a package satisfying both a range and a set of conditions. Works
against registry metadata; takes no graph.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | yes | Package name. |
| `range` | `string` | yes | Semver range. |
| `options.registry` | `RegistryAdapter` | yes | Metadata source. |
| `options.conditions` | `Condition[]` | yes | Every candidate must pass all of them. |
| `options.onUnevaluable` | `OnUnevaluable` | no | Behaviour when a condition cannot be decided. |

**Returns** `SelectConstrainedResult`

| Field | Type | Description |
|---|---|---|
| `selected` | `PackumentVersion \| undefined` | The chosen version, if any. |
| `rejected` | `RejectedCandidate[]` | `{ name, version, condition, reason? }` per refusal. |

**Throws** `LockfileError` — `REGISTRY_UNAVAILABLE`.

## enrich

<!-- readme-example id="api-sig-enrich" mode="signature" -->
```ts
function enrich(graph: Graph, options: EnrichOptions): Promise<EnrichResult>
```

Completes the graph and materialises what the target manager expects, including
overlays whose order matters.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `graph` | `Graph` | yes | | Graph to enrich. |
| `options.contract` | `ConversionContract` | no | `'snapshot'` | See [contracts](#contracts). |

Plus [common options](#common-options).

**Returns** `EnrichResult` — `{ graph, diagnostics }`.

**Throws** `LockfileError` — `ENRICH_REQUIRED`, `CAPABILITY_LACK`, `INVALID_INPUT`.

## prepareFrozen

<!-- readme-example id="api-sig-preparefrozen" mode="signature" -->
```ts
function prepareFrozen(input: string | Graph, options: FrozenOptions): Promise<FrozenPreparationResult>
function prepareFrozen(input: FileSource, options: ProjectFrozenOptions): Promise<FrozenPreparationResult>
```

Builds a candidate a pinned manager version should accept without rewriting.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input` | `string \| Graph \| FileSource` | yes | Lockfile text, a graph, or the project's files. |
| `options.target` | `PinnedTargetRequest` | yes | `managerVersion` is **required** here. |
| `options.sourceFormat` | `FormatId` | no | Source format. |
| `options.evidence` | `ProjectEvidenceInput[]` | no | Pre-read project evidence. |
| `options.fs` | `ConvertFileSystem` | no | Filesystem implementation. |
| `options.lineEnding` | `'lf' \| 'crlf'` | no | Line endings. |

Plus [common options](#common-options) except `strict`.

**Returns** `FrozenPreparationResult`

| Field | Type | Description |
|---|---|---|
| `candidate` | `FrozenCandidate` | `{ lockfile, companions }` plus its verification subject. |
| `assessment` | `ConversionAssessment` | Per-requirement status. `unassessed` means unchecked, not failed. |
| `diagnostics` | `Diagnostic[]` | In emission order. |

**Throws** `LockfileError` — `ENRICH_REQUIRED`, `INVALID_INPUT`.

## certifyFrozen

<!-- readme-example id="api-sig-certifyfrozen" mode="signature" -->
```ts
function certifyFrozen(
  candidate: FrozenCandidate,
  options: FrozenCertificationOptions,
): Promise<FrozenConversionResult>
```

Binds a real manager run to the candidate that produced it. The caller runs the
manager; core never shells out.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `candidate` | `FrozenCandidate` | yes | | From `prepareFrozen`. |
| `options.files` | `FileSource` | yes | | Post-run files: paths or globs relative to `cwd`, or a content map. |
| `options.manager` | `PackageManager` | yes | | Which manager actually ran. `'lockgraph'` is not accepted. |
| `options.version` | `string` | yes | | That manager's real `--version` output. |
| `options.platform` | `string` | no | `process.platform` | Platform the run happened on. |
| `options.cwd` | `string` | no | `process.cwd()` | Where to read `files` from. |
| `options.fs` | `ConvertFileSystem` | no | node fs | Filesystem implementation. |

**Returns** `FrozenConversionResult` — `{ lockfile, companions, verification, assessment, diagnostics }`.

**Throws** `LockfileError` when the candidate is stale, copied, or belongs to a
different target, manager, version or platform.

The bound hashes give integrity, not authenticity: they prevent a receipt being
reused for another projection; they cannot prove an untrusted party ran the manager.

<!-- readme-example id="api-frozen" mode="typecheck" -->
```ts
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { certifyFrozen, prepareFrozen } from 'lockgraph'

const run = promisify(execFile)
const cwd = process.cwd()
const { stdout } = await run('npm', ['--version'], { cwd })
const version = stdout.trim()

const { candidate } = await prepareFrozen(['package.json', 'package-lock.json'], {
  target: { format: 'npm-3', managerVersion: version },
  cwd,
})
await writeFile('package-lock.json', candidate.lockfile)
for (const file of candidate.companions) await writeFile(file.path, file.content)

await run('npm', ['ci', '--ignore-scripts'], { cwd })

const certified = await certifyFrozen(candidate, {
  files: ['package-lock.json'],
  cwd,
  manager: 'npm',
  version,
})
console.log(certified.verification)
```

## liveRegistry

<!-- readme-example id="api-sig-liveregistry" mode="signature" -->
```ts
function liveRegistry(options?: LiveRegistryOptions): LiveRegistryAdapter
```

Constructs a network-backed registry adapter. The only byte-capable source: place it
in `sources.artifacts` for remote bytes; omit it and the operation is offline.

`LiveRegistryOptions` is one of two mutually exclusive shapes, plus transport fields
available to both.

| Shape | Fields |
|---|---|
| discovery | `cwd` (required), `config: RegistryConfigDialect` (required), `registry?`, `env?`, `home?` |
| supplied config | `config: RegistryConfig` — you answer the routing questions yourself |
| direct | `url?`, `authHeader?` |
| any of them | `fetch?`, `limit?` |

<!-- readme-example id="api-sig-registryconfig" mode="signature" -->
```ts
interface RegistryConfig {
  registryFor(packageName: string): string
  authHeaderFor(registryUrl: string): string | undefined
}
```

`authHeaderFor` is asked for credentials for a **registry root**, not for an arbitrary
URL. The adapter confines what you return to that route, revalidating every request
and every redirect hop; credentials are never forwarded to a different origin or path
prefix. Getting the binding right is the library's job, not the caller's.

| Field | Type | Description |
|---|---|---|
| `cwd` | `string` | Project root to read configuration from. |
| `config` | `RegistryConfigDialect \| RegistryConfig` | A dialect name to discover routing, or an object that supplies it. |
| `registry` | `string` | Override the resolved registry URL. |
| `env` | `Record<string, string \| undefined>` | Environment used for resolution. |
| `home` | `string` | Home directory used for resolution. |
| `url` | `string` | Registry URL, supplied directly. |
| `authHeader` | `string` | Authorization header, supplied directly. |
| `fetch` | `Fetch` | Transport. Defaults to [`defaultFetch`](#defaultfetch). |
| `limit` | `Limiter` | Concurrency and rate control. |

**Returns** `LiveRegistryAdapter`.

**Throws** `LockfileError` — `INVALID_INPUT` when the shapes are mixed.

A URL is requested only when it lies inside that package's configured route or is
attested by exact name-and-version metadata. Redirects are followed manually and
re-authorized per hop; credentials attach only after route authorization.

## frozenRegistry

<!-- readme-example id="api-sig-frozenregistry" mode="signature" -->
```ts
function frozenRegistry(graph: Graph): RegistryAdapter
```

Constructs a registry adapter answering only from what the graph already records.
Performs no network access.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `graph` | `Graph` | yes | Source of recorded evidence. |

**Returns** `RegistryAdapter`.

**Throws** nothing.

## resolveRegistry

<!-- readme-example id="api-sig-resolveregistry" mode="signature" -->
```ts
function resolveRegistry(cwd: string, options: ResolveRegistryOptions): RegistryConfig
```

Resolves registry URL, scope, auth and host binding from the package manager's own
configuration. Use it when the resolved values are wanted rather than an adapter.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cwd` | `string` | yes | Project root. |
| `options.config` | `RegistryConfigDialect` | yes | Configuration grammar to read. |
| `options.registry` | `string` | no | Override the resolved URL. |
| `options.env` | `Record<string, string \| undefined>` | no | Environment to resolve from. |
| `options.home` | `string` | no | Home directory to resolve from. |

**Returns** `RegistryConfig`.

**Throws** `LockfileError` — `INVALID_INPUT`.

## defaultFetch

<!-- readme-example id="api-sig-defaultfetch" mode="signature" -->
```ts
const defaultFetch: Fetch
```

The transport used when none is supplied. Exported so a custom `fetch` can wrap it
rather than reimplement it.

## lockgraphStore

<!-- readme-example id="api-sig-lockgraphstore" mode="signature" -->
```ts
function lockgraphStore(path?: string, options?: { maxBytes?: ByteSize }): Store
```

Constructs a verified-byte store for an operation to use in place of the global one.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | `string` | no | global location | Store root. |
| `options.maxBytes` | `ByteSize` | no | `'5 GiB'` | Capacity. Eviction is always enforced. |

**Returns** `Store`.

**Throws** `LockfileError` — `INVALID_INPUT` on a non-positive capacity.

Behaviour is described under [store](#store).

## engines

<!-- readme-example id="api-sig-engines" mode="signature" -->
```ts
function engines(
  required: Record<string, string>,
  options?: { mode?: 'lenient' | 'strict' },
): Condition
```

A condition accepting a candidate only when its `engines` field is compatible with
what is required.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `required` | `Record<string, string>` | yes | | Engine name to semver range. |
| `options.mode` | `'lenient' \| 'strict'` | no | `'lenient'` | `'lenient'` admits candidates declaring nothing; `'strict'` refuses them. |

**Returns** `Condition`.

## license

<!-- readme-example id="api-sig-license" mode="signature" -->
```ts
function license(options: { allow?: readonly string[]; deny?: readonly string[] }): Condition
```

A condition filtering candidates by licence identifier.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `options.allow` | `string[]` | no | Only these identifiers pass. |
| `options.deny` | `string[]` | no | These identifiers are refused. |

**Returns** `Condition`.

<!-- readme-example id="api-conditions" mode="typecheck" -->
```ts
import { engines, license, liveRegistry, selectConstrained } from 'lockgraph'

const { selected, rejected } = await selectConstrained('lodash', '^4', {
  registry: liveRegistry({ cwd: process.cwd(), config: 'npm' }),
  conditions: [
    engines({ node: '>=18' }, { mode: 'strict' }),
    license({ deny: ['GPL-3.0-only'] }),
  ],
})
for (const candidate of rejected) console.warn(candidate.version, candidate.condition)
```

## LockfileError

<!-- readme-example id="api-sig-lockfileerror" mode="signature" -->
```ts
class LockfileError extends Error {
  readonly code: LockfileErrorCode
  readonly diagnostics: readonly Diagnostic[]
  readonly losses?: readonly ProjectionLoss[]
  readonly cause?: unknown

  constructor(options: {
    code: LockfileErrorCode
    message?: string
    cause?: unknown
    diagnostics?: readonly Diagnostic[]
    losses?: readonly ProjectionLoss[]
  })
}
```

The only type this package throws.

| Property | Type | Description |
|---|---|---|
| `code` | `LockfileErrorCode` | Names the cause. Catalogued in [ERRORS.md](./ERRORS.md). |
| `diagnostics` | `Diagnostic[]` | Everything the operation had emitted when it failed. |
| `losses` | `ProjectionLoss[]` | Present on projection failures: what could not survive, and the remedy that would admit it. |
| `cause` | `unknown` | Underlying error, when there is one. |

`onDiagnostic` receives non-fatal findings only; fatal ones ride the throw.

---

# Shared shapes

## Common options

Taken by `convert`, `enrich`, `modify`, `complete`, `prepareFrozen` and
`certifyFrozen`.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `target` | `TargetInput` | yes | | See [target](#target). |
| `sources` | `OperationSources` | no | discovered | See [sources](#sources). |
| `cwd` | `string` | no | `process.cwd()` | Discovery start. The project root is found by walking upward; with no project marker, `cwd` is the root. |
| `guards` | `GuardProfile[]` | no | defaults | See [guards](#guards). |
| `store` | `Store \| false` | no | global store | See [store](#store). |
| `onDiagnostic` | `DiagnosticObserver` | no | | Called in emission order; the return value is ignored. |

Every operation returns at least `diagnostics`; graph operations also return `graph`.

## target

<!-- readme-example id="api-sig-targetinput" mode="signature" -->
```ts
type TargetInput = FormatId | TargetRequest
```

| Field | Type | Required | Description |
|---|---|---|---|
| `format` | `FormatId` | yes | Target format. |
| `managerVersion` | `string` | no | Pins the manager version. Required by `prepareFrozen`. |
| `cacheKey` | `string` | no | **Yarn Berry targets only.** Set when project compression configuration changes the target cache key. |

A bare `FormatId` pins the format and lets the manager version float.

## sources

| Field | Type | Authority granted |
|---|---|---|
| `manifests` | `FileSource` | The operation's sole project-manifest authority. Coverage is derived from the root manifest and discovered workspace topology. |
| `policy` | `PmConfigEvidence` | Package-manager configuration. |
| `packuments` | `RegistryAdapter[]` | Ordered metadata authorities; list position is lookup priority. |
| `artifacts` | `ArtifactSourceList` | Ordered byte and checksum authorities; list position is lookup priority. |

<!-- readme-example id="api-sig-filesource" mode="signature" -->
```ts
type FileSource =
  | readonly string[]                                  // paths or globs, resolved from cwd
  | Readonly<Record<string, string | Uint8Array>>      // virtual files; no filesystem access
```

### sources.artifacts

<!-- readme-example id="api-sig-artifactsource" mode="signature" -->
```ts
type ArtifactSource = string | RemoteArtifactRegistry
type ArtifactSourceList = readonly ArtifactSource[]
```

| Value | Meaning |
|---|---|
| `'npm'`, `'yarn-berry'` | That manager's default cache. |
| `'npm:<path>'`, `'yarn-berry:<path>'` | An explicit cache location. |
| `RemoteArtifactRegistry` | Explicit remote-byte authorization. |
| `'pnpm'`, `'pnpm:<path>'` | Rejected — `INVALID_INPUT`. The decomposed pnpm store retains neither a registry tarball nor a lock-carried archive checksum. |
| unknown family, empty path | Rejected — `INVALID_INPUT`, before any filesystem or network access. |

Byte kinds are never relabelled: npm supplies the original registry tgz, Yarn
supplies its own repacked-zip checksum.

The element type is `string` so an inferred `string[]` is accepted.
`ArtifactCacheSpecifier` is exported as the precise opt-in grammar; normalization is
the runtime authority.

## guards

<!-- readme-example id="api-sig-guardprofile" mode="signature" -->
```ts
interface GuardProfile {
  patterns?: readonly TarballKey[]
  artifactCompressed?: ByteSize
  artifactInflated?: ByteSize
  artifactTarContent?: ByteSize
  artifactRepacked?: ByteSize
  artifactLive?: ByteSize
  networkTraffic?: ByteSize
}
```

Ordered, first match wins. An unpatterned fallback must be last; a patterned profile
after it fails eagerly, before any source is accessed.

| Field | Default | Scope |
|---|---|---|
| `artifactCompressed` | `'384 MiB'` | per artifact |
| `artifactInflated` | `'3 GiB'` | per artifact |
| `artifactTarContent` | `'3 GiB'` | per artifact |
| `artifactRepacked` | `'3 GiB'` | per artifact |
| `artifactLive` | `'7 GiB'` | operation-wide |
| `networkTraffic` | `'5 GiB'` | operation-wide, cumulative response bodies |

`ByteSize` is `` `${number} ${'B'|'kB'|'MB'|'GB'|'KiB'|'MiB'|'GiB'}` `` and must
resolve to a positive safe integer.

A ceiling aborts an operation; it never weakens verification. `Content-Length` is
checked against the compressed ceiling and the remaining traffic budget before the
body is read; each chunk debits the meter before it is retained. No ceiling failure
returns shortened bytes, and nothing partial is written to the store. Local hits
debit no network traffic.

Integrity verification against lock-carried digests is not overridable by any guard
setting.

## store

<!-- readme-example id="api-sig-block24" mode="signature" -->
```ts
store?: Store | false
```

| Value | Effect |
|---|---|
| omitted | The global store is read first and written back to. |
| `false` | No store read, no write, no path diagnostic. |
| `Store` | Replaces the global store for that operation. |

| Property | Value |
|---|---|
| default location | `$XDG_CACHE_HOME/lockgraph` when absolute, else `~/.cache/lockgraph` |
| default capacity | 5 GiB |
| eviction | deterministic least-recently-used; never removes an in-flight object |
| permissions | `0700` directories, `0600` files |
| commit | same-filesystem temp-and-rename, cross-process pins, dead-owner recovery |
| path diagnostic | `STORE_PATH_RESOLVED`, once, before the first store filesystem mutation |
| corruption | `ENRICH_ARTIFACT_STORE_CORRUPT`; the object is removed and traversal continues |

A hit is re-verified: its canonical SHA-512 object is checked, then it traverses the
same envelope and current-lock integrity checks an external byte would face. Digest
aliases are lookup indexes, not retained proof. Deleting the store and re-acquiring
from unchanged sources reproduces identical bytes and diagnostics.

Stable paths and metadata contain no package name, URL, header, token or raw
diagnostic.

## contracts

<!-- readme-example id="api-sig-conversioncontract" mode="signature" -->
```ts
type ConversionContract = 'snapshot' | 'policy' | 'install'
```

| Value | Requirement |
|---|---|
| `snapshot` | Project the bytes as they are. |
| `policy` | Additionally satisfy declared policy. |
| `install` | Additionally materialise what the target manager needs to install. |

Each rung includes the previous one. There is no `frozen` value: see
[`prepareFrozen`](#preparefrozen) and
[CONVERT.md](./CONVERT.md#frozen-candidate-and-certification-lifecycle).

## Berry cache keys

Moving between Berry cache keys treats the existing checksum as source-domain
verification evidence: the tgz must reproduce it before the single Yarn-emittable
checksum is superseded with the target-domain digest.

| Cache key | Requirement |
|---|---|
| STORE, 7, 8, 9 | pure-JS pako path, always available |
| 10 | optional `@yarnpkg/libzip`; when absent and required, `ENRICH_ARTIFACT_INTEGRITY_UNSUPPORTED` names the remedy |
