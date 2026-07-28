# ADR-0039 — Source and target package-manager compatibility overlays

> Status: `accepted`
> Date: `2026-07-25`
> Design provenance: sequential Codex/Claude design and adversarial review.
> Implementation and pinned-oracle evidence are assembled in the working tree;
> Anton ratifies the stable state before commit.

## Context

A package manager may derive lock entries and package facts that do not exist
in registry metadata. Yarn 4.13 and 4.14 apply builtin compatibility patches to
profiled versions of `fsevents`, `resolve`, and `typescript`. The `fsevents`
behavior additionally injects `node-gyp: npm:latest`; the other two retain
their ordinary registry-declared dependencies. Their derived artifact rules
also differ: the conditioned `fsevents` patch is checksum-bare, while the
unconditioned `resolve` and `typescript` patches carry exact Yarn cache-zip
checksums.

The reverse direction has the same provenance problem. Berry source locks
contain `node-gyp: npm:latest` edges injected by `NpmSemverResolver` for
native packages whose published manifests do not declare that dependency.
The measured corpus has 86 occurrences across 20 package names and 36 exact
owner package/version pairs. Native npm and pnpm locks omit those edges.
Re-emitting them to a non-Berry target changes dependency semantics and carries
a mutable dist-tag descriptor into an otherwise pinned lock.

A generic registry-completion pass cannot infer target-PM behavior from the
published manifest, and it must not fabricate patches or PM-specific artifact
facts: ADR-0023 §4.2 remains normative — “completion does not synthesise
patches; patch application is `applyPatch`'s domain”.

Treating this as ordinary completion would make completion target-specific,
duplicate resolution and minting, and weaken its monotone-additive receipt.
Treating a builtin patch as a user patch would also be false: its locator hash
is PM metadata and its bytes are not a caller-owned patch file. Treating a
derived cache checksum as registry integrity would be worse: Yarn's checksum
hashes its post-processed cache zip, not the npm tarball.

## Decision

### 1. Place source- and target-PM overlays around ordinary completion

The enrichment sequence is:

```text
source-provenance carry/drop
  → target registry view
  → completeTransitives
  → target compatibility materialisation
  → metadata/artifact refurbish
  → optimize
  → strict projection
```

The source half runs only after lossless source parsing/source-adapter
enrichment and before registry completion. It knows both source and target
formats. Berry → Berry carries source-derived edges unchanged. Proved Berry
v7-v10 → non-Berry removes only exact profiled
`owner → node-gyp` dependency edges with range `npm:latest` and no alias.
Unknown owners, older Berry formats, other source PMs, and lookalike edges
remain unchanged. Removal is recorded as a `target-compatibility` phase,
including its edge and root deltas.

This is the source-side inverse of target materialisation, not a separate
exception: the target registry view adds producer-derived content when
emitting to that producer, while the source projection removes the same class
of producer-derived content when emitting away from it. Both directions use
exact, pinned evidence and otherwise fail closed. Merely flagging the retained
edge as imprecise is insufficient: `node-gyp@latest` is a mutable dist-tag, so
an npm lock containing it would be non-reproducible by construction and would
not be a lock npm itself writes. Under the frozen-install invariant that is a
defect, not a tolerable documented loss.

The pre-completion half is a scoped immutable `RegistryAdapter` view. It reads
the package-keyed profile and projects only row-declared dependency injections.
For the eligible `fsevents` observations it merges `node-gyp: npm:latest` into
`dependencies`; the `resolve` and `typescript` rows declare no injection and
their registry observations are returned by reference. `completeTransitives`
remains the only resolver and minting authority for every dependency closure.

The post-completion half materialises one derived patch node per eligible base,
only after ordinary completion resolved and wired all row prerequisites. It:

- retains each bare registry base;
- adds the row-derived builtin `patch:` sibling locator;
- clones the base install out-edges, including ordinary registry dependencies
  and any row-injected dependencies;
- inherits the base's effective emitted conditions (verbatim parsed scalar,
  explicit hint, or composed `os`/`cpu`/`libc`) and copies canonical package
  metadata plus the native/canonical locator;
- discards base tarball integrity and Berry checksum data, then applies only the
  row's derived-patch checksum policy (`bare` or one exact native-proved
  cache-zip digest);
- rewires install consumers from the base to the patch; and
- records the complete structural delta in a dedicated
  `target-compatibility` derivation receipt.

