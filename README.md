# lockgraph

> Universal lockfile model and converter for **npm**, **yarn**, **pnpm**, **bun**, **deno** with reasonable losses.

<p><img alt="lockgraph — universal lockfile model and converter for npm, yarn, pnpm, bun, and Deno" src="./pics/crossconv.png" align="right" width="350">

Each package manager brings its own philosophy of how to describe, store and
control project dependencies. Inside a single repo it stays invisible.
Across an organisation it becomes a recurring cost — security tooling that speaks
one format, migrations that stall, policy that cannot be applied uniformly.

Underneath every one of them is the same dependency graph. lockgraph models that
graph independently of any manager, then projects it back into the format you
need. Conversion is the obvious use case. Modification — audit-fix, override
pinning, license filtering — is the primary one.

</p>

## tl;dr

<!-- readme-example id="tldr-pnpm-to-npm" mode="fixture:simple-pnpm-v9-to-npm3" -->
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'lockgraph'

const graph = parse(await readFile('pnpm-lock.yaml', 'utf8'))
await writeFile('package-lock.json', stringify(graph, 'npm-3'))
```

| Format | ids |
|---|---|
| npm | `npm-1` `npm-2` `npm-3` `npm-4` |
| yarn | `yarn-classic`, `yarn-berry-v4` … `yarn-berry-v10` |
| pnpm | `pnpm-v5` `pnpm-v6` `pnpm-v9` |
| bun | `bun-text` |
| deno | `deno-v2` `deno-v3` `deno-v4` `deno-v5` |

All of them detect, parse and stringify. Conversion is defined for every ordered
pair; where a pair is unsupported, the contract states which evidence is missing
rather than only failing. [SCHEMAS.md](./docs/arch/SCHEMAS.md) maps each id to the
manager versions that emit it; [CONVERT.md](./docs/arch/CONVERT.md) holds the pair
matrix and its loss table.

## Concept

A target lockfile is **constructed** from whatever sources are available: the input
bytes, project manifests, the manager's cache, and — opt-in — the registry.
Conversion is the simple case; construction is the general one.

### Model

Three layers, never collapsed:

- **Manifest** — declared constraints from `package.json`.
- **Graph** — resolved package instances, peer-aware, and the edges between them.
  The canonical model. Modifiers operate here.
- **Layout** — the physical projection on disk: hoisted, isolated, PnP, nm-linked.

Conversion is lossy by design: the goal is *semantically equivalent*, not
*byte-identical*.

### Trusted output

**Verified by the package manager, not by our tests.** Each supported conversion is
checked by running the pinned binary — `npm ci`, `yarn --immutable`,
`pnpm --frozen-lockfile`, `deno install --frozen` — over the lockfile we produce.
If the manager rewrites that file, we do not claim the conversion.

**Irreducible facts are not negotiable.** Integrity hashes, resolution URLs and
signatures survive the projection or it throws instead of emitting a plausible file.
Losses are declared, named, and carry a remedy where one exists. `strict: false`
opts out.

**Behaviour is derived from research.** The format, package-manager and registry
specifications are built from official documentation together with producer source,
then checked against real artifacts.

### PM compose

The obvious way to generalise is to bundle the managers — every family, every major
version — and dispatch to whichever one a repository uses, the way
[Renovate](https://github.com/renovatebot/renovate) and
[Dependabot](https://github.com/dependabot/dependabot-core) run one helper per
manager.

We deliberately do not.

**Policy.** A cooling-off window on fresh releases, a trust rule, a license bar —
every manager supports its own subset, under its own name. Here it is a single
acceptance gate over the graph, identical no matter which one wrote the file.

**Predictability.** The usual chain is a direct edit repaired by a side effect —
inject, then `yarn --update-checksums`. It is fragile and non-deterministic: our own
[specification](./docs/spec/pm/yarn.md) could not pin how that flag and legacy
checksums interact. A change here is stated, and the output follows from it alone.

**Granularity.** Subgraphs move independently, each under its own rule — retarget a
transitive five levels down, pin an override in a neighbouring branch, and neither
disturbs anything else.

In exchange, correctness stops being free. A manager that runs is right by
construction; we have to prove it — and we bundle none.

## Install

```shell
npm i lockgraph
```

Node ≥ 14.18, ESM only. CommonJS consumers use `await import('lockgraph')`.

## Use

<!-- readme-example id="convert-and-enrich" mode="typecheck" -->
```ts
import { readFile } from 'node:fs/promises'
import { convert, enrich, parse, stringify } from 'lockgraph'

const raw = await readFile('yarn.lock', 'utf8')
const graph = parse(raw, 'yarn-berry-v8')   // or parse(raw) and let it detect

