# @antongolub/lockfile
> Read and write lockfiles with reasonable losses

<p><img alt="@antongolub/lockfile" src="./pics/pic.png" align="right" width="300">
Each package manager brings its own philosophy of how to describe, store and control project dependencies.
It <i>seems</i> acceptable for developers, but literally becomes a <strike>pain in *** ***</strike> headache for isec, devops and release engineers.
This lib is a naive attempt to build a pm-independent, generic, extensible and reliable deps representation.

The `package.json` manifest contains its own deps requirements, the `lockfile` holds the deps resolution snapshot<sup>*</sup>,
so both of them are required to build a dependency graph. We can try to convert this data into a normalized representation for further analysis and processing (for example, to fix vulnerabilities).
And then, if necessary, try convert it back to the original/another format.
</p>

## Status
Proof of concept. The API may change significantly ⚠️

## Getting started
### Install
```shell
yarn add @antongolub/lockfile@snapshot
```

## Usage
_tl;dr_
```ts
import fs from 'fs/promises'
import {parse, analyze} from '@antongolub/lockfile'

const lf = await fs.readFile('yarn.lock', 'utf-8')
const pkg = await fs.readFile('package.json', 'utf-8')

const snapshot = parse(lf, pkg) // Holds JSON-friendly TEntries[]
const idx = analyze(snapshot)   // An index to represent repo dep graphs

// idx.entries
// idx.prod
// idx.edges
```

## API
### JS/TS
```ts
import { parse, format, analyze, convert } from '@antongolub/lockfile'

const lf = await fs.readFile('yarn.lock', 'utf-8')
const pkgJson = await fs.readFile('package.json', 'utf-8')
const snapshot = parse(lf, pkgJson)

const lf1 = format(snapshot)
const lf2 = format(snapshot, 'npm-1')         // Throws err: npm v1 meta does not support workspaces

const meta = await readMeta()                 // reads local package.jsons data to gather required data like `engines`, `license`, `bins`, etc
const meta2 = await fetchMeta(snapshot)       // does the same, but from the remote registry
const lf3 = format(snapshot, 'npm-3', {meta}) // format with options

const idx = analyze(snapshot)
idx.edges
// [
//  [ '', '@antongolub/npm-test@4.0.1' ],
//  [ '@antongolub/npm-test@4.0.1', '@antongolub/npm-test@3.0.1' ],
//  [ '@antongolub/npm-test@3.0.1', '@antongolub/npm-test@2.0.1' ],
//  [ '@antongolub/npm-test@2.0.1', '@antongolub/npm-test@1.0.0' ]
// ]

const lf4 = await convert(lf, pkgJson, 'yarn-berry')
```

### CLI
```shell
npx @antongolub/lockfile@snapshot <cmd> [options]

npx @antongolub/lockfile@snapshot parse --input=yarn.lock,package.json --output=snapshot.json
npx @antongolub/lockfile@snapshot format --input=snapshot.json --output=yarn.lock
```

| Command / Option | Description                                                                           |
|------------------|---------------------------------------------------------------------------------------|
| `parse`          | Parses lockfiles and package manifests into a snapshot                                |
| `format`         | Formats a snapshot into a lockfile                                                    |
| `convert`        | Converts a lockfile into another format. Shortcut for `parse` + `format`              |
| `--input`        | A comma-separated list of files to parse: `snapshot.json` or `yarn.lock,package.json` |
| `--output`       | A file to write the result to: `snapshot.json` or `yarn.lock`                         |
| `--format`       | A lockfile format: `npm-1`, `npm-2`, `npm-3`, `yarn-berry`, `yarn-classic`            |

### Terms
`nmtree` — fs projection of deps, directories structure  
`deptree` — bounds full dep paths with their resolved packages  
`depgraph` — describes how resolved pkgs are related with each other

### Lockfiles types
| Package manager      | Meta format | Read | Write |
|----------------------|-------------|------|-------|
| npm <7               | 1           | ✓    | ✓     |
| npm >=7              | 2           | ✓    |       |
| npm >=9              | 3           | ✓    |       | 
| yarn 1 (classic)     | 1           | ✓    | ✓     |
| yarn 2, 3, 4 (berry) | 5, 6, 7     | ✓    | ✓     |

### Dependency protocols
| Type      | Supported | Example                                 | Description                                                    |
|-----------|-----------|-----------------------------------------|----------------------------------------------------------------|
| semver    | ✓         | `^1.2.3`                                | Resolves from the default registry                             |
| tag       |           | `latest`                                | Resolves from the default registry                             |
| npm       | ✓         | `npm:name@...`                          | Resolves from the npm registry                                 |
| git       |           | `git@github.com:foo/bar.git`            | Downloads a public package from a Git repository               |
| github    |           | `github:foo/bar`                        | Downloads a public package from GitHub                         |
| github    | ✓         | `foo/bar`                               | Alias for the github: protocol                                 |
| file      |           | `file:./my-package`                     | Copies the target location into the cache                      |
| link      |           | `link:./my-folder`                      | Creates a link to the ./my-folder folder (ignore dependencies) |
| patch     | _limited_ | `patch:left-pad@1.0.0#./my-patch.patch` | Creates a patched copy of the original package                 |
| portal    |           | `portal:./my-folder`                    | Creates a link to the ./my-folder folder (follow dependencies) |
| workspace | _limited_ | `workspace:*`                           | Creates a link to a package in another workspace               |

