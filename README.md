# lockfile
Read, write, and convert npm (v1, v2) and yarn (classic and berry) lockfiles in any directions with reasonable losses.

### Motivation
Every package manager brings its own philosophy on how to describe, store and control projects dependencies.
It's awesome for developers, but literally becomes a pain in *** *** for isec, devops and release engineers.
Let's try to build a pm-independent, universal, extensible and reliable dependency representation.

### Getting started
#### Install
```shell
yarn add @antongolub/lockfile
```

#### Usage
```js
import { parse } from '@antongolub/lockfile'

const deps = parse({
  lockfile: './yarn.lock',
  pkg: './package.json'
})

// output
{
  map: {
    '@babel/code-frame@npm:7.10.4': {
      version: '7.10.4',
      scope: 'prod/dev/peer/opt',
      integrity: {
        sha512: 'hashsum',
        sha256: '...',
        sha1: '...',
        checksum: '...'
      },
      resolved: {
        sourceType: 'npm/git/file/https/workspace'
        link: '<root>path/to/package',
        linkType: 'hard/soft',
        remoteUri: 'uri://remote/address',
      },
      dependencies: {
        '@babel/highlight': '^7.10.4'
      }
    },
    ...
  },
  meta: {
    format: '0.0.0',
    workspaces: {
      patterns: ['./packages/*'],
      packages: {
        '@qiwi/pijma-core': '<root>/packages/core/package.json'
      }
    }
  },
}
```

### Inspired by
* [synp](https://github.com/imsnif/synp)
* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)

## License
[MIT](./LICENSE)
