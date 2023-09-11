import {ICheck, IFormat, IPreformat, THashes, TEntry, TManifest, TSnapshot} from '../interface'
import {formatTarballUrl, parseIntegrity} from '../common'
import {sortObject, debugAsJson} from '../util'
import {analyze} from '../analyze'
import semver from 'semver'

export type TNpm3LockfileEntry = {
  name?: string
  version: string
  resolved: string
  integrity: string
  dev?: boolean
  link?: boolean
  dependencies?: Record<string, string>,
  engines?: Record<string, string>
  funding?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bin?: any
}

export type TNpm3LockfileDeps = Record<string, TNpm3LockfileEntry>

export type TNpm3Lockfile = {
  lockfileVersion: 3
  name: string
  version: string
  requires?: true
  packages: TNpm3LockfileDeps
}

export const version = 'npm-3'

export const check: ICheck = (lockfile: string) => lockfile.includes('  "lockfileVersion": 3')

export const parse = (lockfile: string): TSnapshot => {
  const lf: TNpm3Lockfile = JSON.parse(lockfile)
  const snapshot = parsePackages(lf.packages)

  snapshot[""].manifest = lf.packages[""]

  // debugAsJson('npm3-snapshot.json', snapshot)

  return snapshot
}

const formatNmKey = (chunks: string[]) => `node_modules/` + chunks.join('/node_modules/')

const parsePackages = (packages: TNpm3LockfileDeps): any => {
  const entries: Record<string, TEntry> = {}
  const getClosestPkg = (name: string, chain: string[], entries: Record<string, TNpm3LockfileEntry>, range: string): [string, TNpm3LockfileEntry] => {
    let l = chain.length + 1
    const variants: string[] = []

    while (l--) {
      let s = 0
      while(s <= l) {
        const variant = formatNmKey([...chain.slice(s, l), name].filter(Boolean))
        const entry = entries[variant]

        if (entry && semver.satisfies(entry.version, range)) {
          return [variant, entry]
        }
        variants.push(variant)
        s++
      }
    }
    throw new Error(`Malformed lockfile: ${name} ${range}\n${variants.join('\n')}`)
  }

  const processPackage = (path: string, pkg: TNpm3LockfileEntry): TEntry => {
    const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
    const name = pkg.name || chain[chain.length - 1]
    const version = pkg.version
    const id = path === "" ? path : `${name}@${version}`
    if (entries[id]) {
      return entries[id]
    }

    const dependencies = sortObject({...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies})
    entries[id] = {
      name,
      version,
      ranges: [],
      hashes: parseIntegrity(pkg.integrity),
      source: pkg.resolved,
      sourceType: pkg.link ? 'workspace' : 'semver',
      dependencies: Object.keys(dependencies).length ? dependencies : undefined,
      engines: pkg.engines,
      funding: pkg.funding,
      bin: pkg.bin,
      peerDependencies: pkg.peerDependencies,
      optionalDependencies: pkg.optionalDependencies
    }

    Object.entries<string>(dependencies).forEach(([_name, range]) => {
      const [_path, _entry] = getClosestPkg(_name, chain, packages, range)
      const {ranges} = processPackage(_path, _entry)

      if (!ranges.includes(range)) {
        ranges.push(range)
        ranges.sort()
      }
    })
    return entries[id]
  }

  Object.entries(packages).forEach(([path, entry]) => processPackage(path, entry))

  return sortObject(entries)
}

export const preformat: IPreformat<TNpm3Lockfile> = (idx): TNpm3Lockfile => {
  const snap = idx.snapshot
  const mapped = Object.values(idx.tree)

  // debugAsJson(
  //   'mapped.json',
  //   mapped.map(a => a.key + (' ').repeat(40) + a.id + ' ' + a.chunks.length)
  // )

  const nmtree = mapped.reduce<Record<string, {entry: TEntry, parent: string}>>((result, {key, id, chunks}) => {
    const entry = snap[id]
    if (!entry) {
      throw new Error('Malformed snapshot')
      // return result
    }
    const grandparent = chunks[1]
    const cl = chunks.length

    let l = 0
    while (l <= cl) {
      const [name, ...parents] = [...chunks].reverse()

      let i = 0
      while (i < parents.length) {
        const __key = parents.slice(i, i + l).reverse()
        const _key = [...__key, name]//
        const variant = formatNmKey(_key)
        const found = result[variant]

        if (found) {
          if (found.entry === entry) {
            return result
          }

        } else {
          const pEntry = result[formatNmKey(__key)]?.entry
          const ppEntry = idx.getEntry(idx.tree[chunks.slice(0, cl - i - l).join(',')]?.id)
          if (__key.length && pEntry !== ppEntry) {
            i++
            continue
          }
          result[variant] = {entry, parent: grandparent}
          return result
        }
        i++
      }
      l++
    }

    return result
  }, {})

  debugAsJson('tree.json', nmtree)

  // delete tree['node_modules/'] // FIXME
  const formatIntegrity = (hashes: THashes): string => Object.entries(hashes).map(([key, value]) => `${key}-${value}`).join(' ')

  const manifest = snap[""].manifest as TManifest
  const packages = sortObject({
    "": manifest as TNpm3LockfileEntry,
    ...Object.entries(nmtree).reduce((m, [k, {entry, parent}]) => {
      m[k] = {
        version: entry.version,
        resolved: formatTarballUrl(entry.name, entry.version),
        integrity: formatIntegrity(entry.hashes)
      }
      if (!manifest.dependencies?.[parent]) {
        m[k].dev = true
      }
      m[k].dependencies = entry.dependencies
      m[k].bin = entry.bin
      m[k].engines = entry.engines
      m[k].funding = entry.funding
      m[k].peerDependencies = entry.peerDependencies
      m[k].optionalDependencies = entry.optionalDependencies

      return m
    }, {} as TNpm3LockfileDeps)
  })

  return {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  }
}

export const format: IFormat = (snapshot: TSnapshot): string => JSON.stringify(preformat(analyze(snapshot)), null, 2)
