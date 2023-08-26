import {THashes, TLockfileEntry, TManifest, TSnapshot} from '../interface'
import {parse as parseNpm1, preformat as preformatNpm1, TNpm1Lockfile, createIndex} from './npm-1'
import {formatTarballUrl, parseIntegrity} from '../common'
import {sortObject} from '../util'
import fs from 'node:fs'

export type TNpm2LockfileEntry = {
  version: string
  resolved: string
  integrity: string
  dev?: boolean
  requires?: Record<string, string>
  dependencies?: TNpm2LockfileDeps,
  engines?: Record<string, string>
  funding?: Record<string, string>
}

export type TNpm2LockfileDeps = Record<string, any>

export type TNpm2Lockfile = {
  lockfileVersion: 2
  name: string
  version: string
  requires?: true
  packages: TNpm2LockfileDeps
  dependencies: TNpm2LockfileDeps
}

type TNmChain = [TLockfileEntry, Record<string, TLockfileEntry>][]

export const parse = async (lockfile: string): Promise<TSnapshot> => {
  const lfraw = await JSON.parse(lockfile)
  const entries = await parsePackages(lockfile)
  const npm1snap = await parseNpm1(lockfile, JSON.stringify(lfraw.packages['']))

  fs.writeFileSync('temp/npm1.json', JSON.stringify(npm1snap.entries, null, 2))
  fs.writeFileSync('temp/npm2.json', JSON.stringify(entries, null, 2))
  return {
    ...npm1snap,
    entries,
    format: 'npm-2'
  }
}

const formatNmKey = (chunks: string[]) => `node_modules/` + chunks.join('/node_modules/')

const parsePackages = async (lockfile: string): Promise<any> => {
  const lf: TNpm2Lockfile = await JSON.parse(lockfile)
  const entries: Record<string, TLockfileEntry> = {}
  const upsertEntry = (name: string, version: string, extra?: Partial<TLockfileEntry>, key: string = `${name}@${version}`) => {
    if (!entries[key]) {
      entries[key] = {name, version, ranges: [], hashes: {}}
    }
    return Object.assign(entries[key], extra)
  }
  const pushRange = (name: string, version: string, range: string): void => {
    const entry = upsertEntry(name, version)

    if (!entry.ranges.includes(range)) {
      entry.ranges.push(range)
      entry.ranges.sort()
    }
  }

  const getClosestEntry = (name: string, chain: string[], entries: Record<string, any>) => {
    let l = chain.length + 1

    while (l--) {
      // const variant = 'node_modules/' + [...chain.slice(0, l), name].filter(Boolean).join('/node_modules/')
      const variant = formatNmKey([...chain.slice(0, l), name].filter(Boolean))
      const entry = entries[variant]

      if (entry) {
        return entry
      }
    }

    return entries[""]
  }
  Object.entries(lf.packages).forEach(([path, entry]) => {
    const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
    const name = entry.name || chain[chain.length - 1]
    const version = entry.version
    const dependencies = {...entry.dependencies, ...entry.devDependencies, ...entry.optionalDependencies}

    upsertEntry(name, version, {
      version,
      hashes: parseIntegrity(entry.integrity),
      dependencies: Object.keys(dependencies).length ? dependencies : undefined,
      engines: entry.engines,
      funding: entry.funding
    }, path === "" ? path : undefined)

    Object.entries<string>(dependencies).forEach(([_name, range]) => {
      const _entry = getClosestEntry(_name, chain, lf.packages)
      pushRange(_name, _entry.version, range)
    })
  })

  return sortObject(entries)
}

export const format = async (snap: TSnapshot): Promise<string> => {
  const lfnpm1: TNpm1Lockfile = (await preformatNpm1(snap))
  const {entries} = createIndex(snap)
  const buildNmTree = (entry: TLockfileEntry, chain: TNmChain = [[entry, {}]], result: Record<string, TLockfileEntry> = {}, queue: [TLockfileEntry, TNmChain][] = []) => {
    const {name, dependencies} = entry
    const cl = chain.length

    chain[0][1][name] = entry
    chain.forEach(([parent, tree], i) => {
      Object.values<TLockfileEntry>(tree).forEach(entry => {
        let l = 0
        while(l < cl - 1) {
          let m = i
          while(m < cl) {
            const j = m + l
            const prefix = chain.slice(m, j === cl ? cl - 1 : j)
              .reverse()
              .map(([{name}]) => name)
              .filter(Boolean)

            const variant = formatNmKey([...prefix, entry.name])
            const found = result[variant]

            if (found === entry) {
              return
            }

            if (!found) {
              if (prefix.length && (result[formatNmKey(prefix)] !== chain[m][0])) {
                m++
                continue
              }
              result[variant] = entry
              return
            }
            m++
          }
          l++
        }
      })
    })

    const _tree = {}
    dependencies && Object.entries(dependencies).forEach(([_name, range]) => {
      const _entry = entries.find(({
        name: __name,
        ranges
      }) => _name === __name && ranges.includes(range)) as TLockfileEntry
      if (!_entry) {
        throw new Error(`inconsistent snapshot: ${_name} ${range}`)
      }

      queue.push([_entry, name ? [[entry, _tree], ...chain] : chain])
    })

    while(queue.length) {
      const [entry, chain] = queue.shift() as [TLockfileEntry, TNmChain]
      buildNmTree(entry, chain, result, queue)
    }

    return result
  }

  const tree = buildNmTree({...entries[0], name: ''})

  fs.writeFileSync('temp/tree.json', JSON.stringify(tree, null, 2))

  delete tree['node_modules/'] // FIXME
  const formatIntegrity = (hashes: THashes): string => Object.entries(hashes).map(([key, value]) => `${key}-${value}`).join(' ')
  const packages = sortObject({
    "": snap.manifest,
    ...Object.entries(tree).reduce((m, [k, v]) => {
      m[k] = {
        version: v.version,
        resolved: formatTarballUrl(v.name, v.version),
        integrity: formatIntegrity(v.hashes)
      }
      return m
    }, {} as TNpm2LockfileDeps)
  })

  const lf = {
    name: lfnpm1.name,
    version: lfnpm1.version,
    lockfileVersion: 2,
    requires: true,
    packages,
    dependencies: lfnpm1.dependencies,
  }

  return JSON.stringify(lf, null, 2)
}
