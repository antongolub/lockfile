import {ICheck, IFormat, IPreformat, THashes, TEntry, TManifest, TSnapshot} from '../interface'
import {preformat as preformatNpm1, TNpm1Lockfile} from './npm-1'
import {formatTarballUrl, parseIntegrity} from '../common'
import {sortObject, debugAsJson} from '../util'
import {analyze} from '../analyze'

export type TNpm2LockfileEntry = {
  name?: string
  version: string
  resolved: string
  integrity: string
  dev?: boolean
  link?: boolean
  requires?: Record<string, string>
  dependencies?: TNpm2LockfileDeps,
  engines?: Record<string, string>
  funding?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
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

export const version = 'npm-2'

export const check: ICheck = (lockfile: string) => lockfile.includes('  "lockfileVersion": 2')

export const parse = (lockfile: string): TSnapshot => {
  const lf: TNpm2Lockfile = JSON.parse(lockfile)
  const snapshot = parsePackages(lf.packages)

  snapshot[""].manifest = lf.packages[""]

  debugAsJson('npm2-snapshot.json', snapshot)

  return snapshot
}

const formatNmKey = (chunks: string[]) => `node_modules/` + chunks.join('/node_modules/')

const parsePackages = (packages: TNpm2LockfileDeps): any => {
  const entries: Record<string, TEntry> = {}
  const getClosestPkg = (name: string, chain: string[], entries: Record<string, TNpm2LockfileEntry>): [string, TNpm2LockfileEntry] => {
    let l = chain.length + 1

    while (l--) {
      const variant = formatNmKey([...chain.slice(0, l), name].filter(Boolean))
      const entry = entries[variant]

      if (entry) {
        return [variant, entry]
      }
    }

    return ["", entries[""]]
  }

  const processPackage = (path: string, pkg: TNpm2LockfileEntry): TEntry => {
    const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
    const name = pkg.name || chain[chain.length - 1]
    const version = pkg.version
    const id = path === "" ? path : `${name}@${version}`
    if (entries[id]) {
      return entries[id]
    }

    const dependencies = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies}
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
      peerDependencies: pkg.peerDependencies
    }

    Object.entries<string>(dependencies).forEach(([_name, range]) => {
      const [_path, _entry] = getClosestPkg(_name, chain, packages)
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

export const preformat: IPreformat<TNpm2Lockfile> = (idx): TNpm2Lockfile => {
  const snap = idx.snapshot
  const lfnpm1: TNpm1Lockfile = preformatNpm1(idx)
  const mapped = Object.values(idx.tree)

  debugAsJson(
    'mapped.json',
    mapped.map(a => a.key + (' ').repeat(40) + a.id + ' ' + a.chunks.length)
  )

  const nmtree = mapped.reduce<Record<string, {entry: TEntry, parent: string}>>((result, {key, id, chunks}) => {
      const entry = snap[id]
      if (!entry) {
        return result
      }
      const grandparent = chunks[0]
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
    "": manifest,
    ...Object.entries(nmtree).reduce((m, [k, {entry, parent}]) => {
      m[k] = {
        version: entry.version,
        resolved: formatTarballUrl(entry.name, entry.version),
        integrity: formatIntegrity(entry.hashes)
      }
      if (!manifest.dependencies?.[parent]) {
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

  return {
    name: lfnpm1.name,
    version: lfnpm1.version,
    lockfileVersion: 2,
    requires: true,
    packages,
    dependencies: lfnpm1.dependencies,
  }
}

export const format: IFormat = (snapshot: TSnapshot): string => JSON.stringify(preformat(analyze(snapshot)), null, 2)
