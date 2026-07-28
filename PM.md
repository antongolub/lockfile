# PM — the JavaScript package manager reference

Every JavaScript package manager we know of: what it is for, whether it writes a
lockfile of its own, and whether lockgraph reads that format.

Several widely used tools are commonly called package managers and are not one.
They are listed here too, in their own sections, because knowing what a tool
*does not* produce is as useful as knowing what it does.

Measured 2026-07-28. Adoption figures move; the lockfile column does not.

## 0. How to read the tables

| column | meaning |
|---|---|
| **Lockfile** | the file the tool writes itself; `delegates` means it drives another manager and that manager's lockfile is what lands on disk |
| **lockgraph** | whether this repository parses and emits that format |

A tool with no lockfile of its own cannot be a conversion source or target, no
matter how widely it is used.

---

## 1. Primary package managers

The five that resolve, fetch, link and lock on their own, and between them
account for effectively all public JavaScript projects.

| Tool | Purpose | Lockfile | lockgraph |
|---|---|---|---|
| [npm](https://github.com/npm/cli) | The default manager, bundled with Node.js. Reference implementation of the registry protocol. | `package-lock.json` (v1–v4), `npm-shrinkwrap.json` | yes — `npm-1` … `npm-4` |
| [Yarn](https://github.com/yarnpkg/yarn) (Classic, 1.x) | The first credible npm alternative: deterministic installs, offline mirror, workspaces. Maintenance only. | `yarn.lock` (v1 syntax) | yes — `yarn-classic` |
| [Yarn Berry](https://github.com/yarnpkg/berry) (2.x–4.x) | Rewrite around Plug'n'Play: no `node_modules`, packages resolved from zip archives. | `yarn.lock` (YAML, `__metadata.version` 4–10) | yes — `yarn-berry-v4` … `v10` |
| [pnpm](https://github.com/pnpm/pnpm) | Content-addressable store plus a symlinked `node_modules`: strict dependency isolation and disk reuse. | `pnpm-lock.yaml` (v5, v6, v9) | yes — `pnpm-v5`, `pnpm-v6`, `pnpm-v9` |
| [Bun](https://github.com/oven-sh/bun) | Runtime with a built-in installer; speed-first, npm-registry compatible. | `bun.lock` (text), `bun.lockb` (binary, superseded) | text yes — `bun-text`; binary detect-only |
| [Deno](https://github.com/denoland/deno) | Runtime with an integrated manager spanning three sources: npm packages, JSR modules and remote URLs. | `deno.lock` (v2–v5) | yes — `deno`, same-format npm-section only |

## 2. Active alternatives that write their own lockfile

| Tool | Purpose | Lockfile | Note |
|---|---|---|---|
| [nub](https://github.com/nubjs/nub) | Rust installer, runtime and version manager in one binary. | `nub.lock` | **pnpm v9 schema under a different filename** |
| [aube](https://github.com/jdx/aube) | Rust installer; the engine nub embeds. | `aube-lock.yaml` | declares `lockfileVersion: '9.0'` — pnpm v9 |
| [vlt](https://github.com/vltpkg/vltpkg) | Installer by npm's original author. Release candidate, not yet 1.0. | `vlt-lock.json` | a genuine graph format: `nodes` + `edges`, ids carry peer variants |
| [cotton](https://github.com/danielhuang/cotton) | Rust installer focused on install speed. | `cotton.lock` | flat JSON, specifier → resolved version |
| [ohpm](https://ohpm.openharmony.cn/) | Package manager for Huawei OpenHarmony / HarmonyOS applications. Ships inside DevEco Studio. | `oh-package-lock.json5` | JSON5; npm-style `sha512` SRI integrity; pnpm-like store layout; `registryType` may be `ohpm` **or** `npm` |
| [hpm](https://www.npmjs.com/package/@ohos/hpm-cli) | OpenHarmony **device component** distribution, not application libraries. | `bundle-lock.json` | published, very low usage |
| [jspm](https://github.com/jspm/jspm) | Import-map package manager: the browser import map *is* the lock. | `importmap.js` | earlier lines used `config.js`, `jspm.config.js`, `jspm.json` |
| [Orogene](https://github.com/orogene/orogene) | Rust installer for `node_modules`-consuming tools. | `package-lock.kdl` | **source closed February 2026**; last open release 0.3.34 (2023-10-09) |

Two consequences of this section for tooling authors:

- **A filename or a `packageManager` field no longer implies a format.** `nub.lock`
  and `aube-lock.yaml` are pnpm v9 content. Detection must read the file.
- Both nub and aube also read *and write* npm, pnpm, bun and Yarn lockfiles in
  place, so a lockfile's own name does not identify the tool that last wrote it.

## 3. Wrappers, proxies and shims

These install nothing themselves. They select, forward to, or pin another
manager.

| Tool | Purpose | Lockfile |
|---|---|---|
| [ni](https://github.com/antfu-collective/ni) | Detects which manager a repository uses from its lockfile and forwards the command. Published as `@antfu/ni`. | none |
| [nypm](https://github.com/unjs/nypm) | Programmatic abstraction over the managers, for tools that must install on a user's behalf. | none |
| [Corepack](https://github.com/nodejs/corepack) | Pins a manager version via the `packageManager` field. Bundled with Node 14.19–24, removed in Node 25+. | none |
| [Volta](https://github.com/volta-cli/volta) | Toolchain version manager; pins Node and manager versions per project. **Unmaintained**, per its own README. | none |
| [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), [asdf](https://github.com/asdf-vm/asdf), [mise](https://github.com/jdx/mise), [proto](https://github.com/moonrepo/proto) | Runtime version managers. `mise.lock` and `.protolock` lock **tool versions, not packages**. | not a package lock |

## 4. Orchestrators — commonly called package managers, but not

These coordinate tasks, versioning or publishing across a monorepo. None
resolves or fetches packages; each drives a primary manager underneath.

| Tool | Purpose | Lockfile |
|---|---|---|
| [Turborepo](https://github.com/vercel/turborepo) | Task runner and build cache. Parses lockfiles; `turbo prune` re-emits the manager's own format. | delegates |
| [Nx](https://github.com/nrwl/nx) | Task runner, generators, project graph. Prunes and re-serialises into the manager's format. | delegates |
| [Lerna](https://github.com/lerna/lerna) | Monorepo versioning and publishing. Shells out for installs. | delegates |
| [Rush](https://github.com/microsoft/rushstack) | Install and build orchestration for large monorepos; drives pnpm. | pnpm's format, relocated to `common/config/rush/pnpm-lock.yaml`, plus `repo-state.json` holding only hashes |
| [moon](https://github.com/moonrepo/moon) | Task runner and toolchain manager. `.moon/cache/*.lock` are process mutexes. | delegates |
| [Bit](https://github.com/teambit/bit) | Component development and distribution; embeds pnpm. | writes `pnpm-lock.yaml` **plus a non-standard top-level `bit:` key** |

## 5. Reproducible-build generators

These translate a JavaScript dependency graph into another build system's
description. Historically they transcoded the lockfile; current practice is to
consume the lockfile as-is.

| Tool | Purpose | Output |
|---|---|---|
| [node2nix](https://github.com/svanderburg/node2nix) | Generates Nix expressions from npm dependencies. Removed from nixpkgs. | `node-packages.nix` — full resolved graph with hashes |
| [dream2nix](https://github.com/nix-community/dream2nix) | Framework for building language ecosystems with Nix. | `lock.json` (formerly `dream-lock.json`) |
| [npmlock2nix](https://github.com/nix-community/npmlock2nix) | Builds Nix derivations directly from an npm lockfile. | consumes `package-lock.json` |
| nixpkgs `buildNpmPackage` | Mainstream Nix builder for npm projects. | consumes `package-lock.json` plus one aggregate `npmDepsHash` |
| [rules_js](https://github.com/aspect-build/rules_js) | Bazel rules for JavaScript. | **reuses `pnpm-lock.yaml` as its intermediate representation** |
| [rules_nodejs](https://github.com/bazel-contrib/rules_nodejs) | Bazel Node.js toolchain. npm rules removed in 6.x. | none |

## 6. Registries and mirrors

Not package managers, but part of the same picture: a manager without a registry
resolves nothing.

| Service | Purpose |
|---|---|
| [registry.npmjs.org](https://registry.npmjs.org/) | The primary public registry. |
| [npmmirror](https://npmmirror.com/) / [cnpmcore](https://github.com/cnpm/cnpmcore) | Full mirror of the public registry serving the Chinese ecosystem. |
| [cnpm](https://github.com/cnpm/cnpm) | CLI front-end bundling npm and npminstall, defaulting to npmmirror. Delegates; writes no lockfile. |
| [npminstall](https://github.com/cnpm/npminstall) | The installer engine behind cnpm; symlink store. Reads `package-lock.json` when given one; writes none. |
| [JSR](https://jsr.io/) | Registry for JavaScript and TypeScript modules, used by Deno and consumable from npm via `@jsr/` scope mapping. |
| [Verdaccio](https://github.com/verdaccio/verdaccio) | Self-hosted proxy registry. |

## 7. Discontinued

Kept for identification: these formats still appear in old repositories.

| Tool | Years | Purpose | Lockfile |
|---|---|---|---|
| [Bower](https://github.com/bower/bower) | 2012–2017 | Front-end packages with a flat, single-version graph; the registry mapped names to git URLs and hosted nothing. Frozen, not deprecated; the registry still serves. | **none, ever** — six attempts, none merged. `resolutions` in `bower.json` recorded conflict choices |
| [ied](https://github.com/alexanderGugel/ied) | 2015–2016 | Content-addressable `node_modules`, flat layout, symlinked names, parallel installs. | none shipped — an unmerged `dependencies-lock.yaml` spec exists |
| [tink](https://github.com/npm/tink) | 2018–2019 | npm's own experiment: no `node_modules` at all, packages loaded from a central cache through an `fs` override. Never completed. | `.package-map.json` |
| [Entropic](https://github.com/entropic-dev/entropic) | 2019–2020 | A federated registry with file-level deduplication, treating npm as a read-only archive. A registry, not a manager. | n/a |
| [Component](https://github.com/componentjs/component) | 2012–2015 | Package manager and build tool in one, using GitHub as the registry. | none — `component pin` rewrote the manifest |
| [Duo](https://github.com/duojs/duo) | 2014–2016 | Dependencies declared inline in source, fetched from GitHub. | `components/duo.json`, a build cache rather than a committed lock |
| [volo](https://github.com/volojs/volo) | 2012–2016 | AMD-first dependency fetcher and project scaffolder; closer to a command runner than a manager. | none |
| [Ender](https://github.com/ender-js/Ender) | 2011–2015 | Assembled a custom browser library from small modules; used npm underneath for resolution. | none — the built file recorded its own build command |
| [Jam](https://github.com/caolan/jam) | 2012–2013 | Browser packages usable via RequireJS with no build step. | none |
| [spm](https://github.com/spmjs/spm) | 2011–2018 | Static package manager for the SeaJS/CMD ecosystem. Directs users to npm. | none |
| [npmd](https://github.com/dominictarr/npmd) | 2013–2015 | Offline-first npm client using local database replication. | none |
| [bpm](https://github.com/bpm/bpm) | 2011 | Pre-Bower browser package manager, written in Ruby on rubygems. | none |
| [Narwhal](https://github.com/280north/narwhal), [cpm](https://github.com/kriszyp/cpm) | 2009–2014 | The pre-npm CommonJS generation. | none |

## 8. Notes

**The lockfile is what survived.** Of the discontinued tools above, only tink and
Duo produced anything lock-shaped, and neither was a committed reproducibility
record. Bower's maintainer named the absence of a lockfile as the reason to
migrate away from it.

**Ideas outlived their tools.** ied's content-addressable store, symlinked names
and parallel fetch are pnpm's design; the `dependencies-lock.yaml` spec written
in ied's repository shipped as `pnpm-lock.yaml`. tink's `node_modules`-free
loading is the thesis of Yarn Plug'n'Play and pnpm's virtual store. Bower's
`resolutions` is the ancestor of Yarn `resolutions` and npm `overrides`.

**Two bets that lost.** GitHub as the primary registry (Bower, Component, Duo,
volo) failed on API rate limits and ecosystem gravity. Integrating the installer
with the bundler (Component, Duo) was rejected by the ecosystem, which settled on
separate tools for installing and building.

**Formats are converging, not multiplying.** The most recent entrants — nub and
aube — adopted pnpm v9 rather than defining a format, and rules_js adopted
`pnpm-lock.yaml` as its intermediate representation. The generation that
transcoded lockfiles into a new syntax (node2nix, yarn2nix) has been retired.
