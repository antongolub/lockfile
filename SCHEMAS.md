# Lockfile schemas

Public reference for every lockfile schema this project recognises:
how to identify each, which package-manager versions emit it by
default, and which can install from it. Adapter ids match the
`FormatId` literal accepted by `parse({ format })` and required by
`stringify({ format })`.

## npm

| Adapter id | Marker | Default writer | Reader |
|------------|--------|----------------|--------|
| `npm-1`    | `lockfileVersion: 1` | npm `>=5 <7` | npm `>=5` |
| `npm-2`    | `lockfileVersion: 2` | npm `>=7 <9` | npm `>=7` |
| `npm-3`    | `lockfileVersion: 3` | npm `>=9` (default unless v4 features are active) | npm `>=7` |
| `npm-4`    | `lockfileVersion: 4` | npm `>=12` (patch / extension features) | npm `>=12` |

`npm install --lockfile-version=N` overrides the writer choice within
the supported range. npm 12 still writes v3 for an ordinary project; native
`npm patch`, `packageExtensions`, or `.npm-extension` state activates v4.
npm 11 can accept a v4-shaped file without a syntax error but does not apply
its patch semantics, so it is not a compatible v4 reader.

## yarn

`yarn-classic` and `yarn-berry-*` use different lockfile schemas. The
"v" suffix on berry adapters is `__metadata.version`. Yarn classic
uses a `# yarn lockfile v1` *comment header* instead — unrelated to
berry's `__metadata`.

| Adapter id        | Marker                       | Default writer       | Reader  |
|-------------------|------------------------------|----------------------|---------|
| `yarn-classic`    | `# yarn lockfile v1` header  | yarn `>=1 <2`        | yarn `>=1 <2` (native); yarn `>=2` via `yarn import` |
| `yarn-berry-v3`   | `__metadata.version: 3`      | yarn `>=2.0.0-rc.4 <2.0.0-rc.20` (pre-release only) | yarn `>=2` |
| `yarn-berry-v4`   | `__metadata.version: 4`      | yarn `>=2.0.0-rc.20 <3.1` | yarn `>=2` |
| `yarn-berry-v5`   | `__metadata.version: 5`      | yarn `=3.1.0` (one minor) | yarn `>=3.1` |
| `yarn-berry-v6`   | `__metadata.version: 6`      | yarn `>=3.2 <4`      | yarn `>=3.2` |
| `yarn-berry-v8`   | `__metadata.version: 8`      | yarn `>=4.0 <4.14`   | yarn `>=4` |
| `yarn-berry-v9`   | `__metadata.version: 9`      | yarn `>=4.14`        | yarn `>=4.14` |
| `yarn-berry-v10`  | `__metadata.version: 10`     | yarn `>=4.17.1`      | yarn `>=4.17.1` |

**Schema numbers that don't exist:**
- `__metadata.version: 1` and `2` were never used by berry.
- `__metadata.version: 7` was skipped — yarn went `6 → 8` in 4.0.0.

`YARN_LOCKFILE_VERSION_OVERRIDE` (yarn 4+) lets one binary write any
schema version it can read; structural fidelity to the canonical
writer is not guaranteed.

## pnpm

| Adapter id | Marker                   | Default writer       |
|------------|--------------------------|----------------------|
| `pnpm-v5`  | `lockfileVersion: 5.x`   | pnpm `>=3 <8`  (pnpm 7 stayed on `5.4` by default) |
| `pnpm-v6`  | `lockfileVersion: '6.0'`/`'6.1'` | pnpm `>=8 <9` |
| `pnpm-v9`  | `lockfileVersion: '9.0'` | pnpm `>=9`           |

**Schema numbers that don't exist:** `7` and `8`. pnpm 9 jumped
straight from `6.x` to `9.0`.

## bun

| Adapter id    | Marker                          | Default writer | Status |
|---------------|---------------------------------|----------------|--------|
| `bun-text`    | `bun.lock` filename + JSONC     | bun `>=1.2`    | primary bun target |
| `bun-binary`  | `bun.lockb` filename + magic    | bun `<1.2`     | detect-only — not parsed |

