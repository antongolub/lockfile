import {TDependencies, THashes, TLockfileEntry, TManifest, TSnapshot} from '../interface'
import {sortObject} from '../util'
import {parseIntegrity, isProd, formatTarballUrl} from '../common'
import fs from 'node:fs'

export type TNpm1LockfileEntry = {
    version: string
    resolved: string
    integrity: string
    dev?: boolean
    requires?: Record<string, string>
    dependencies?: TNpm1LockfileDeps
}

export type TNpm1LockfileDeps = Record<string, TNpm1LockfileEntry>

export type TNpm1Lockfile = {
    lockfileVersion: 1
    name: string
    version: string
    requires?: true
    dependencies: TNpm1LockfileDeps
}

interface TDepTree {
    dependencies?: Record<string, TDepTree>
    version: string
    requires?: any
}

export const parse = async (lockfile: string, pkg: string): Promise<TSnapshot> => {
    const lf: TNpm1Lockfile = await JSON.parse(lockfile)
    const manifest: TManifest = await JSON.parse(pkg)
    const workspaces = {
        "": {
            name: manifest.name,
            path: '.',
            manifest
        }
    }
    const entries: Record<string, TLockfileEntry> = {
        "": {
            name: manifest.name,
            version: manifest.version,
            dependencies: {
                ...manifest.dependencies,
                ...manifest.devDependencies,
            },
            hashes: {},
            ranges: [],
        }
    }
    const getClosestVersion = (name: string, ...deps: TNpm1LockfileDeps[]): string =>
        deps.find((dep) => dep[name])?.[name]?.version as string

    const upsertEntry = (name: string, version: string, data: Partial<TLockfileEntry> = {}): TLockfileEntry => {
        const key = `${name}@${version}`
        if (!entries[key]) {
            // @ts-ignore
            entries[key] = {name, version, ranges: []}
        }
        return Object.assign(entries[key], data)
    }
    const pushRange = (name: string, version: string, range: string): void => {
        const entry = upsertEntry(name, version)

        if (!entry.ranges.includes(range)) {
            entry.ranges.push(range)
            entry.ranges.sort()
        }
    }
    const extractRanges = (deps?: TDependencies, ...parents: TNpm1LockfileDeps[]) => deps && Object.entries(deps).forEach(([_name, range]) => {
        const _version = getClosestVersion(_name, ...parents)
        pushRange(_name, _version, range)
    })
    const extractEntries = (deps?: TNpm1LockfileDeps, ...parents: TNpm1LockfileDeps[]) => deps && Object.entries(deps).forEach(([name, entry]) => {
        const requires = entry.requires || entry.dependencies && Object.entries(entry.dependencies).reduce((m, [name, {version}]) => {
            m[name] = version
            return m
        }, {} as Record<string, string>)

        upsertEntry(name, entry.version, {
            hashes: parseIntegrity(entry.integrity),
            dependencies: requires
        })

        extractEntries(entry.dependencies, deps, ...parents)
        extractRanges(requires, entry.dependencies || {}, deps, ...parents)
    })

    extractEntries(lf.dependencies)
    extractRanges(entries[""].dependencies, lf.dependencies || {})

    return {
        format: 'npm-1',
        entries: sortObject(entries),
        workspaces,
        manifest,
    }
}

const formatIntegrity = (hashes: THashes): string => Object.entries(hashes).map(([key, value]) => `${key}-${value}`).join(' ')

export const createIndex = (snap: TSnapshot) => {
    const rootEntry = snap.entries[""]
    const prod =  new Set([rootEntry])
    const deps = new Map()
    const entries: TLockfileEntry[] = Object.values(snap.entries)
    const edges: [string, string][] = []
    const tree: Record<string, string> = {}

    const idx = {
        edges,
        tree,
        prod,
        deps,
        entries,
        getDeps (entry: TLockfileEntry): TLockfileEntry[] {
            if (!deps.has(entry)) {
                deps.set(entry, [])
            }
            return deps.get(entry)
        },
        getId ({name, version}: TLockfileEntry): string {
            return `${name}@${version}`
        },
        getEntry (name: string, version: string) {
            return snap.entries[`${name}@${version}`]
        },
        findEntry (name: string, range: string) {
            return entries.find(({name: _name, ranges}) => name === _name && ranges.includes(range))
        }
    }

    const q: [TLockfileEntry, string][] = [[{...rootEntry, name: ''}, '']]
    while (q.length) {
        const [entry, prefix] = q.shift() as [TLockfileEntry, string]
        const {dependencies} = entry
        const id = idx.getId(entry)
        const key = prefix + entry.name

        tree[key] = id

        dependencies && Object.entries(dependencies).forEach(([name, range]) => {
            const _entry = idx.findEntry(name, range)
            if (!_entry) {
                throw new Error(`inconsistent snapshot: ${name} ${range}`)
            }
            edges.push([id, idx.getId(_entry)])
            q.push([_entry, key ? key + ',' + name + ',' : name])
        })
    }

    fs.writeFileSync('temp/deptree.json', JSON.stringify(sortObject(tree), null, 2))

    entries.forEach((entry) => {
        entry.dependencies && Object.entries(entry.dependencies).forEach(([_name, range]) => {
            const target = entries.find(({name, ranges}) => name === _name && ranges.includes(range))
            if (!target) {
                throw new Error(`inconsistent snapshot: ${_name} ${range}`)
            }
            idx.getDeps(entry).push(target)
        })
    })

    return idx
}

