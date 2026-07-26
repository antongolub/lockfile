import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newBuilder, type Graph } from '../../main/ts/graph.ts'
import { enrich } from '../../main/ts/enrich/facade.ts'
import type { Packument, PackumentVersion, RegistryAdapter } from '../../main/ts/registry/types.ts'
import type { TarballSource } from '../../main/ts/enrich/refurbish.ts'
import * as yarnBerryV8 from '../../main/ts/formats/yarn-berry-v8.ts'
import * as yarnBerryV9 from '../../main/ts/formats/yarn-berry-v9.ts'
import {
  createNativeLock,
  FROZEN_ORACLE_MATRIX,
  runFrozenOracle,
  type FrozenOracleAdapter,
  type FrozenOracleCandidate,
} from '../helpers/frozen-oracle.ts'

const here = dirname(fileURLToPath(import.meta.url))
const tarballPath = resolve(here, '../resources/fixtures/tarballs/ms-2.1.3.tgz')
const registryScript = resolve(here, '../helpers/frozen-registry.mjs')
const tarballBytes = readFileSync(tarballPath)
const fseventsManifest = `${JSON.stringify({
  name: 'fsevents',
  version: '2.3.3',
  main: 'fsevents.js',
  os: ['darwin'],
}, null, 2)}\n`
const fseventsSource = `/*
 ** © 2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller
 ** Licensed under MIT License.
 */

/* jshint node:true */
"use strict";

if (process.platform !== "darwin") {
  throw new Error(\`Module 'fsevents' is not compatible with platform '\${process.platform}'\`);
}

const Native = require("./fsevents.node");
const events = Native.constants;

function watch(path, since, handler) {
  if (typeof path !== "string") {
    throw new TypeError(\`fsevents argument 1 must be a string and not a \${typeof path}\`);
  }
  if ("function" === typeof since && "undefined" === typeof handler) {
    handler = since;
    since = Native.flags.SinceNow;
  }
  if (typeof since !== "number") {
    throw new TypeError(\`fsevents argument 2 must be a number and not a \${typeof since}\`);
  }
  if (typeof handler !== "function") {
    throw new TypeError(\`fsevents argument 3 must be a function and not a \${typeof handler}\`);
  }

  let instance = Native.start(Native.global, path, since, handler);
  if (!instance) throw new Error(\`could not watch: \${path}\`);
  return () => {
    const result = instance ? Promise.resolve(instance).then(Native.stop) : Promise.resolve(undefined);
    instance = undefined;
    return result;
  };
}

function getInfo(path, flags) {
  return {
    path,
    flags,
    event: getEventType(flags),
    type: getFileType(flags),
    changes: getFileChanges(flags),
  };
}

function getFileType(flags) {
  if (events.ItemIsFile & flags) return "file";
  if (events.ItemIsDir & flags) return "directory";
  if (events.MustScanSubDirs & flags) return "directory"; 
  if (events.ItemIsSymlink & flags) return "symlink";
}
function anyIsTrue(obj) {
  for (let key in obj) {
    if (obj[key]) return true;
  }
  return false;
}
function getEventType(flags) {
  if (events.ItemRemoved & flags) return "deleted";
  if (events.ItemRenamed & flags) return "moved";
  if (events.ItemCreated & flags) return "created";
  if (events.ItemModified & flags) return "modified";
  if (events.RootChanged & flags) return "root-changed";
  if (events.ItemCloned & flags) return "cloned";
  if (anyIsTrue(flags)) return "modified";
  return "unknown";
}
function getFileChanges(flags) {
  return {
    inode: !!(events.ItemInodeMetaMod & flags),
    finder: !!(events.ItemFinderInfoMod & flags),
    access: !!(events.ItemChangeOwner & flags),
    xattrs: !!(events.ItemXattrMod & flags),
  };
}

exports.watch = watch;
exports.getInfo = getInfo;
exports.constants = events;
`

