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
    const formatNpm1LockfileEntry = (entry: TLockfileEntry, dev: boolean = false): TNpm1LockfileEntry => {
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

        return _entry
    }

    // const getRootDeps = (deps?: TDependencies): TLockfileEntry[] =>
    //     deps
    //         ? Object.entries(deps).map(([name, range]) =>
    //             entries.find((e) => e.name === name && e.ranges.includes(range)) as TLockfileEntry)
    //         : []


    type TD = {dependencies?: TNpm1LockfileDeps}

    const processEntry = (entry: TLockfileEntry, path: TLockfileEntry[] = [], dev: boolean = false) => {
        const {name, version} = entry
        const _entry = formatNpm1LockfileEntry(entry, dev)


        if (name === 'semver') {
            console.log(name, version, path.map((e) => `${e.name}@${e.version}`).join('>'))
        }

        //const hasNoSamePkgInParentDeps = path.every(p => !p.dependencies?.[name])

        // console.log(name, path.map(e => e.name).join('>'))

        let node: TD = lf

        if (!lf.dependencies) {
            lf.dependencies = {}
        }


        if (!lf.dependencies[name]) {
            lf.dependencies[name] = _entry
            return
        }

        if (lf.dependencies[name]?.version === version) {
            return
        }

        // find the closest parent for injection

        const parentRefs = path.reduce((m, {name, version}, i) => {
            if (lf.dependencies?.[name]?.version === version) {
                m.push(lf.dependencies?.[name])
            } else {
                m.push(m[i - 1]?.dependencies?.[name] as TD)
            }

            return m
        }, [] as TD[])

        for (const p of parentRefs) {
            if (!p.dependencies) {
                p.dependencies = {}
                return
            }

            if (!p.dependencies[name]) {
                // @ts-ignore
                const _v = p.requires?.[name]

                if (_v && !entry.ranges.includes(_v)) {
                    continue
                }

                p.dependencies[name] = _entry
                return
            }

            if (p.dependencies[name]?.version === version) {
                return
            }
        }

        if (name === 'semver') {
            console.log('wtf?!')
        }



        // console.log(parentRefs.length)



        // // finds the first parent that requires the entry
        // const from = path.findIndex((p) =>
        //     entry.ranges.includes(p.dependencies?.[name] as string))
        //
        //
        // // searches the first parent that exists in the lockfile
        // const to = path.slice(0, from).reverse().findIndex((p) =>
        //     lf.dependencies?.[p.name]?.version === p.version)
        //
        // const _path = path.slice(from - to, from)
        //
        // const node = _path.reduce((m, {name}) => {
        //
        //
        //    return m.dependencies?.[name] as TD
        //
        // }, lf as TD)
        //
        // if (!node) {
        //     console.log(name, version, path.map((e) => e.name).join('>'))
        //     console.log(_path)
        //     console.log(from, to)
        //     console.log(lf.dependencies[_path[0].name])
        //     console.log(lf.dependencies[_path[1]?.name])
        //
        //     throw new Error('node not found')
        // }
        //
        // if (!node.dependencies) {
        //     node.dependencies = {}
        // }
        //
        // if (node.dependencies[name]?.version === version) {
        //     node.dependencies[name] = _entry
        // }


















        // const hasNoPkgInParentDeps = path.every(p => !p?.dependencies?.[name])
        //
        // let node: {dependencies?: TNpm1LockfileDeps} = lf
        //
        // if (!node.dependencies) {
        //     node.dependencies = {}
        // }
        //
        // if (!node.dependencies[name] && hasNoPkgInParentDeps) {
        //
        //     node.dependencies[name] = _entry
        //     return
        // }
        //
        // if (node.dependencies[name]?.version === version) {
        //     if (node.dependencies[name].dev && !dev) {
        //         delete node.dependencies[name].dev
        //     }
        //     return
        // }
        //
        // const from = path.findIndex((p) => {
        //         return entry.ranges.includes(p.dependencies?.[name] as string)
        //
        //         })
        //
        //
        // const to = path.slice(0, from).reverse().findIndex((p) =>
        //     lf.dependencies?.[p.name]?.version === p.version
        // )



        // const parent = path.find(({name: _name, version: _version}) => {
        //     const dep = node.dependencies[_name]
        //
        //     return dep?.version === _version && entry.ranges.includes(dep?.requires?.[name] as string)
        // })?.name


        // do {
        //     if (!node.dependencies) {
        //         node.dependencies = {}
        //     }
        //
        //     if (!node.dependencies[name]) {
        //         if (path.every(p => !p?.dependencies?.[name])) {
        //             node.dependencies[name] = _entry
        //             return
        //         }
        //     }
        //
        //     if (node.dependencies?.[name]?.version === version) {
        //         if (node.dependencies[name].dev && !dev) {
        //             delete node.dependencies[name].dev
        //         }
        //         return
        //     }
        //
        //     const parent = path.find(({name: _name, version: _version}) => {
        //         const dep = node?.dependencies?.[_name]
        //
        //         return dep?.version === _version && entry.ranges.includes(dep?.requires?.[name] as string)
        //     })?.name
        //
        //     node = parent ? node.dependencies[parent] : undefined

        //} while (node)
    }



    const isDev = (manifest: TManifest, name: string): boolean => !manifest.dependencies?.[name] && !!manifest.devDependencies?.[name]


    // getRootDeps(root.dependencies).forEach((entry) => processEntry(entry, [], false))
    // getRootDeps(root.devDependencies).forEach((entry) => processEntry(entry, [], true))

    // console.log(JSON.stringify(lf, null, 2))

    // tree
    //    .sort((a, b) => a.map(({name}) => name).join().localeCompare(b.map(({name}) => name).join()))
    //    .forEach((chain) => {
    //         const _chain = [...chain].reverse().slice(1)
    //
    //         _chain.forEach((entry, i) =>
    //             processEntry(entry, [..._chain.slice(0, i)].reverse(), isDev(root, _chain[0].name))
    //         )
    //     })



    tree.sort((a, b) =>
        a.length > b.length
            ? 1
            : a.length < b.length
                ? -1
                : (a.map(_ => _.name).join('') > b.map(_ => _.name).join('') ? 1 : -1))

        .map((chain) => chain.slice(0, -1).reverse())


        // .sort((a, b) =>
        //    (a.map(_ => _.name).join('') > b.map(_ => _.name).join('') ? 1 : -1))
        // .reduce((m, chain) => {
        //     const [rootDeps, subDeps] = m
        //
        //     if (chain.length > 1) { subDeps.push(chain) }
        //     if (chain.length === 1) { rootDeps.push(chain) }
        //
        //     return m
        // }, [[], []] as [TLockfileEntry[][], TLockfileEntry[][]])
        // .flat(1)



        //.sort((a, b) => a.map(_ => _.name).join('') > b.map(_ => _.name).join('') ? 1 : -1)
        // .reduce((m, chain) => {
        //         const l = chain.length
        //
        //         if (l) {
        //             m[l] = m[l] || []
        //             m[l].push(chain)
        //         }
        //
        //         return m
        //     }, [] as TLockfileEntry[][][])
        //     .flat(1)

        // .reduce((m, chain) => {
        //     const [rootDeps, subDeps] = m
        //
        //     if (chain.length > 1) { subDeps.push(chain) }
        //     if (chain.length === 1) {
        //         rootDeps.push(chain)
        //     }
        //
        //     return m
        // }, [[], []] as [TLockfileEntry[][], TLockfileEntry[][]])
        // .flat(1)

        .forEach((chain) => {
            // console.log(chain.map(({name}) => name).join('>'))
            // // const _chain = chain.slice(1) // trim manifest.root

            chain.forEach((entry, i) =>
                processEntry(entry, chain.slice(0, i), isDev(root, chain[0].name))
            )
        })

    // tree
    //     .map((chain) => chain.reverse())
    //     .sort((a, b) => a.map(_ => _.name).join('>') > b.map(_ => _.name).join('>') ? 1 : -1)
    //
    // console.log(tree.map(a => a.map(b => b.name).join('>') ))
    //
    // const [prod, dev] = tree
    //     .map((chain) => chain.reverse())
    //     .sort((a, b) => a.map(_ => _.name).join('>') > b.map(_ => _.name).join('>') ? 1 : -1)
    //     .reduce((m, chain) => {
    //         const [prod, dev] = m
    //         const _chain = chain.slice(1)
    //
    //         if (_chain.length > 0) {
    //             if (isDev(root, _chain[0].name)) {
    //                 dev.push(_chain)
    //             } else {
    //                 prod.push(_chain)
    //             }
    //         }
    //
    //         return m
    //     }, [[], []] as [TLockfileEntry[][], TLockfileEntry[][]])
    //
    // prod.forEach((chain) => chain.forEach((entry, i) => processEntry(entry, [...chain.slice(0, i)].reverse(), false)))
    // dev.forEach((chain) => chain.forEach((entry, i) => processEntry(entry, [...chain.slice(0, i)].reverse(), true)))
    //
    // console.log(prod.map((chain) => chain.map((e) => e.name).join('>')))
    // console.log(dev.map((chain) => chain.map((e) => e.name).join('>')))


        // @ts-ignore
    lf.dependencies = sortObject(lf.dependencies)


    // console.log(firstLevel)


// console.log('snap.workspaces', snap)

    fs.writeFileSync('temp/test.json', JSON.stringify(lf, null, 2))


    return JSON.stringify(lf, null, 2)
}

