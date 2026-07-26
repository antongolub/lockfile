# ADR-0039 — Target package-manager compatibility overlays

> Status: `proposed`
> Date: `2026-07-25`
> Design provenance: sequential Codex/Claude design and adversarial review.
> Implementation and pinned-oracle evidence are assembled in the working tree;
> Anton ratifies the stable state before commit.

## Context

A package manager may derive lock entries that do not exist in registry
metadata. Yarn 4.13 and 4.14 apply a builtin compatibility patch to
`fsevents@2.3.3` and add `node-gyp: npm:latest` to both the registry base and
the derived patch entry. A generic registry-completion pass cannot infer that
target-PM behaviour from the published manifest, and it must not fabricate
patches: ADR-0023 §4.2 remains normative — “completion does not synthesise
patches; patch application is `applyPatch`'s domain”.

Treating this as ordinary completion would make completion target-specific,
duplicate resolution and minting, and weaken its monotone-additive receipt.
Treating the builtin patch as a user patch would also be false: its locator hash
is PM metadata and its bytes are not a caller-owned patch file.

## Decision

### 1. Place a target-PM overlay around ordinary completion

The enrichment sequence is:

```text
target registry view
  → completeTransitives
  → target compatibility materialisation
  → metadata/artifact refurbish
  → optimize
  → strict projection
```

The pre-completion half is a scoped immutable `RegistryAdapter` view. For the
eligible `fsevents@2.3.3` observation only, it merges
`node-gyp: npm:latest` into `dependencies`. Every other package observation is
returned unchanged. `completeTransitives` remains the only resolver and minting
authority for `node-gyp` and its closure.

The post-completion half materialises one derived patch node only after ordinary
completion resolved and wired `node-gyp`. It:

- retains the bare `fsevents@2.3.3` base;
- adds the sibling locator
  `fsevents@patch:fsevents@npm%3A2.3.3#optional!builtin<compat/fsevents>::version=2.3.3&hash=df0bf1`;
- clones the base install out-edges, including `node-gyp`;
- inherits the base's effective emitted conditions (verbatim parsed scalar,
  explicit hint, or composed `os`/`cpu`/`libc`) and copies only canonical
  platform payload plus the native/canonical locator, never integrity or Berry
  cache-key data;
- rewires install consumers from the base to the patch; and
- records the complete structural delta in a dedicated
  `target-compatibility` derivation receipt.

This automatic compatibility overlay is distinct from the user-intent
`modify/apply-patch.ts` operation.

### 2. Use a narrow, evidence-backed profile

Eligibility is the exact tuple:

| Package | Resolved version | Builtin syntax era | Locator hash | Pinned producers |
| --- | --- | --- | --- | --- |
| `fsevents` | `2.3.3` | `optional!builtin<compat/fsevents>` | `df0bf1` | Yarn `4.13.0`, `4.14.1` |

The implementation gates on those exact pinned manager versions and a Yarn
Berry target. It does **not** gate on the lockfile format version: observed v7
locks contain both builtin syntax/hash eras, and the same lockfile generation is
therefore not authoritative.

`fsevents@2.3.2`, `~builtin<compat/fsevents>`, other locator hashes, unpinned
manager versions, and non-Berry targets remain outside the profile. They fail
closed as honest unsatisfied/unassessed projections; `2.3.2` is a deferred ADR
row, not an inferred extension.

### 3. Share the locator identity codec

The literal Yarn locator hash (`df0bf1`) is not `Node.patch`. The canonical
patch slot remains the unresolved-locator sentinel
`unresolved-sha256(locator)`. One shared encoder/parser derives the native
resolution, extracts its identity-bearing locator, and computes that sentinel.
The materialiser and Berry parser use the same codec, so
emit → parse preserves the exact NodeId.

### 4. Fail closed and materialise atomically

If `node-gyp` cannot resolve, the pre-completion dependency remains represented
by completion diagnostics and no patch pair is created. The materialiser also
does nothing when the profile, base identity, resolved `node-gyp` edge,
consumer descriptor, or shared locator identity is missing.

