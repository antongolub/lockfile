import {ICheck, IFormat, IPreformat, TEntry, TManifest, TSnapshot, TSource} from '../interface'
import {formatTarballUrl, parseIntegrity, formatIntegrity} from '../common'
import {sortObject, debugAsJson} from '../util'
import {analyze, getDeps, getId} from '../analyze'
import semver from 'semver'

export type TNpm3LockfileEntry = {
  name?: string
  version?: string
  resolved?: string
  integrity?: string
  dev?: boolean
  link?: boolean
  dependencies?: Record<string, string>,
  engines?: Record<string, string>
  funding?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bin?: any
  license?: string
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
    const variants: string[] = []

    let s = 0
    let i = 0
    while(s < chain.length) {
      let l = chain.length + 1
      while (l--) {
        const variant = formatNmKey([...chain.slice(s, l), name].filter(Boolean))
        const entry = entries[variant]

        if (entry && (!entry.version || semver.satisfies(entry.version as string, range))) { // FIXME later
          return [variant, entry]
        }
        variants.push(variant)
      }
      s++
    }
    throw new Error(`Malformed lockfile: ${name} ${range}\n${variants.join('\n')}`)
  }

  const processPackage = (path: string, pkg: TNpm3LockfileEntry): TEntry => {
    const sourceType = (pkg.link || path === "") ? 'workspace' : 'semver'

    if (sourceType === 'workspace' && !pkg.name){
      return processPackage(path, {
        ...pkg,
        ...packages[pkg.resolved as string]
      })
    }
    const source: TSource = {
      id: (pkg.resolved || '.') as string,
      type: sourceType
    }

    const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
    const name = pkg.name || chain[chain.length - 1]
    const version = pkg.version as string
    const id = path === "" ? path : getId(name, version)

    if (entries[id]) {
      return entries[id]
    }

    entries[id] = {
      name,
      version,
      ranges: [],
      hashes: parseIntegrity(pkg.integrity),
      source,
      dependencies: pkg.dependencies,
      engines: pkg.engines,
      funding: pkg.funding,
      bin: pkg.bin,
      devDependencies: pkg.devDependencies,
      peerDependencies: pkg.peerDependencies,
      optionalDependencies: pkg.optionalDependencies,
      license: pkg.license
    }

    Object.entries<string>(getDeps(entries[id])).forEach(([_name, range]) => {
      const [_path, _entry] = getClosestPkg(_name, chain, packages, range)
      const {ranges} = processPackage(_path, _entry)

      if (!ranges.includes(range)) {
        ranges.push(range)
        ranges.sort()
      }
    })
    return entries[id]
  }

  Object.entries(packages).forEach(([path, entry]) =>
    (path.startsWith('node_modules/') || path === '') && processPackage(path, entry))

  return sortObject(entries)
}

export const preformat: IPreformat<TNpm3Lockfile> = (idx): TNpm3Lockfile => {
  const snap = idx.snapshot
  const mapped = Object.values(idx.tree)

  // debugAsJson(
  //   'mapped.json',
  //   mapped//.map(a => a.key + (' ').repeat(40) + a.id + ' ' + a.chunks.length)
  // )

  const nmtree = mapped.reduce<Record<string, {entry: TEntry, parent: string}>>((result, {key, id, chunks}) => {
    const entry = snap[id]
    if (!entry) {
      throw new Error(`Malformed snapshot: ${id}`)
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

    if (entry.source.type === 'workspace') {
      result[formatNmKey([entry.name])] = {entry, parent: ''}
    }

    return result
  }, {})

  debugAsJson('tree.json', nmtree)

  const manifest = snap[""].manifest as TManifest
  const packages = sortObject(Object.entries(nmtree).reduce((m, [k, {entry, parent}]) => {
      if (entry.source.type === 'workspace') {
        if (entry.source.id === '.') {
          m[""] = manifest as TNpm3LockfileEntry
          return m
        }

        m[`node_modules/${entry.name}`] = {
          resolved: entry.source.id as string,
          link: true
        }

        m[entry.source.id as string] = {
          name: entry.name,
          version: entry.version,
          license: entry.license,
          dependencies: entry.dependencies,
          bin: entry.bin,
          devDependencies: entry.devDependencies,
        }
        return m
      }

      m[k] = {
        version: entry.version,
        resolved: formatTarballUrl(entry.name, entry.version),
        integrity: formatIntegrity(entry.hashes)
      }
      if (!idx.prod.has(entry)) {
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
  )

  return {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  }
}

export const format: IFormat = (snapshot: TSnapshot): string => JSON.stringify(preformat(analyze(snapshot)), null, 2)