function ustarFile(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.fill(0x20, 148, 156)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.write('00', 263)
  header.write('root', 265)
  header.write('root', 297)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([
    header,
    data,
    Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length),
  ])
}

const fseventsTarballBytes = gzipSync(Buffer.concat([
  ustarFile('package/package.json', Buffer.from(fseventsManifest)),
  ustarFile('package/fsevents.js', Buffer.from(fseventsSource)),
  Buffer.alloc(1024),
]))
let registryProcess: ChildProcess | undefined
let registryFixtureRoot: string | undefined

interface BerryAdapter {
  readonly native: FrozenOracleAdapter
  parse(input: string): Graph
  stringify(graph: Graph): string
  optimize(graph: Graph): { graph: Graph }
}

const adapters: readonly BerryAdapter[] = [
  {
    native: FROZEN_ORACLE_MATRIX.find(entry => entry.alias === 'pm-yarn-berry-v8')!,
    parse: yarnBerryV8.parse,
    stringify: yarnBerryV8.stringify,
    optimize: yarnBerryV8.optimize,
  },
  {
    native: FROZEN_ORACLE_MATRIX.find(entry => entry.alias === 'pm-yarn-berry-v9')!,
    parse: yarnBerryV9.parse,
    stringify: yarnBerryV9.stringify,
    optimize: yarnBerryV9.optimize,
  },
]

beforeAll(async () => {
  registryFixtureRoot = mkdtempSync(resolve(tmpdir(), 'lockgraph-fsevents-registry-'))
  const fseventsTarballPath = resolve(registryFixtureRoot, 'fsevents-2.3.3.tgz')
  writeFileSync(fseventsTarballPath, fseventsTarballBytes)
  registryProcess = spawn(process.execPath, [registryScript, tarballPath, fseventsTarballPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise<string>((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error('local frozen registry did not start')), 10_000)
    registryProcess!.once('error', reject)
    registryProcess!.stdout!.once('data', chunk => {
      clearTimeout(timeout)
      resolvePort(String(chunk).trim())
    })
  })
  process.env.LOCKGRAPH_TEST_REGISTRY = `http://127.0.0.1:${port}/`
})

afterAll(() => {
  delete process.env.LOCKGRAPH_TEST_REGISTRY
  registryProcess?.kill('SIGTERM')
  if (registryFixtureRoot !== undefined) rmSync(registryFixtureRoot, { recursive: true, force: true })
})

function projectFiles(adapter: FrozenOracleAdapter): Readonly<Record<string, string>> {
  return {
    'package.json': `${JSON.stringify({
      name: 'lockgraph-fsevents-compat-oracle',
      version: '1.0.0',
      private: true,
      packageManager: `yarn@${adapter.version}`,
      optionalDependencies: { fsevents: '2.3.3' },
    }, null, 2)}\n`,
    '.yarnrc.yml': [
      'nodeLinker: node-modules',
      'enableScripts: false',
      'unsafeHttpWhitelist:',
      '  - 127.0.0.1',
      '',
    ].join('\n'),
  }
}

function sourceGraph(adapter: BerryAdapter): Graph {
  const builder = newBuilder()
  builder.addNode({
    id: 'lockgraph-fsevents-compat-oracle@0.0.0-use.local',
    name: 'lockgraph-fsevents-compat-oracle',
    version: '0.0.0-use.local',
    peerContext: [],
    workspacePath: '',
  })
  builder.addNode({
    id: 'fsevents@2.3.3',
    name: 'fsevents',
    version: '2.3.3',
    peerContext: [],
  })
  builder.addEdge(
    'lockgraph-fsevents-compat-oracle@0.0.0-use.local',
    'fsevents@2.3.3',
    'optional',
    { range: 'npm:2.3.3' },
  )
  builder.setTarball(
    { name: 'fsevents', version: '2.3.3' },
    { os: ['darwin'] },
  )
  const lockfile = adapter.stringify(builder.seal()).replace(
    /^(__metadata:\n  version: \d+\n)/m,
    '$1  cacheKey: 10c0\n',
  )
  return adapter.parse(lockfile)
}