https://v3.yarnpkg.com/features/protocols  
https://yarnpkg.com/protocols  
https://docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies

### `TSnapshot`
```ts
export type TSnapshot = Record<string, TEntry>

export type TEntry = {
  name:       string
  version:    string
  ranges:     string[]
  hashes:     {
    sha512?:  string
    sha256?:  string
    sha1?:    string
    checksum?: string
    md5?:     string
  }
  source:     {
    type:     TSourceType // npm, workspace, gh, patch, etc
    id:       string
    registry?: string
  }
  // optional pm-specific lockfile meta
  manifest?:              TManifest
  conditions?:            string
  dependencies?:          TDependencies
  dependenciesMeta?:      TDependenciesMeta
  devDependencies?:       TDependencies
  optionalDependencies?:  TDependencies
  peerDependencies?:      TDependencies
  peerDependenciesMeta?:  TDependenciesMeta
  bin?:                   Record<string, string>
  engines?:               Record<string, string>
  funding?:               Record<string, string>
}
```

### `TSnapshotIndex`
```ts
export interface TSnapshotIndex {
  snapshot: TSnapshot
  entries:  TEntry[]
  roots:    TEntry[]
  edges:    [string, string][]
  tree:       Record<string, {
    key:      string
    chunks:   string[]
    parents:  TEntry[]
    id:       string
    name:     string
    version:  string
    entry:    TEntry
    depth:    number // the lowest level where the dep@ver first time occurs
  }>
  prod: Set<TEntry>
  getEntryId ({name, version}: TEntry): string
  getEntry (name: string, version?: string): TEntry | undefined,
  getEntryByRange (name: string, range: string): TEntry | undefined
  getEntryDeps(entry: TEntry): TEntry[]
}
```

### Caveats
* There is an infinite number of `nmtrees` that corresponds to the specified `deptree`, but among them there is a finite set of effective (sufficient) for the target criterion — for example, nesting, size, homogeneity of versions
* npm1: `optional: true` label is not supported yet
* yarn berry: no idea how to resolve and inject PnP patches https://github.com/yarnpkg/berry/tree/master/packages/plugin-compat
* npm2 and npm3 requires `engines` and `funding` data, while yarn* or npm1 does not contain it
* many `nmtree` projections may correspond to the specified `depgraph`
* pkg.json `resolutions` and `overrides` directives are completely ignored for now
* pkg aliases are not _fully_ supported yet [#2](https://github.com/antongolub/lockfile/issues/2#issuecomment-1786613893)

### Snippets
Extracts all deps by depth:
```ts
const getDepsByDepth = (idx: TSnapshotIndex, depth = 0) => Object.values(idx.tree)
  .filter(({depth: d}) => d === depth)
  .map(({entry}) => entry)
```

Get the longest dep chain:
```ts
const getLongestChain = (): TEntry[] => {
  let max = 0
  let chain: TEntry[] = []

  for (const e of Object.values(idx.tree)) {
    if (e.depth > max) {
      max = e.depth
      chain = [...e.parents, e.entry]
    }
  }
  return chain
}

constole.log(
  getLongestChain()
    .map((e) => idx.getEntryId(e))
    .join(' -> ')
)
```

### Inspired by
* [synp](https://github.com/imsnif/synp)
* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)
* [yarn](https://github.com/yarnpkg/yarn/blob/master/src/lockfile/parse.js)
* [yarn-lockfile](https://github.com/yarnpkg/yarn/tree/master/packages/lockfile)

### Refs
* [yarn.lock](https://classic.yarnpkg.com/en/docs/yarn-lock/)
* [package-lock-json](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json)
* [what-is-package-lock-json](https://snyk.io/blog/what-is-package-lock-json/)
* [the-ultimate-guide-to-yarn-lock-lockfiles](https://www.arahansen.com/the-ultimate-guide-to-yarn-lock-lockfiles/)
* [package-lock-json-the-complete-guide](https://medium.com/helpshift-engineering/package-lock-json-the-complete-guide-2ae40175ebdd)
<details>
  <summary>more</summary>

* [cvent/pnpm-lock-export](https://github.com/cvent/pnpm-lock-export)
* [why-keep-package-lockjson](https://blog.npmjs.org/post/621733939456933888/npm-v7-series-why-keep-package-lockjson.html)
* [pnpm/lockfile-utils](https://github.com/pnpm/pnpm/tree/main/lockfile/lockfile-utils)
</details>

## License
[MIT](./LICENSE)
