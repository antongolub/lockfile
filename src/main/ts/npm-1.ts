import {TDependencies, THashes, TLockfileEntry, TManifest, TSnapshot} from './interface'
import {parseIntegrity, sortObject} from './util'
import fs from 'fs'

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
    requires: true
    dependencies?: TNpm1LockfileDeps
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
    }
}


const formatIntegrity = (hashes: THashes): string => Object.entries(hashes).map(([key, value]) => `${key}-${value}`).join(' ')

export const format = async (snap: TSnapshot): Promise<string> => {
    const root = snap.workspaces[''].manifest
    const lf: TNpm1Lockfile = {
        name: root.name,
        version: root.version,
        lockfileVersion: 1,
        requires: true,
        dependencies: {}
    }

    const entries = Object.values(snap.entries)

    entries.forEach((entry) => {
        entry.dependencies && Object.entries(entry.dependencies).forEach(([_name, range]) => {
            const target = entries.find(({name, ranges}) => name === _name && ranges.includes(range))
            if (target) {
                // @ts-ignore
                target.dependants = target.dependants || []

                // @ts-ignore
                target.dependants.push(entry)

                // @ts-ignore
                entry._dependencies = entry._dependencies || []

                // @ts-ignore
                entry._dependencies.push(target)
            }
        })
    })

    const deptree: TLockfileEntry[][] = []
    const proddeps = new Set()
    const isProd = (manifest: TManifest, name: string): boolean => !!manifest.dependencies?.[name]

    const fillTree = (entry: TLockfileEntry, chain: TLockfileEntry[] = []) => {
        const deps = entry._dependencies || []
        deps.forEach(c => isProd(root, chain[0]?.name || c.name) && proddeps.add(c))

        deps
            .sort((a, b) =>
                proddeps.has(a) && !proddeps.has(b)
                    ? -1
                    : proddeps.has(b) && !proddeps.has(a)
                        ? 1
                        : a.name.localeCompare(b.name)
            )

        deps.forEach((dep) => deptree.push([...chain, dep]))
        deps.forEach((dep) => fillTree(dep, [...chain, dep]))
    }

    const getEntry = (name: string, version: string) => entries.find((e) => e.name === name && e.version === version)
    fillTree(getEntry(root.name, root.version)!)

    const formatNpm1LockfileEntry = (entry: TLockfileEntry): TNpm1LockfileEntry => {
        const {name, version, hashes} = entry
        const _name = name.slice(name.indexOf('/') + 1)
        const _entry: TNpm1LockfileDeps[string] = {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/${_name}-${version}.tgz`,
            integrity: formatIntegrity(hashes)
        }

        if (!proddeps.has(entry)) {
            _entry.dev = true
        }

        if (entry.dependencies) {
            _entry.requires = entry.dependencies
        }

        return _entry
    }

    const nmtree: any = lf
    const nodes = [nmtree]
    const processEntry = (name: string, version: string, parents: any) => {
        const entry = getEntry(name, version)!

        if (entry._dependencies) {
            const queue = []
            entry._dependencies.forEach((e) => {
                const closestIndex = parents.findIndex((p) => p.dependencies?.[e.name])
                const closest = parents[closestIndex]
                if (closest?.dependencies[e.name].version === e.version) {
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
    }

    deptree.forEach((chain) => {
        const entry = chain[chain.length - 1]
        const {name} = entry

        if (!nmtree.dependencies[name]) {
            nmtree.dependencies[name] = formatNpm1LockfileEntry(entry)
        }
    })
    Object.entries(nmtree.dependencies).forEach(([name, entry]) => processEntry(name, entry.version, [entry, nmtree]))

    nodes.forEach((node) => {
        sortObject(node.dependencies)

        if (node.requires) {
            const snap1 = Object.entries(node.requires).map(([name, range]) => `${name}@${range}`).join('')
            const snap2 = Object.entries(node.dependencies).map(([name, {version}]) => `${name}@${version}`).join('')

            if (snap1 === snap2) {
                delete node.requires
            }
        }
    })

    fs.writeFileSync('temp/test.json', JSON.stringify(lf, null, 2))
    fs.writeFileSync('temp/tree.json', JSON.stringify(
        deptree.map(c => c.map(e => `${e.name}@${e.version}`).join(' > ')),
        null,
        2
    ))

    return JSON.stringify(lf, null, 2)
}