stringify(graph, 'yarn-berry-v10')
// LockfileError ENRICH_REQUIRED — v10 keys its cache differently, so
// @napi-rs/nice-android-arm-eabi@1.0.1 would emit without a checksum

const artifacts = [                                   // ordered byte sources:
  'yarn-berry:.yarn/cache',                           // Yarn's own cached zip hash
  'npm',                                              // original tgz fallback
]
const ready = await enrich(graph, {
  sources: { artifacts },
  target: 'yarn-berry-v10',
  contract: 'install',
})
const out = stringify(ready.graph, 'yarn-berry-v10')

const same = await convert(raw, {
  target: 'yarn-berry-v10',
  sources: { artifacts },
})
```

The subject comes first and the format after it, as in `JSON.parse`. Omit the
format and `parse` detects it; `stringify` needs it, since a graph does not imply a
target. The older format-first order still works, so existing code keeps running.

`parse` and `stringify` are synchronous and see only the bytes: what the source
carries, projected. They are enough whenever the target asks for nothing new. A
Berry v10 checksum is not the v8 one and has to be recomputed from the cache, so the
pair alone cannot get there: `ENRICH_REQUIRED` names the entry and what it lacks.

`convert` is the last three steps in one call: parse, complete for the target, emit.
That is why it is async and why it takes evidence. `modify` and `enrich` are async
for the same reason.

| API | Signature |
|---|---|
| `detect` | `(input) => FormatId \| undefined` |
| `check` | `(input, format) => boolean` |
| `parse` | `(input, format?, options?) => Graph`; format may also ride `options.format` |
| `stringify` | `(graph, format, options?) => string`; format may also ride `options.format` |
| `convert` | `(input, options) => Promise<string>` |

Round-tripping is a choice the caller makes, never a default.

### Operating on the graph

The graph is where the value is. Both operations are format-agnostic — they do not
care which manager produced the input.

- **`modify`** applies primitives: `replaceVersion`, `pinOverride`, `addDependency`,
  `removeDependency`, `applyPatch`, `filterLicense`. These are the building blocks
  of audit-fix, override pinning and license filtering.
- **`optimize`** sweeps unreachable nodes; **`pruneOrphans`** retires only nodes that
  lost their last incoming edge — post-bump cleanup that never over-collects a
  still-referenced dev, optional or peer dependency.
- **`overridesOf(graph)`** reads the canonical overrides back out.

The public sweep is synchronous, deterministic and idempotent. It keeps every
workspace-reachable node and reports the removed identities:

<!-- readme-example id="graph-sweeps" mode="typecheck" -->
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { parse, removeUnreachable, stringify } from 'lockgraph'

const graph = parse(await readFile('pnpm-lock.yaml', 'utf8'))

// Reachability — retires whatever the workspaces can no longer reach.
const swept = removeUnreachable(graph)
console.log(swept.removed)      // content-sorted NodeIds
console.log(swept.diagnostics)  // operation diagnostics, in emission order

await writeFile('pnpm-lock.yaml', stringify(swept.graph, 'pnpm-v9'))
```

The operation refuses a graph with no workspace anchor rather than
cascade-wiping it. Delta-local orphan bookkeeping remains an internal part of
ordered modification batches; it is not a second public graph-cleanup verb.

### Completing what a change introduced

A modification leaves holes: a bumped package brings transitive dependencies the
lockfile has never seen, and the target format may require fields the source never
carried. Two entry points fill them.

| `enrich` option | Meaning |
|---|---|
| return | `Promise<{ graph, diagnostics }>` |
| `sources` | `{ manifests?, registry?, artifacts?, config? }` |
| `target` | `FormatId \| { format, managerVersion? }` |
| `contract` | `'snapshot' \| 'policy' \| 'project' \| 'frozen'` |
| `cacheKey` | optional target checksum cache-key override |

**`enrich`** is the one to call. It is the target-aware facade: it completes the
graph *and* materialises what the target manager expects, including overlays whose
order matters. **`completeTransitives`** is the primitive
underneath — it wires the transitive closure from the registry, with optional
node-local `engines` / `license` gates and declared overrides honoured so the
result stays frozen-clean.

The former `enrich(graph, sources, options)` form remains available under
deprecation. Likewise, `convert` still accepts deprecated `to` and
`targetVersion`; new code uses `target` and, when pinned,
`target: { format, managerVersion }`.

Artifact cache entries are an ordered list. A family name uses that manager's
default cache; `family:path` selects an explicit location:

