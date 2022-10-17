import {TDependencies, TLockfileEntry, TManifest, TSnapshot} from './interface'
import {parseIntegrity, sortObject} from './util'

export type TNpm1LockfileDeps = Record<string, {
    version: string
    resolved: string
    integrity: string
    dev?: boolean
    requires?: Record<string, string>
    dependencies?: TNpm1LockfileDeps
}>

export type TNpm1Lockfile = {
    lockfileVersion: 1
    name: string
    version: string
    requires: true
    dependencies?: TNpm1LockfileDeps
}

export const parse = async (lockfile: string, pkg: string): Promise<TSnapshot> => {
    const lf: TNpm1Lockfile = await JSON.parse(lockfile)
    const pkgJson: TManifest = await JSON.parse(pkg)
    const entries: Record<string, TLockfileEntry> = {
        "": {
            name: pkgJson.name,
            version: pkgJson.version,
            dependencies: {
                ...pkgJson.dependencies,
                ...pkgJson.devDependencies,
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
    }
}

const resolveDepChain = (entry: any, chains: string[][] = [], chain: string[] = [], ) => {
    const _chain = [...chain, entry.name]


    entry.dependants?.forEach((e: any) => {
        resolveDepChain(e, chains, _chain)
    })

    if (!entry.dependants) {
        chains.push(_chain)
    }
}

export const format = async (snap: TSnapshot): Promise<string> => {
    const lf: TNpm1Lockfile = {
        name: 'zx',
        version: '7.1.0',
        lockfileVersion: 1,
        requires: true,
        dependencies: {}
    }

    let i = 0

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

    const tree: string[][] = []

    entries.forEach((entry) => {
        resolveDepChain(entry, tree)
    })

    console.log(tree)

    const firstLevel = new Map()



    return JSON.stringify(lf, null, 2)
}