function sources(): Readonly<{
  registry: RegistryAdapter
  artifacts: TarballSource
}> {
  const fsevents: PackumentVersion = {
    name: 'fsevents',
    version: '2.3.3',
    os: ['darwin'],
  }
  const nodeGyp: PackumentVersion = { name: 'node-gyp', version: '11.5.0' }
  const packs: Record<string, Packument> = {
    fsevents: {
      name: 'fsevents',
      distTags: { latest: '2.3.3' },
      versions: { '2.3.3': fsevents },
    },
    'node-gyp': {
      name: 'node-gyp',
      distTags: { latest: '11.5.0' },
      versions: { '11.5.0': nodeGyp },
    },
  }
  return {
    registry: {
      async packument(name) {
        return packs[name]
      },
      async resolve(name, range) {
        if (name === 'node-gyp' && range === 'npm:latest') return nodeGyp
        return undefined
      },
    },
    artifacts: {
      async tarball(name, version) {
        if (name === 'fsevents' && version === '2.3.3') return fseventsTarballBytes
        if (name === 'node-gyp' && version === '11.5.0') return tarballBytes
        return undefined
      },
    },
  }
}

function fseventsSubtree(lockfile: string): string {
  const lines = lockfile.split('\n')
  const blocks: string[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]!.startsWith('"fsevents@')) continue
    const block = [lines[index]!]
    for (index++; index < lines.length && (lines[index] === '' || lines[index]!.startsWith('  ')); index++) {
      block.push(lines[index]!)
    }
    index--
    blocks.push(block.join('\n').trimEnd())
  }
  return blocks.join('\n\n')
}

describe.sequential('infra: Yarn Berry fsevents plugin-compat oracle', () => {
  for (const adapter of adapters) {
    it(`${adapter.native.alias} matches the fresh native subtree and accepts --immutable unchanged`, async () => {
      const files = projectFiles(adapter.native)
      const native = createNativeLock(adapter.native, files)
      const result = await enrich(sourceGraph(adapter), {
        ...sources(),
        manifests: {
          '': {
            name: 'lockgraph-fsevents-compat-oracle',
            version: '1.0.0',
            optionalDependencies: { fsevents: '2.3.3' },
            overrides: [],
          },
        },
      }, {
        target: {
          format: adapter.native.format,
          managerVersion: adapter.native.version,
        },
        contract: 'snapshot',
        cacheKey: '10c0',
      })
      const lockfile = adapter.stringify(adapter.optimize(result.graph).graph)
      const nativeLockfile = String(native['yarn.lock'])

      expect(fseventsSubtree(lockfile)).toBe(fseventsSubtree(nativeLockfile))
      expect(lockfile).toBe(nativeLockfile)
      expect(fseventsSubtree(lockfile)).toContain('node-gyp: "npm:latest"')
      expect(fseventsSubtree(lockfile).match(/checksum:/g)?.length).toBe(1)

      const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
        target: {
          format: adapter.native.format,
          managerVersion: adapter.native.version,
        },
        lockfile,
        companions: [],
      })).digest('hex')}`
      const candidate: FrozenOracleCandidate = Object.freeze({
        protocol: 'lockgraph-frozen-projection/v1',
        target: Object.freeze({
          format: adapter.native.format,
          managerVersion: adapter.native.version,
        }),
        projectionDigest,
        lockfile,
        companions: Object.freeze([]),
      })
      const oracle = runFrozenOracle(candidate, adapter.native, files)
      expect(oracle.reason).toBeUndefined()
      expect(oracle.receipt).toMatchObject({
        target: candidate.target,
        projectionDigest,
        verification: 'frozen-verified',
      })
    }, 60_000)
  }
})
