import {TDependencies, THashes, TLockfileEntry, TManifest, TSnapshot} from '../interface'
import {debugAsJson, sortObject} from '../util'
import {parseIntegrity, isProd, formatTarballUrl} from '../common'
import {analyze} from '../analyze'
import fs from "fs";

export const version = 'npm-1'

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

export const check = (lockfile: string) => lockfile.includes('  "lockfileVersion": 1')

export const parse = (lockfile: string, pkg: string): TSnapshot => {
    const lf: TNpm1Lockfile = JSON.parse(lockfile)
    const manifest: TManifest = JSON.parse(pkg)
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

export const preformat = async (snap: TSnapshot): Promise<TNpm1Lockfile> => {
    const idx = analyze(snap)
    const root = snap.manifest
    // const deptree: TLockfileEntry[][] = []
    // const fillTree = (entry: TLockfileEntry, chain: TLockfileEntry[] = []) => {
    //     const deps = idx.getDeps(entry)
    //
    //     deps
    //       .sort((a, b) =>
    //         idx.prod.has(a) && !idx.prod.has(b)
    //           ? -1
    //           : idx.prod.has(b) && !idx.prod.has(a)
    //             ? 1
    //             : a.name.localeCompare(b.name)
    //       )
    //
    //     deps.forEach((dep) => deptree.push([...chain, dep]))
    //     deps.forEach((dep) => fillTree(dep, [...chain, dep]))
    // }
    //
    // fillTree(idx.getEntry('', root.version)!)

    const deptree = Object.values(idx.tree).map(({parents, entry}) => [...parents.slice(1), entry])

    debugAsJson('deptree-legacy.json', deptree.map((entries: TLockfileEntry[]) => entries.map(e => e.name).join(',')))

    const formatNpm1LockfileEntry = (entry: TLockfileEntry): TNpm1LockfileEntry => {
        const {name, version, hashes} = entry
        const _name = name.slice(name.indexOf('/') + 1)
        const _entry: TNpm1LockfileDeps[string] = {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/${_name}-${version}.tgz`,
            integrity: formatIntegrity(hashes)
        }

        if (!idx.prod.has(entry)) {
            _entry.dev = true
        }

        if (entry.dependencies) {
            _entry.requires = entry.dependencies
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

    delete lf.dependencies[""]

    return lf
}

export const format = async (snap: TSnapshot): Promise<string> =>
    JSON.stringify(await preformat(snap), null, 2)