This automatic compatibility overlay is distinct from the user-intent
`modify/apply-patch.ts` operation.

### 2. Use package-keyed, evidence-backed profiles

Target synthesis eligibility is the exact tuple:

| Package | Resolved version(s) | Builtin marker | Inner spelling | Locator hash | Injected dependencies | Patch checksum | Pinned producers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fsevents` | `2.3.2`, `2.3.3` | `optional!builtin` | `npm%3A`-encoded | `df0bf1` | `node-gyp: npm:latest` | bare | Yarn `4.13.0`, `4.14.1` |
| `resolve` | `1.22.8` | `optional!builtin` | `npm%3A`-encoded | `c3c19d` | none | hashed: `10c0/0446f024439cd2e50c6c8fa8ba77eaa8370b4180f401a96abf3d1ebc770ac51c1955e12764cde449fde3fff480a61f84388e3505ecdbab778f4bef5f8212c729` | Yarn `4.13.0`, `4.14.1` |
| `typescript` | `5.6.2` | `optional!builtin` | `npm%3A`-encoded | `8c6c40` | none | hashed: `10c0/94eb47e130d3edd964b76da85975601dcb3604b0c848a36f63ac448d0104e93819d94c8bdf6b07c00120f2ce9c05256b8b6092d23cf5cf1c6fa911159e4d572f` | Yarn `4.13.0`, `4.14.1` |

The implementation gates on those exact pinned manager versions and a Yarn
Berry target. It does **not** gate on the lockfile format version: observed v7
locks contain both builtin syntax/hash eras, and the same lockfile generation is
therefore not authoritative.

The corpus contains 18 `(builtin family, locator hash)` pairs. Builtin marker
(`builtin`, `~builtin`, `optional!builtin`) and inner-locator spelling (bare or
`npm%3A`-encoded) vary independently, so both are row fields. The current
target profile is a three-row package table whose `versions` member may hold
more than one independently proved version. Dependency injection and checksum
presence are also row data; adding another package or version never adds a
package-name branch to the algorithm.

Other builtin syntax eras, locator hashes, package versions, unpinned manager
versions, and non-Berry targets remain outside the profile. They fail closed as
honest unsatisfied/unassessed projections.

Source-edge removal uses a separate exact 36-row owner package/version table
plus source format, target family, edge kind/range, destination name, and alias
absence. This narrow table is necessary because the lock bytes do not
distinguish an injected `node-gyp: npm:latest` edge from an author declaration
with the same text.

### 3. Share the builtin-compat locator identity codec

The literal per-package Yarn locator hashes (`df0bf1`, `c3c19d`, `8c6c40`) are
not `Node.patch`. The canonical patch slot remains the unresolved-locator sentinel
`unresolved-sha256(locator)`. One shared encoder/parser derives the native
resolution, extracts its identity-bearing locator, and computes that sentinel.
The materialiser and Berry parser use the same codec, so
emit → parse preserves the exact NodeId.

The codec recognizes all observed parse-side marker/spelling combinations.
Recognition means only “this source is internal to Yarn and must not be read as
a workspace patch file”; it does not authorize synthesis. The old
`~builtin` yarn-major branch was unreachable and is removed. Target synthesis
continues to require an exact profile row.

### 4. Fail closed and materialise atomically

If a row-declared injected dependency cannot resolve, the pre-completion
dependency remains represented by completion diagnostics and no patch pair is
created. A hashed row also fails closed if its exact 128-hex cache-zip digest is
missing. The materialiser otherwise does nothing when the profile, base
identity, consumer descriptor, or shared locator identity is missing.

The pair is built in one trusted Builder seal because sentinel-keyed nodes are
intentionally immutable through the public `Graph.mutate` surface. Existing
Berry sidecar state is rebound, then deterministic base and patch entry-key
descriptors are attached. A second application is a no-op.

## Invariants

1. ADR-0023 §4.2 is unchanged. The overlay order is source projection →
   registry view → completion → materialisation → refurbish → optimize →
   strict.
2. Target profile authority is `(package, resolved version, builtin marker,
   inner-locator spelling, patch hash, producer)`, never lockfile version
   alone.
3. Materialisation is all-or-nothing and fail-closed.
4. Locator `hash=` is not `Node.patch`; the shared codec preserves identity
   through emit → parse.
5. The registry view is scoped: observations without a row-declared injection
   are returned by reference, including `resolve`, `typescript`, and an
   eight-observation ordinary-package reference-and-digest check.
6. The overlay is deterministic and idempotent.
7. Patch checksum presence is row-owned: conditioned `fsevents` remains bare;
   `resolve` and `typescript` carry only their exact native-proved cache-zip
   digests. Registry SRI is never re-encoded as a Berry checksum.
8. Existing target emission semantics remain authoritative:
   `effectiveConditionsOfNode` composes platform conditions and per-field
   emitter capability gating remains unchanged.
9. Parsing is lossless. Source-derived edge removal occurs only in enrichment,
   preserves Berry → Berry, is deterministic/idempotent, and is fully
   receipted.
10. A structural `node-gyp@npm:latest` match without an exact proved source row
    is retained.

## Verification requirements

The stable state requires all of:

- typecheck and complete unit suite;
- exact profile/fail-closed/idempotence tests;
- exact source-derived-edge carry/drop/fail-closed/idempotence tests, including
  Berry → Berry preservation and end-to-end Berry → npm output;
- all six observed builtin marker × inner-spelling parse combinations, with no
  workspace-file diagnostic;
- shared identity emit → parse test;
- structural derivation-receipt validation;
- uninjected-profile and ordinary registry reference stability, with ordinary
  digest equality across eight repeated observations;
- row-specific bare/hashed patch-checksum assertions;
- byte-identical fresh `fsevents@2.3.2`, `fsevents@2.3.3`,
  `resolve@1.22.8`, and `typescript@5.6.2` complete lockfiles and subtrees
  against both pinned producers; and
- Yarn `4.13.0` and `4.14.1` `install --immutable` exit 0 with an unchanged
  generated lockfile.

The deterministic eight-fixture measurement baseline is also part of this
increment. Before `ManifestKnowledge` joined the assessment payload, widening
builtin recognition and then applying the source-derived-edge overlay moved
`berry-large` from
`sha256:d51d36cc43c87ab91948e259bb2ce5ae7fadccd1cb34f5f2af9d781aad40b5b9`
through
`sha256:cff719203af4ec918822d15fd2fa76e639b8a9a14ae47885cc804798b6eae562`
to
`sha256:bb0280e9b5cd0f21aa5f05f966e5d04ec37d6fd36b8fd84a0036aa17c2455155`.
The intermediate step reflects the six `resolve` and four `typescript`
builtin entries reporting the intrinsic no-on-disk-source diagnostic instead
of a fabricated missing workspace/file diagnostic. The final pre-axis step
reflects exact injected-edge removal during non-Berry enrichment assessment.
Same-format bytes and the parse graph digest remain unchanged.

Adding `ManifestKnowledge` to the serialized assessment then intentionally
re-pins all eight result digests:

| Fixture | Post-`ManifestKnowledge` result digest |
| --- | --- |
| `npm-small` | `sha256:fe947e93301b771b13cf5795fdc1ab418f079ab87f0571b420ec87d81246dfe4` |
| `npm-large` | `sha256:3abb2ffc307c3ded4cf4f8899a5efc9741e5eff5fbd9687983a0bb35c4d0e723` |
| `pnpm-small` | `sha256:9bde016290063faabfd64c2c60513dc4b3b8a0c199d29238e9866cf27ab881a4` |
| `pnpm-large` | `sha256:54025b1660b21a1854eccb83a2e65364b30ffc8532592aeeaf17ca667e53ec12` |
| `berry-small` | `sha256:d43f45bc93868ed37d36e9decbe1f90c0fefd0c7483a5aacd31b956af8ee2daa` |
| `berry-large` | `sha256:885667c22f76c15b87b256f2380dca017c95bc290cb38497d52985ec1811eafd` |
| `lockgraph-small` | `sha256:f93befaddda0d97a996790ce450210024687715edbb9c44b1b07dd578a57c1f7` |
| `lockgraph-large` | `sha256:56d8f149ff67a4c21924beae20e45aaa28fe7a2c2ae2aaef524044ec85002038` |

A structural comparison against `71995cf` found no added or removed measured
keys and exactly two changed values per fixture:
`crossFormatAssessment.assessmentDigest` and
`crossFormatAssessment.digest`. Parse, stringify, same-format round-trip,
mutation, enrichment, and graph digests are unchanged. The measurement report
does not emit the assessment body or the literal axis value; it emits only
these derived digests, so searching the report for `ManifestKnowledge` cannot
explain the re-pin. Fresh `npm run measure:verify` runs on the complete current
tree reproduce all eight fixture/result digests successfully.

### Measurement META-normalization correction (2026-07-27)

Removing the false `lockgraph@0.0.0` generator version exposed a pre-existing
measurement defect: `graphText()` normalized `generatedAt` but still hashed the
non-identity `generator` provenance line into every `graphDigest`. The
measurement oracle now normalizes both META lines before hashing, per the
lockgraph determinism contract. This intentionally re-pins the baseline once;
graph digests are henceforth independent of timestamp and producing-tool
identity:

| Fixture | Current result digest |
| --- | --- |
| `npm-small` | `sha256:407dc51c6813b0a259ac1173ce4da0624e385fad8e9c743ef6817ffe46384eb1` |
| `npm-large` | `sha256:cad85f3a68f4a5d013ecf5c57e67845ccb8a93267b961c7db4ec72ea0de53faf` |
| `pnpm-small` | `sha256:d38617b4f40d05e227e37afc038a19a4e0cf2decf995b392a3bd140420ec2fe4` |
| `pnpm-large` | `sha256:0a51f58563c0dd081e21cfca68ca4a9d5afce6b837127c852e94913bccaf8f82` |
| `berry-small` | `sha256:2fc3a320a7b9b9f4b5b3467c6b9ef0f45967bebb16b6361906f4f63a81e1381f` |
| `berry-large` | `sha256:e62a8f15a512b0406d1779b191bdaf1ae4e396ecf31fcc950e5b328a27acc1d7` |
| `lockgraph-small` | `sha256:6efb4f2b9e9357be76b71d1b2a4f044fb5785ff8e7734f2baa7d2158e162f658` |
| `lockgraph-large` | `sha256:dd448aae41117b26fad6eb40506bd9b8e4d69645c89b1ea028fdac5165158f9d` |

## Consequences

- **Positive:** generic completion stays target-neutral and owns all registry
  resolution/minting.
- **Positive:** target-derived entries are explicit, receipted, deterministic,
  and round-trip-stable.
- **Positive:** source-derived dependencies do not leak into other package
  managers, while source parsing and Berry → Berry remain lossless.
- **Positive:** the same table expresses dependency-injecting/bare and
  non-injecting/hashed package families without algorithm branches.
- **Positive:** an unresolved transitive cannot produce a plausible but invalid
  patch pair.
- **Cost:** each supported PM-derived behaviour needs a narrow observed profile
  plus pinned native-oracle evidence, including the exact derived cache digest
  when the patch entry is hashed.
- **Deferred:** other builtin eras, hashes, package versions, and unpinned
  producers need separate evidence and ratification.
- **Deferred:** source-derived rows outside the measured 36 owner
  package/version pairs remain carried until independently proved.

## Alternatives considered

- *Teach completion to synthesize patches* — rejected because it violates
  ADR-0023 §4.2 and couples generic registry completion to one PM.
- *Drop `node-gyp` in the Berry parser* — rejected because the edge is present
  in source bytes and Berry → Berry must preserve it.
- *Drop every structural `node-gyp@latest` edge* — rejected because an author
  may declare the same edge; exact source provenance is required.
- *Retain the source-derived edge and report an imprecision diagnostic* —
  rejected because `latest` is a time-varying dist-tag. The resulting target
  lock would be non-reproducible by construction, not merely less precise.
- *Use reachability pruning for source-derived edges* — rejected because
  reachability answers a different question and would alter same-PM output.
- *Resolve/mint `node-gyp` inside the plugin* — rejected because it duplicates
  the resolver and closure algorithm.
- *Treat the six-hex Yarn hashes as `Node.patch`* — rejected because it breaks
  canonical identity and emit → parse stability.
- *Copy the fsevents bare-checksum rule to all builtin patches* — rejected by
  the pinned native `resolve` and `typescript` entries, which are hashed.
- *Derive patch checksum from registry SRI* — rejected because the two digests
  cover different artifacts.
- *Gate on lockfile version* — rejected by observed mixed-era locks.
- *Guess other package versions or unknown Yarn versions* — rejected; absence
  of pinned oracle evidence is not authority.