<!-- readme-example id="artifact-sources" mode="typecheck" -->
```ts
import { readFile, writeFile } from 'node:fs/promises'
import {
  enrich,
  liveRegistry,
  parse,
  stringify,
} from 'lockgraph'

const target = 'yarn-berry-v10'
const graph = parse(await readFile('yarn.lock', 'utf8'))
const registry = liveRegistry({
  cwd: process.cwd(),
  config: 'yarn-berry',
})
const artifacts = [
  'yarn-berry:./.yarn/cache',
  'npm:./.cache/npm/_cacache',
  registry, // explicit remote-byte authority, after the ordered local sources
]
const ready = await enrich(graph, {
  sources: { artifacts },
  target,
  contract: 'install',
})
await writeFile('yarn.lock', stringify(ready.graph, target))
```

The recognized families are `npm` and `yarn-berry`. npm can supply the original
registry tgz and Yarn can supply its own repacked-zip checksum. `pnpm` and
`pnpm:*` fail closed: the decomposed pnpm store supplies neither a retained
registry tarball nor a lock-carried archive checksum. Those byte kinds are never
relabelled. Existing callers may still pass either a split
`RefurbishSources` object or the deprecated combined `TarballSource`; the direct
`refurbish` primitive keeps its object contract.

Only a `LiveRegistryAdapter` is byte-capable. Build a scope-aware one with
`liveRegistry.fromConfig(cwd, options)` and place `registry` in the ordered
artifact list; omitting it is visibly offline. A remote URL is requested only
when it is inside that package's configured route or is attested by exact
name-and-version metadata. Redirects are followed manually and re-authorized
per hop, while credentials are attached only after route authorization. Returned
tgz bytes are always checked against lock-recorded integrity before a target
checksum is recomputed; absence, unsupported integrity, and mismatch are separate
named deferrals.

That central check also applies to local bytes. A hand-written legacy
`TarballSource.tarball()` that returns bytes for a graph with no verifiable
digest previously produced a checksum; it now defers with
`ENRICH_ARTIFACT_INTEGRITY_MISSING`. Real npm-family locks carry tgz integrity,
and Berry locks use the source-domain verification path described below.

Artifact processing is fail-closed under mandatory safety ceilings for compressed
input, inflated tar, cumulative tar content, repacked zip, and simultaneously
live materializations. Defaults are intentionally generous (384 MiB compressed,
3 GiB for each materialized expansion, 7 GiB live) and can be raised or lowered
globally or per tarball through `artifactResources`; a limit diagnostic
distinguishes the implementation default from a caller-provided ceiling. Large
artifact throughput can therefore be bounded by the live-byte meter; increasing
worker concurrency is not a remedy.

Lockgraph persistence is enabled by default and is separate from the ordered
artifact-source list. The operation first checks its lockgraph-owned,
integrity-addressed tgz store, then traverses the configured external sources,
and writes back only centrally verified bytes. Pass `store: false` to disable
both reads and writes. `store: lockgraphStore(path, { maxBytes })` replaces the
global store for that operation. The default store uses
`$XDG_CACHE_HOME/lockgraph` when that variable is absolute and
`~/.cache/lockgraph` otherwise. Capacity defaults to 5 GiB and is always
enforced by deterministic least-recently-used eviction. Before the operation's
first store filesystem mutation, `STORE_PATH_RESOLVED` reports the resolved
path exactly once.

Only bytes that have passed the same central envelope and current-lock
integrity checks are written. A hit verifies its canonical SHA-512 object and
then traverses those checks again. Digest aliases are lookup indexes, never
remembered proof. Corrupt objects or aliases emit
`ENRICH_ARTIFACT_STORE_CORRUPT`, are removed, and source traversal continues;
the next verified fetch self-heals the object or index. Writes use private
`0700` directories, `0600` files, same-filesystem temp-and-rename commits,
cross-process pins, dead-owner recovery, and deterministic eviction that never
removes an in-flight object. Stable paths and metadata contain no package name,
URL, header, token, or raw diagnostic. A public tarball digest can itself be
corpus-inverted, so the precise privacy claim is that the store adds no
identifying material beyond what content addressing inherently implies.

When moving between Berry cache keys, an existing checksum remains source-domain
verification evidence: the tgz must first reproduce it before the one Yarn-
emittable checksum is superseded with the target-domain digest. The pure-JS pako
path is required because Berry lock syntax cannot carry npm tgz SRI evidence.
It covers STORE plus mixed cache keys 7, 8, and 9. Mixed cache key 10 requires
the optional `@yarnpkg/libzip`; when it is absent and actually required,
`ENRICH_ARTIFACT_INTEGRITY_UNSUPPORTED` names that installation remedy.

Calling the primitives directly is supported but incomplete: `completeTransitives`
plus `refurbish` does not materialise Berry target-compatibility entries, and
strict output says so with `COMPLETENESS_TARGET_COMPATIBILITY_OVERLAY_REQUIRED`
rather than emitting a lock Yarn would reject.

### Registry

Re-resolution, checksum refill and advisory audit need a registry URL and its
credentials — resolved from the package-manager config, never guessed.

