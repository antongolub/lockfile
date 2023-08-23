import {TLockfileEntry, TManifest, TSnapshot} from '../interface'
import {parse as parseNpm1, preformat as preformatNpm1, TNpm1Lockfile} from './npm-1'
import {parseIntegrity} from "../common";
import {sortObject} from "../util";
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
      const variant = 'node_modules/' + [...chain.slice(0, l), name].filter(Boolean).join('/node_modules/')
      const entry = entries[variant]

      if (entry) {
        return entry
      }
    }

    return entries[""]
  }
  Object.entries(lf.packages).forEach(([path, entry]) => {
    // const name = path.slice(('/' + path).lastIndexOf('/node_modules/') + 13)
    const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
    const name = entry.name || chain[chain.length - 1]
    const version = entry.version
    const dependencies = {...entry.dependencies, ...entry.devDependencies, ...entry.optionalDependencies}

    // const [name]: string[] = ('/' + path).split('/node_modules').map(name => name.slice(1)).reverse()
    // const [name, parent]: string[] = ('/' + path).split('/node_modules').map(name => name.slice(1)).reverse()
    //
    // if (parent) {
    //
    // }

    // console.log('name=', name)

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

  // const packages = Object.entries(lfnpm1.dependencies).reduce((m: TNpm2LockfileDeps, [name, entry]) => {
  //     const {engines, funding} = snap.entries[`${name}@${entry.version}`] || {}
  //     m[`node_modules/${name}`] = {
  //         ...entry,
  //         requires: undefined,
  //         dependencies: entry.requires,
  //         engines,
  //         funding
  //     }
  //     return m
  // }, {
  //     "": snap.manifest
  // })


  const packages = {}
  const values = Object.values(snap.entries)

  type TNmChain = [string, Record<string, TLockfileEntry>][]
  const buildNmTree = (entry: TLockfileEntry, chain: TNmChain, result: Record<string, TLockfileEntry> = {}, queue: [TLockfileEntry, TNmChain][] = []) => {
    const {name, dependencies} = entry

    // console.log(chain.map(([p])=> p).reverse().join('>'))

    // if (name === 'semver') {
    //   console.log(entry.ranges, name)
    //   console.log(chain.map(([p])=> p).reverse().join('>'))
    // }

    const foundIdx = chain.findIndex(([, tree]) => tree[name])
    let tree: Record<string, TLockfileEntry>

    if (foundIdx === -1) {
      [,tree] = chain[chain.length - 1]
    } else {
      [,tree] = chain[foundIdx]

      if (tree[name] === entry) {
        return result
      }

      [,tree] = chain[foundIdx - 1]
    }

    tree[name] = entry


    chain.forEach(([parent, tree], i) => {
      const prefix = chain.slice(i).map(([p]) => p).reverse().filter(Boolean)

      // console.log(tree)
      // console.log(chain.map(([p])=> p).reverse().join('>'))
      Object.values<TLockfileEntry>(tree).forEach(entry => {
        const key = 'node_modules/' + [...prefix, entry.name].join('/node_modules/')

        // if (entry.name === 'semver') {
        //   console.log(chain.map(([p])=> p).reverse().join('>'))
        //   console.log(entry)
        // }

        // console.log(entry)

        result[key] = entry
      })
    })

    let _tree = {}
    dependencies &&  Object.entries(dependencies).forEach(([_name, range]) => {
        const _entry = values.find(({
          name: __name,
          ranges
        }) => _name === __name && ranges.includes(range)) as TLockfileEntry
        if (!_entry) {
          throw new Error(`inconsistent snapshot: ${_name} ${range}`)
        }

        queue.push([_entry, [[name, _tree], ...chain]])

      })


    while(queue.length) {
      const [entry, chain] = queue.shift() as [TLockfileEntry, TNmChain]
      buildNmTree(entry, chain, result, queue)
    }


    // if (!_deps[name]) {
    //     _deps[name] = values.find(({name: _name, ranges}) => _name === name && ranges.includes(range))
    //     return
    // }
    //
    // if (_deps[name].ranges.includes(range)) {
    //     return
    // }

    return result
  }

  const tree = buildNmTree(values[0], [['', {}]])

  fs.writeFileSync('temp/tree.json', JSON.stringify(tree, null, 2))


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