`bun-binary` is a **permanent non-goal**: when `parse()` detects
`bun.lockb` magic bytes it throws with a hint to migrate via bun's
own tooling (`bun install --save-text-lockfile`). The library handles
the resulting `bun.lock` via the `bun-text` adapter. bun's own
binary reader stays in bun for back-compat — that is bun's
responsibility, not ours.

`bun-text` currently accepts only `lockfileVersion: 1`. Released early v0 text
locks fail closed; an unreleased Rust-rewrite v2 is queued as a distinct future
schema and is not detected as v1.

## Sources

Where each schema is canonically defined. Permalinks pinned at specific
release tags / commits so claims here stay anchored.

### npm

- [npm v7 series — beta release & semver-major changes](https://blog.npmjs.org/post/626173315965468672/npm-v7-series-beta-release-and-semver-major.html)
  — introduces `lockfileVersion: 2` (`packages` block, workspaces).
- [package-lock.json docs (npm v9)](https://docs.npmjs.com/cli/v9/configuring-npm/package-lock-json/)
  — schema reference for v3.
- [GitHub: dependency-graph and Dependabot support npm v9](https://github.blog/changelog/2023-03-10-dependency-graph-and-dependabot-support-npm-v9/)
  — confirms v3 drops the legacy `dependencies` mirror.
- npm 12.0.1 native-output corpus — v4 `patched`,
  `packageExtensionsHash` / `packageExtensionsApplied`, and
  `npmExtensionHash` / `npmExtensionApplied` carriers. npm has not yet
  published a standalone v4 schema document; see
  [`spec/formats/npm-4.md`](./spec/formats/npm-4.md) for the pinned empirical
  contract.

### yarn

- [`Project.ts` at @yarnpkg/cli/2.4.3](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/2.4.3/packages/yarnpkg-core/sources/Project.ts)
  — `LOCKFILE_VERSION = 4`.
- [`Project.ts` at @yarnpkg/cli/3.1.0](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/3.1.0/packages/yarnpkg-core/sources/Project.ts)
  — `LOCKFILE_VERSION = 5` (one-minor window).
- [`Project.ts` at @yarnpkg/cli/3.2.0](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/3.2.0/packages/yarnpkg-core/sources/Project.ts)
  — `LOCKFILE_VERSION = 6`.
- [`Project.ts` at @yarnpkg/cli/4.0.0](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/4.0.0/packages/yarnpkg-core/sources/Project.ts)
  — bumps to 8; `YARN_LOCKFILE_VERSION_OVERRIDE` env var introduced here.
- [`Project.ts` at @yarnpkg/cli/4.14.1](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/4.14.1/packages/yarnpkg-core/sources/Project.ts)
  — v9 baseline.
- [`Project.ts` at @yarnpkg/cli/4.17.1](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/4.17.1/packages/yarnpkg-core/sources/Project.ts)
  — stable `LOCKFILE_VERSION = 10`.
- [Yarn 4.0 release blog](https://yarnpkg.com/blog/release/4.0)
  — narrative context (no explicit lockfile-bump mention).

### pnpm

- [`pnpm/spec` — lockfile/](https://github.com/pnpm/spec/tree/master/lockfile)
  — official per-version schema docs (`5.md`, `5.2.md`, `6.0.md`, `9.0.md`).
- [`pnpm/spec/lockfile/6.0.md`](https://github.com/pnpm/spec/blob/master/lockfile/6.0.md)
  — pnpm 8's schema, including the package-id grammar shift.
- [`pnpm/spec/lockfile/9.0.md`](https://github.com/pnpm/spec/blob/master/lockfile/9.0.md)
  — pnpm 9's `packages` / `snapshots` split.
- [pnpm Discussion #6857](https://github.com/orgs/pnpm/discussions/6857)
  — maintainer rationale for the `6 → 9` jump:
  *"in the future lockfile version will equal the pnpm version in
  which it got introduced."*

### bun

- [Bun docs — Lockfile](https://bun.com/docs/pm/lockfile)
  — current schema reference for `bun.lock`.
- [Bun blog — text-based lockfile](https://bun.com/blog/bun-lock-text-lockfile)
  — text format introduced in 1.1.39, default in 1.2.
- [`bun-lock` source](https://github.com/oven-sh/bun) — `src/install/lockfile.zig`
  for the binary serializer.