<!-- readme-example id="registry-imports" mode="typecheck" -->
```ts
import {
  defaultFetch,
  frozenRegistry,
  liveRegistry,
  resolveRegistry,
} from 'lockgraph'
```

`liveRegistry` talks to the network; `frozenRegistry` answers only from recorded
evidence, so a build can be proven offline. `resolveRegistry` reads the scope, auth
and host binding out of the ecosystem's own configuration. Transport and
concurrency are seams: pass your own `fetch` for proxy or CA handling, and your own
`limit` for rate control.

Everything not listed here works offline against the lockfile bytes alone.

### One public entry point

The package publishes one coherent facade: import every supported operation,
constructor and extension type from `lockgraph`. Implementation modules and the
former operation/registry subpaths are private, so callers never need to know how
the library is laid out internally.

<!-- readme-example id="root-facade-imports" mode="typecheck" -->
```ts
import {
  complete,
  defaultFetch,
  engines,
  enrich,
  liveRegistry,
  modify,
  removeUnreachable,
  resolveRegistry,
  selectConstrained,
  type Condition,
  type Limiter,
  type RegistryConfig,
} from 'lockgraph'
```

Use root `check`, `detect`, `parse`, and `stringify` for every supported format.
The root also exposes the registry and transport seams needed to implement
offline or custom-network operation policies without importing private modules.

### Frozen certification

For the strongest claim — *this exact manager version accepts this exact file
unchanged* — `prepareFrozen` emits a challenge, you run the native command, and
`certifyFrozen` binds the receipt to those exact bytes, target, platform and
config digest. A stale, copied or cross-target candidate fails closed.

Core never shells out. Those hashes provide **integrity**, not **authenticity**:
they stop a receipt being reused for another projection, but cannot prove an
untrusted party really ran the manager. See
[CONVERT.md](./docs/arch/CONVERT.md#frozen-candidate-and-certification-lifecycle).

## Errors

The library operates on a large set of deterministic, documented failure modes.
Each code names its cause and, where a remedy exists, the action that resolves it.
`LockfileError` carries format and conversion failures, `GraphError` covers
invariant violations, and recoverable loss flows through the non-throwing
`Diagnostic` channel and `onDiagnostic`.

The full catalogue — codes, causes, remedies — is
[ERRORS.md](./docs/arch/ERRORS.md).

## Specifications

The implementation is built from these documents. Each aggregates the official
documentation and the producer's own source, then verifies the result against real
artifacts and pinned binaries.

| | |
|---|---|
| [Formats](./docs/spec/formats/) | one document per format id: schema, quirks, capabilities, degradation |
| [Package managers](./docs/spec/pm/) | producer behaviour — what each manager writes, rewrites, strips and refuses |
| [Registries](./docs/spec/registry/) | the npm-protocol HTTP contract, auth schemes, per-provider deviations |

Where a specification states a fact, that fact was measured; where it could not be,
the document says so. Two overviews sit above them: [PM.md](./docs/meta/PM.md),
covering the JavaScript package managers we are aware of and what each one writes,
and [REGISTRIES.md](./docs/meta/REGISTRIES.md).

## Status

**0.x.** The API is additive within the line. Everything below fails closed, so none
of it degrades quietly.

- `modify` carries replay state for **Yarn** today. On a pnpm, bun or npm graph
  where that state is load-bearing, a mutation detaches it and strict mode refuses;
  `convert` preserves it fully.
- **pnpm-v5 workspace-peer projection** and **npm → Yarn Classic git locators**.
- **Bun text is v1-only** — `lockfileVersion: 0` is rejected.
- **Node-family → Deno synthesis**: target-side ids and peer suffixes are not
  producer-certified. The reverse direction works with sibling manifest evidence;
  JSR and remote modules become declared losses, with
  [`denoland/dnt`](https://github.com/denoland/dnt) as the source-level path.

## Lineage

This started as [`yarn-audit-fix`](https://github.com/antongolub/yarn-audit-fix) —
a local problem, audit remediation for one package manager, still maintained. The
scope here is the wider one it pointed at: a general processor for dependency
graphs, with the lockfile format as input and output rather than as the subject.

Libraries in the adjacent space cover parts of it:

| | |
|---|---|
| [synp](https://github.com/imsnif/synp) | converts `yarn.lock` ↔ `package-lock.json` |
| [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser) | builds a dependency tree from a lockfile, for scanning |
| [`@yarnpkg/lockfile`](https://github.com/yarnpkg/yarn/tree/master/packages/lockfile) | Yarn's own parser and stringifier for its format |
| [`@pnpm/lockfile.fs`](https://github.com/pnpm/pnpm/tree/main/lockfile) | pnpm's own reader and writer for `pnpm-lock.yaml` |

## License

[MIT](./LICENSE)
