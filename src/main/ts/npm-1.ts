import {TDependencies, TLockfileEntry, TSnapshot} from './interface'
import {parseIntegrity} from './util'

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

export const parse = async (value: string): Promise<TSnapshot> => {
    const raw: TNpm1Lockfile = await JSON.parse(value)
    const entries: Record<string, TLockfileEntry> = {}
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

        if (name === 'wrap-ansi') {
            console.log(entry)
        }

        extractEntries(entry.dependencies, deps, ...parents)
        extractRanges(entry.requires, entry.dependencies || {}, deps, ...parents)


    })

    extractEntries(raw.dependencies)

    console.log('!!!', entries)

    return {
        format: 'npm-1',
        entries
    }
}

export const format = async (snap: TSnapshot): Promise<string> => {
    return '""'
}

