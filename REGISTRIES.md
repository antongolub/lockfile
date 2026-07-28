# REGISTRIES — the npm-protocol registry reference

Where package managers fetch from. A manager without a registry resolves
nothing, and the registry — not the installer — is where authentication, scoping
and supply-chain policy actually live.

Grouped by what a service **is**, not by who runs it. The distinction that
matters operationally is the middle group: a mirror and a proxy behave
differently on cache miss, on publish, and on a package that upstream has
unpublished.

Per-service HTTP contracts, authentication schemes and quirks live in
[`spec/registry/`](spec/registry/). This document is the index; those are the
specifications.

Which manager defaults to which registry is recorded in the manager tables in
[PM.md](PM.md).

## 1. Public registries

Origin servers. They host packages; nothing sits behind them.

| Service | Purpose | Spec |
|---|---|---|
| [registry.npmjs.org](https://registry.npmjs.org/) | The primary public registry, operated by npm/GitHub. Its HTTP surface is the de facto protocol every other entry here implements. | [`npm.md`](spec/registry/npm.md) |
| [registry.yarnpkg.com](https://registry.yarnpkg.com/) | Yarn's maintained default endpoint. Serves the same content as npmjs; a distinct host, not a distinct catalogue. | [`yarn-mirror.md`](spec/registry/yarn-mirror.md) |
| [jsr.io](https://jsr.io/) | Registry for JavaScript and TypeScript modules, used natively by Deno and consumable from the npm protocol through `npm.jsr.io` with `@jsr/` scope mapping. | [`jsr.md`](spec/registry/jsr.md) |

## 2. Mirrors

A mirror **replicates** an upstream catalogue ahead of demand. Packages are
present before anyone asks for them, and the mirror serves independently of
upstream availability.

| Service | Purpose | Spec |
|---|---|---|
| [npmmirror](https://npmmirror.com/) / [cnpmcore](https://github.com/cnpm/cnpmcore) | Full replica of the public registry serving the Chinese ecosystem; `sync_model: all`. The software behind it is open and self-hostable. | [`npmmirror.md`](spec/registry/npmmirror.md) |
| [mirrors.cloud.tencent.com/npm](https://mirrors.cloud.tencent.com/npm/) | Public read-only mirror. Consumed by pointing a stock manager at it; no client of its own. | — |

## 3. Self-hosted and proxy registries

A proxy **caches on demand**: it fetches from upstream on first request, then
serves from cache. Most also host private packages alongside the proxied public
ones, which is the usual reason to run one.

| Service | Purpose | Spec |
|---|---|---|
| [Verdaccio](https://github.com/verdaccio/verdaccio) | Lightweight self-hosted proxy and private registry; the common choice for a single team or an air-gapped build. | [`verdaccio.md`](spec/registry/verdaccio.md) |
| [Sonatype Nexus Repository](https://github.com/sonatype/nexus-public) | Multi-format artifact repository (npm, Maven, PyPI, Docker …) with npm hosted, proxy and group repositories. | [`nexus.md`](spec/registry/nexus.md) |
| [JFrog Artifactory](https://jfrog.com/artifactory/) | Multi-format artifact repository with npm local, remote and virtual repositories. Comparable role to Nexus; different auth and URL layout. | [`artifactory.md`](spec/registry/artifactory.md) |
| [GitHub Packages](https://docs.github.com/en/packages) | npm registry at `npm.pkg.github.com`, scoped to a GitHub organisation and authenticated with a GitHub token. | [`github-packages.md`](spec/registry/github-packages.md) |
| [GitLab Package Registry](https://docs.gitlab.com/ee/user/packages/npm_registry/) | npm registry bound to a GitLab project or group. | [`gitlab.md`](spec/registry/gitlab.md) |
| [Gitea](https://docs.gitea.com/usage/packages/npm) | npm package registry built into the Gitea forge. | — |
| [Cloudsmith](https://cloudsmith.com/product/formats/npm-registry) | Hosted multi-format package registry with npm support. | — |
| [Google Artifact Registry](https://cloud.google.com/artifact-registry/docs/nodejs), [AWS CodeArtifact](https://docs.aws.amazon.com/codeartifact/), [Azure Artifacts](https://learn.microsoft.com/en-us/azure/devops/artifacts/) | Cloud-provider registries. All three speak the npm protocol; each has its own token-exchange flow rather than a static token. | [`cloud-registries.md`](spec/registry/cloud-registries.md) |

## 4. Non-npm-protocol registries

These serve managers listed in [PM.md](PM.md) but do not implement the npm HTTP
contract, so npm-family tooling cannot read them directly.

| Service | Purpose |
|---|---|
| [ohpm](https://ohpm.openharmony.cn/) | Registry for Huawei OpenHarmony packages, distributing `.har` archives. `ohpm-repo` is separately downloadable for self-hosting. |
| [Deno remote modules](https://docs.deno.com/runtime/fundamentals/modules/) | Not a registry: Deno resolves `https:` imports directly from their origin and records each module's digest in `deno.lock`. |

## 5. Why the distinction matters

**Mirror versus proxy is an availability property.** A mirror has the package
before you ask; a proxy fetches it when you ask and fails if upstream is down
and the cache is cold. A build that must survive an upstream outage needs the
first.

**A private registry changes what a lockfile means.** `resolved` URLs point at
the private host, so a lockfile produced behind Nexus or Artifactory does not
install on a machine without access to it — even though every package in it may
be public. This is the single most common reason a valid lockfile fails to
install elsewhere.

**Integrity is not authenticity.** Every service here serves the `integrity`
hash recorded at publish time. That proves the bytes did not change in transit;
it does not prove the publisher was who you think. Provenance attestations are a
separate mechanism and are not implied by a matching hash.

**Scoped registry configuration is per-scope, not per-project.** `@scope:registry`
in `.npmrc` routes one scope elsewhere while the rest resolve publicly, which is
how private and public packages coexist in one lockfile — and why a lockfile can
reference two hosts at once.
