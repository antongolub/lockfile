# lockfile
> Read and write lockfiles with reasonable losses

## Motivation
Each package manager brings its own philosophy of how to describe, store and control project dependencies.
It _seems_ acceptable for developers, but literally becomes a ~~pain in *** ***~~ headache for isec, devops and release engineers.
This lib is a naive attempt to build a pm-independent, generic, extensible and reliable deps representation.

The `package.json` manifest contains its own deps requirements, the `lockfile` holds the deps resolution snapshot<sup>*</sup>,
so both of them are required to build a dependency graph. We can try to convert this data into a normalized representation for further analysis and processing (for example, to fix vulnerabilities).
And then, if necessary, try convert it back to the original/other format.

## Status
⚠️ Initial draft. Alpha-version

## Getting started
### Install
```shell
yarn add @antongolub/lockfile
```

## Usage
```ts
import { parse, format, analyze } from '@antongolub/lockfile'

const snapshot = parse('yarn.lock <raw contents>', 'package.json <raw contents>', './packages/foo/package.json <raw contents>')

const lf = format(snapshot)
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
```

### Terms
* `nmtree` — fs projection of deps, directories structure
* `deptree` — bounds full dep paths with their resolved packages
* `depgraph` — describes how resolved pkgs are related with each other

### Lockfiles formats
| Package manager  | Meta format | Read | Write |
|------------------|-------------|------|-------|
| npm <7           | 1           | ✓    | ✓     |
| npm >=7          | 2           | ✓    |       |
| npm >=9          | 3           | ✓    |       | 
| yarn 1 (classic) | 1           | ✓    | ✓     |
| yarn 2 (berry)   | 5, 6, 7     | ✓    | ✓     |

### Reference protocols
| Type      | Supported |
|-----------|-----------|
| semver    | ✓         |
| npm       | ✓         |
| workspace |           |
| patch     |           |
| file      |           |
| github    |           |
| tag       |           |

https://yarnpkg.com/features/protocols

### `TSnapshot`
```ts
export type TSnapshot = Record<string, {
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
  source:     string
  sourceType: TSourceType

  // optional pm-specific lockfile meta
  manifest?: TManifest
  conditions?: string
  dependencies?: TDependencies
  dependenciesMeta?: TDependenciesMeta
  optionalDependencies?: TDependencies
  peerDependencies?: TDependencies
  peerDependenciesMeta?: TDependenciesMeta
  bin?: Record<string, string>
  engines?: Record<string, string>
  funding?: Record<string, string>
}>
```

### Caveats
* There is an infinite number of `nmtrees` that corresponds to the specified `deptree`, but among them there is a finite set of effective (sufficient) for the target criterion — for example, nesting, size, homogeneity of versions
* npm1: `optional: true` label is not supported by `format`
* yarn berry: no idea how to resolve and inject PnP patches https://github.com/yarnpkg/berry/tree/master/packages/plugin-compat
* npm2 and npm3 requires `engines` and `funding` data, while yarn* or npm1 does not contain it
* many `nmtree` projections may correspond the specified `depgraph`

### Inspired by
* [synp](https://github.com/imsnif/synp)
* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)

### License
[MIT](./LICENSE)
