# lockfile
Read, write, and convert npm (v1, v2) and yarn (classic and berry) lockfiles in any directions with reasonable losses.

### Motivation
Every package manager brings its own philosophy of how to describe, store and control projects dependencies.
This is awesome for developers, but literally becomes a ~~pain in *** ***~~ headache for isec, devops and release engineers.
This lib is a naive attempt to build a pm-independent, generic, extensible and reliable deps representation.

### Getting started
#### Install
```shell
yarn add @antongolub/lockfile
```

#### Usage
```js
import { parse, format } from '@antongolub/lockfile'

const parsed = parse({
  lockfile: './yarn.lock',
  pkg: './package.json'
})

// output
{
  entries: {
    '@babel/code-frame@7.10.4': {
      name: '@babel/code-frame',
      version: '7.10.4',
      scope: 'prod/dev/peer/opt',
      integrities: {
        sha512: 'hashsum',
        sha256: '...',
        sha1: '...',
        md5: '...'
      },
      reference: {
        sourceType: 'npm/git/file/workspace'
        source: 'uri://remote/address',
        linkType: 'hard/soft',
        link: '<root>path/to/package'
      },
      dependencies: {
        '@babel/highlight': '^7.10.4'
      }
    },
    ...
  },
  meta: {
    lockfile: {
      type: 'yarn',
      version: '5', // metadata format version
    },
    packageJson: {...},
    workspaces: {
      patterns: ['./packages/*'],
      packages: {
        '@qiwi/pijma-core': '<root>/packages/core/package.json'
      }
    }
  },
}

const data = format({
  ...parsed,
  lockfileType: 'yarn-2'
})
// output
`
# This file is generated by running "yarn install" inside your project.
# Manual changes might be lost - proceed with caution!

__metadata:
  version: 5
  cacheKey: 8

"@babel/code-frame@npm:7.10.4":
  version: 7.10.4
  resolution: "@babel/code-frame@npm:7.10.4"
...
`
```

### Lockfile (meta) versions
| Package manager  | Meta format |
|------------------|-------------|
| npm <7           | 1           |
| npm >=7          | 2           |
| yarn 1 (classic) | 1           |
| yarn 3           | 5, 6        |
| yarn 4           | 6, 7        |

### Inspired by
* [synp](https://github.com/imsnif/synp)
* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)

### License
[MIT](./LICENSE)