The pair is built in one trusted Builder seal because sentinel-keyed nodes are
intentionally immutable through the public `Graph.mutate` surface. Existing
Berry sidecar state is rebound, then deterministic base and patch entry-key
descriptors are attached. A second application is a no-op.

## Invariants

1. ADR-0023 §4.2 is unchanged. The overlay order is registry view → completion
   → materialisation → refurbish → optimize → strict.
2. Profile authority is `(package, resolved version, builtin-syntax era,
   patch hash)`, never lockfile version.
3. Materialisation is all-or-nothing and fail-closed.
4. Locator `hash=` is not `Node.patch`; the shared codec preserves identity
   through emit → parse.
5. The registry view is scoped: non-fsevents observations are byte-identical,
   including an eight-observation reference-and-digest check.
6. The overlay is deterministic and idempotent.
7. The patch remains checksum-bare; artifact refurbish may fill only the base.
8. Existing target emission semantics remain authoritative:
   `effectiveConditionsOfNode` composes platform conditions and per-field
   emitter capability gating remains unchanged.

## Verification requirements

The stable state requires all of:

- typecheck and complete unit suite;
- exact profile/fail-closed/idempotence tests;
- shared identity emit → parse test;
- structural derivation-receipt validation;
- non-fsevents registry reference and digest equality across eight repeated
  observations;
- patch-bare/base-checksum assertions;
- byte-identical fresh `fsevents` subtree against both pinned producers; and
- Yarn `4.13.0` and `4.14.1` `install --immutable` exit 0 with an unchanged
  generated lockfile.

The deterministic eight-fixture measurement baseline is also part of this
increment. Seven fixture result digests remain unchanged. `berry-large`
(`parcel-bundler-parcel-v2-5948485/yarn.lock`, Yarn Berry v8 → npm v3) is
intentionally re-pinned from
`sha256:1cb613e8d474e70b677bd348d2fa1acf646ba6c09fb80511fc1ac24c117beea4`
to
`sha256:d51d36cc43c87ab91948e259bb2ce5ae7fadccd1cb34f5f2af9d781aad40b5b9`.
The shared codec does not change either builtin patch's locator sentinel,
NodeId, graph digest, same-format bytes, or npm-v3 output (the assessed
conversion remains unsatisfied with no output). It changes only the two
`YARN_BERRY_PATCH_UNRESOLVED` messages for the fixture's builtin fsevents
entries: they now identify the intrinsic absence of an on-disk builtin source
instead of reporting a missing caller `workspaceRoot`. The resulting
assessment and mutation-diagnostic payloads account for the measurement
re-pin. The branch is exact-source-gated to
`optional!builtin<compat/fsevents>`; non-builtin Berry patch identity and
diagnostics retain the prior path.

## Consequences

- **Positive:** generic completion stays target-neutral and owns all registry
  resolution/minting.
- **Positive:** target-derived entries are explicit, receipted, deterministic,
  and round-trip-stable.
- **Positive:** an unresolved transitive cannot produce a plausible but invalid
  patch pair.
- **Cost:** each supported PM-derived behaviour needs a narrow observed profile
  and pinned native-oracle evidence.
- **Deferred:** `fsevents@2.3.2` and other builtin eras/hashes need separate
  evidence and ratification.

## Alternatives considered

- *Teach completion to synthesize patches* — rejected because it violates
  ADR-0023 §4.2 and couples generic registry completion to one PM.
- *Resolve/mint `node-gyp` inside the plugin* — rejected because it duplicates
  the resolver and closure algorithm.
- *Treat `df0bf1` as `Node.patch`* — rejected because it breaks canonical
  identity and emit → parse stability.
- *Gate on lockfile version* — rejected by observed mixed-era locks.
- *Guess `2.3.2` or unknown Yarn versions* — rejected; absence of pinned oracle
  evidence is not authority.