export const preformat = async (snap: TSnapshot): Promise<TNpm1Lockfile> => {
    const root = snap.manifest
    const idx = createIndex(snap)
    const deptree: TLockfileEntry[][] = []
    const fillTree = (entry: TLockfileEntry, chain: TLockfileEntry[] = []) => {
        const deps = idx.getDeps(entry)
        deps.forEach(c => isProd(root, chain[0]?.name || c.name) && idx.prod.add(c))

        deps
            .sort((a, b) =>
                idx.prod.has(a) && !idx.prod.has(b)
                    ? -1
                    : idx.prod.has(b) && !idx.prod.has(a)
                        ? 1
                        : a.name.localeCompare(b.name)
            )

        deps.forEach((dep) => deptree.push([...chain, dep]))
        deps.forEach((dep) => fillTree(dep, [...chain, dep]))
    }

    fillTree(idx.getEntry(root.name, root.version)!)

    const formatNpm1LockfileEntry = (entry: TLockfileEntry): TNpm1LockfileEntry => {
        const {name, version, hashes, dependencies} = entry
        const _entry: TNpm1LockfileDeps[string] = {
            version,
            resolved: formatTarballUrl(name, version),
            integrity: formatIntegrity(hashes)
        }

        if (!idx.prod.has(entry)) {
            _entry.dev = true
        }

        if (dependencies) {
            _entry.requires = dependencies
        }

        return _entry
    }

    const lf: TNpm1Lockfile = {
        name: root.name,
        version: root.version,
        lockfileVersion: 1,
        requires: true,
        dependencies: {}
    }
    const nmtree = lf
    const nodes: TDepTree[] = [nmtree]
    const processEntry = (name: string, version: string, parents: TNpm1LockfileEntry[]) => {
        const entry = idx.getEntry(name, version)!
        const deps = idx.getDeps(entry)
        const queue: [string, string, TNpm1LockfileEntry[]][] = []

        deps.forEach((e) => {
            const closestIndex = parents.findIndex((p) => p.dependencies?.[e.name])
            const closest = parents[closestIndex]
            if (closest?.dependencies?.[e.name].version === e.version) {
                return
            }

            const _entry = formatNpm1LockfileEntry(e)
            const _parents = [_entry, ...parents]
            const parent = closest
                ? _parents[closestIndex]
                : _parents[_parents.length - 1]

            if (!parent.dependencies) {
                parent.dependencies = {}
            }
            parent.dependencies[e.name] = _entry

            nodes.push(parent)
            queue.push([e.name, e.version, _parents])
        })

        queue.forEach(([name, version, parents]) => processEntry(name, version, parents))
    }

    deptree.forEach((chain) => {
        const entry = chain[chain.length - 1]
        const {name} = entry

        if (!nmtree.dependencies[name]) {
            nmtree.dependencies[name] = formatNpm1LockfileEntry(entry)
        }
    })
    Object.entries(nmtree.dependencies).forEach(([name, entry]) => processEntry(name, entry.version, [entry, nmtree] as TNpm1LockfileEntry[]))

    nodes.forEach((node) => {
        sortObject(node.dependencies || {})

        if (node.requires) {
            const snap1 = Object.entries(node.requires).map(([name, range]) => `${name}@${range}`).join('')
            const snap2 = Object.entries(node.dependencies || {}).map(([name, {version}]) => `${name}@${version}`).join('')

            if (snap1 === snap2) {
                delete node.requires
            }
        }
    })

    // fs.writeFileSync('temp/test.json', JSON.stringify(lf, null, 2))
    // fs.writeFileSync('temp/tree.json', JSON.stringify(
    //     deptree.map(c => c.map(e => `${e.name}@${e.version}`).join(' > ')),
    //     null,
    //     2
    // ))

    return lf
}

export const format = async (snap: TSnapshot): Promise<string> =>
    JSON.stringify(await preformat(snap), null, 2)

