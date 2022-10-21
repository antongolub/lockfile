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
        upsertEntry(name, entry.version, {
            hashes: parseIntegrity(entry.integrity),
            dependencies: entry.requires
        })

        extractEntries(entry.dependencies, deps, ...parents)
        extractRanges(entry.requires, entry.dependencies || {}, deps, ...parents)
    })

    extractEntries(lf.dependencies)
    extractRanges(entries[""].dependencies, lf.dependencies || {})

    return {
        format: 'npm-1',
        entries: sortObject(entries),
        workspaces,
    }
}

const s = new Set()
let i = 0

const resolveDepChain = (entry: any, chains: TLockfileEntry[][] = [], chain: TLockfileEntry[] = [], ) => {
    const _chain = [...chain, entry]

    if (!entry.dependants) {
        chains.push(_chain)
        i++
        // console.log(_chain.map((e) => e.name).join('>'))
        s.add(_chain.map((e) => e.name).join('>'))

        return
    }

    entry.dependants.forEach((e: any) =>resolveDepChain(e, chains, _chain))
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
                target.dependants = (target.dependants || [])

                // @ts-ignore
                target.dependants.push(entry)

                // console.log(entry.name, '>', target.name,  target.ranges)
            }
        })

    })

    const tree: TLockfileEntry[][] = []
    entries.forEach((entry) => {
        resolveDepChain(entry, tree)
    })

    //console.log(i, s.size)

    // console.log(tree.map(a => a.map(b => b.name).join('>') ))

    // const firstLevel: Map<string, TLockfileEntry> = new Map()
    const entriesIndex: Map<TLockfileEntry, TNpm1LockfileEntry> = new Map()
    const formatNpm1LockfileEntry = (entry: TLockfileEntry, dev: boolean = false): TNpm1LockfileEntry => {
        if (entriesIndex.has(entry)) {
            return entriesIndex.get(entry)!
        }

        const {name, version, hashes} = entry
        const _name = name.slice(name.indexOf('/') + 1)
        const _entry: TNpm1LockfileDeps[string] = {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/${_name}-${version}.tgz`,
            integrity: formatIntegrity(hashes)
        }

        if (dev) {
            _entry.dev = true
        }

        if (entry.dependencies) {
            _entry.requires = entry.dependencies
        }

        entriesIndex.set(entry, _entry)

        return _entry
    }

    // const getRootDeps = (deps?: TDependencies): TLockfileEntry[] =>
    //     deps
    //         ? Object.entries(deps).map(([name, range]) =>
    //             entries.find((e) => e.name === name && e.ranges.includes(range)) as TLockfileEntry)
    //         : []
    // const prodDeps = getRootDeps(root.dependencies)
    // const devDeps = getRootDeps(root.devDependencies)


    const processEntry = (entry: TLockfileEntry, path: string[] = [], dev: boolean = false) => {
        const {name, version} = entry
        const _entry = formatNpm1LockfileEntry(entry, dev)


        path.shift()

        // console.log(name, path.join('>'))


        let node: {dependencies?: TNpm1LockfileDeps} = lf
        do {
            if (!node.dependencies) {
                node.dependencies = {}
            }

            if (!node.dependencies[name]) {
                node.dependencies[name] = _entry
                return
            }

            if (node.dependencies[name].version === version) {
                return
            }

            node = node.dependencies[path.shift()!]
        } while (node)





    }



    const isDev = (manifest: TManifest, name: string): boolean => !manifest.dependencies?.[name] && !!manifest.devDependencies?.[name]

    tree
        .sort((a, b) => a.length - b.length)
        .forEach((chain) => {
            const _chain = [...chain].reverse().slice(1)
            const path = _chain.map((e) => e.name)
            _chain.forEach((entry, i) =>
                processEntry(entry, path.slice(i), isDev(root, path[0]))
            )
        })
    tree.forEach((branch) => {
        branch.reverse().slice(1).forEach((entry, i) => {

            // const {name} = entry
            // const parent = branch[i]
            // const _entry = formatNpm1LockfileEntry(entry, parent, isDev(root, branch[1]?.name))
            //
            // if (!firstLevel.has(name)) {
            //     (lf.dependencies as TNpm1LockfileDeps)[name] = _entry
            //
            //     // console.log('name', name, (lf.dependencies as TNpm1LockfileDeps)[name])
            //
            //     firstLevel.set(name, entry)
            //     return
            // }
            //
            // parent.dependencies = parent.dependencies || {}
            // parent.dependencies[name] = _entry

            //
            // const {name, version, hashes} = entry
            // const _name = name.slice(name.indexOf('/') + 1)
            // const _entry: TNpm1LockfileDeps[string] = {
            //     version,
            //     resolved: `https://registry.npmjs.org/${name}/-/${_name}-${version}.tgz`,
            //     integrity: formatIntegrity(hashes)
            // }
            // const parent = branch[i]
            // const parentName = branch[1]?.name
            //
            // if (!root.dependencies?.[parentName] && root.devDependencies?.[parentName]) {
            //     //console.log('!!parentName', parentName, name)
            //     _entry.dev = true
            // }
            // // console.log(branch.map(b => b.name).join('>'))
            //
            // _entry.requires = entry.dependencies
            //
            // if (!firstLevel.has(name)) {
            //     (lf.dependencies as TNpm1LockfileDeps)[name] = _entry
            //
            //     firstLevel.set(name, entry)
            //     return
            // }
            //
            // // if (i > 0 && parent.name?.requires?.[name]) {
            //
            // if (_entry.requires) {
            //     const _dependencies = Object.entries(_entry.requires).reduce((acc, [name, value]) => {
            //
            //         return acc
            //     }, {})
            // }



            // const parent
        })
    })

    // @ts-ignore
    lf.dependencies = sortObject(lf.dependencies)


    // console.log(firstLevel)


// console.log('snap.workspaces', snap)

    fs.writeFileSync('temp/test.json', JSON.stringify(lf, null, 2))


    return JSON.stringify(lf, null, 2)
}

