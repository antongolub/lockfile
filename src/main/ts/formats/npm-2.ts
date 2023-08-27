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
  peerDependencies?: Record<string, string>
  bin?: any
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
      funding: entry.funding,
      bin: entry.bin,
      peerDependencies: entry.peerDependencies
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
  const idx = createIndex(snap)
  const nmtree = Object.entries(idx.tree)
    .map(([key, id]) => {
      const chunks = key.split(',')

      return {
        chunks,
        key,
        id
      }
    })
    // .sort((a, b) => {
    //   // (a.chunks.length - b.chunks.length) || a.chunks.slice(-1)[0].localeCompare(b.chunks.slice(-1)[0])
    //   // (a.chunks.length - b.chunks.length) || a.key.localeCompare(b.key)
    //   // a.chunks.length < 2 ? -1 : a.key.localeCompare(b.key)
    //   const d = Math.min(a.chunks.length, b.chunks.length)
    //
    //   let i = 0
    //   while (i < d - 1) {
    //     if (a.chunks[i].localeCompare(b.chunks[i]) === -1) {
    //       return -1
    //     }
    //     i++
    //   }
    //
    //   return a.chunks.length - b.chunks.length
    // })
    .reduce<Record<string, {entry: TLockfileEntry, parent: string}>>((result, {key, id, chunks}) => {
      const entry = snap.entries[id]
      if (!entry) {
        return result
      }
      const parent = chunks[0]
      const cl = chunks.length

      let i = cl - 1
      while (i > -1) {
        const _key = chunks.slice(i)//.reverse()

        const variant = formatNmKey(_key)
        const found = result[variant]



        if (found) {
          if (found.entry === entry) {
            return result
          }

        } else {
          result[variant] = {entry, parent}
          return result
        }
        i--
      }

      //
      //
      //
      //
      //
      // chunks.reverse().forEach((_v, i, chunks) => {
      //   let l = 0
      //   while(l < i) {
      //     let j = 0
      //     while (j < i) {
      //       const prefix = chunks.slice()
      //       j++
      //     }
      //     l++
      //
      //
      //
      //
      //
      //
      //     let m = i
      //     while(m < cl) {
      //       const j = m + l
      //       const prefix = chunks.slice(m, j === cl ? cl - 1 : j)
      //       const variant = formatNmKey([...prefix, entry.name].reverse())
      //       const found = result[variant]
      //
      //       if (found?.entry === entry) {
      //         return
      //       }
      //
      //       if (!found) {
      //         // if (prefix.length && (idx.tree[prefix.join(',')])) {
      //         //   m++
      //         //   continue
      //         // }
      //         result[variant] = {entry, parent: chunks[0]}
      //         return
      //       }
      //       m++
      //     }
      //     l++
      //   }
      // })


      return result
    }, {})

  // const buildNmTree = (entry: TLockfileEntry, chain: TNmChain = [[entry, {}]], result: Record<string, TLockfileEntry> = {}, queue: [TLockfileEntry, TNmChain][] = []) => {
  //   const {name, dependencies} = entry
  //   const cl = chain.length
  //
  //   chain[0][1][name] = entry
  //   chain.forEach(([parent, tree], i) => {
  //     Object.values<TLockfileEntry>(tree).forEach(entry => {
  //       let l = 0
  //       while(l < cl - 1) {
  //         let m = i
  //         while(m < cl) {
  //           const j = m + l
  //           const prefix = chain.slice(m, j === cl ? cl - 1 : j)
  //             .reverse()
  //             .map(([{name}]) => name)
  //             .filter(Boolean)
  //
  //           const variant = formatNmKey([...prefix, entry.name])
  //           const found = result[variant]
  //
  //           if (found === entry) {
  //             return
  //           }
  //
  //           if (!found) {
  //             if (prefix.length && (result[formatNmKey(prefix)] !== chain[m][0])) {
  //               m++
  //               continue
  //             }
  //             result[variant] = entry
  //             return
  //           }
  //           m++
  //         }
  //         l++
  //       }
  //     })
  //   })
  //
  //   const _tree = {}
  //   dependencies && Object.entries(dependencies).forEach(([_name, range]) => {
  //     const _entry = entries.find(({
  //       name: __name,
  //       ranges
  //     }) => _name === __name && ranges.includes(range)) as TLockfileEntry
  //     if (!_entry) {
  //       throw new Error(`inconsistent snapshot: ${_name} ${range}`)
  //     }
  //
  //     queue.push([_entry, name ? [[entry, _tree], ...chain] : chain])
  //   })
  //
  //   while(queue.length) {
  //     const [entry, chain] = queue.shift() as [TLockfileEntry, TNmChain]
  //     buildNmTree(entry, chain, result, queue)
  //   }
  //
  //   return result
  // }
  //
  // const tree = buildNmTree({...entries[0], name: ''})

  fs.writeFileSync('temp/tree.json', JSON.stringify(nmtree, null, 2))
  fs.writeFileSync('temp/nmtree2.json', JSON.stringify(Object.entries(idx.tree)
    .map(([key, id]) => {
      const chunks = key.split(',')

      return {
        chunks,
        key,
        id
      }
    })
    // .sort((a, b) => {
      // (a.chunks.length - b.chunks.length) || a.chunks.slice(-1)[0].localeCompare(b.chunks.slice(-1)[0])
      // (a.chunks.length - b.chunks.length) || a.key.localeCompare(b.key)
      // a.chunks.length < 2 ? -1 : a.key.localeCompare(b.key)

      // if (a.chunks.length === b.chunks.length) {
      //   return a.key.localeCompare(b.key)
      // }
      //
      // const d = Math.min(a.chunks.length, b.chunks.length)
      // let i = 0
      // while (i < d) {
      //   const p = a.chunks[i].localeCompare(b.chunks[i])
      //   if (p) {
      //     return p
      //   }
      //   i++
      // }
      //
      // return (a.chunks.length - b.chunks.length)// || a.key.localeCompare(b.key)
    //})
    .map(a => a.key), null, 2))


  // delete tree['node_modules/'] // FIXME
  const formatIntegrity = (hashes: THashes): string => Object.entries(hashes).map(([key, value]) => `${key}-${value}`).join(' ')
  const packages = sortObject({
    "": snap.manifest,
    ...Object.entries(nmtree).reduce((m, [k, {entry, parent}]) => {
      m[k] = {
        version: entry.version,
        resolved: formatTarballUrl(entry.name, entry.version),
        integrity: formatIntegrity(entry.hashes)
      }
      if (!snap.manifest.dependencies?.[parent]) {
        m[k].dev = true
      }
      if (entry.dependencies) {
        m[k].dependencies = entry.dependencies
      }
      m[k].bin = entry.bin
      m[k].engines = entry.engines
      m[k].funding = entry.funding
      m[k].peerDependencies = entry.peerDependencies

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
