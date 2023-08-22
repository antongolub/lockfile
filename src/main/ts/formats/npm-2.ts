import {TLockfileEntry, TManifest, TSnapshot} from '../interface'
import {parse as parseNpm1, preformat as preformatNpm1, TNpm1Lockfile} from './npm-1'
import {parseIntegrity} from "../common";
import {sortObject} from "../util";
import fs from 'node:fs'

export type TNpm2LockfileEntry = {
    version: string
    resolved: string
    integrity: string
    dev?: boolean
    requires?: Record<string, string>
    dependencies?: TNpm2LockfileDeps,
    engines?: Record<string, string>
    funding?: Record<string, string>
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

export const parse = async (lockfile: string): Promise<TSnapshot> => {
    const lfraw = await JSON.parse(lockfile)
    const entries = await parsePackages(lockfile)
    const npm1snap = await parseNpm1(lockfile, JSON.stringify(lfraw.packages['']))

    fs.writeFileSync('temp/npm1.json', JSON.stringify(npm1snap.entries, null, 2))
    fs.writeFileSync('temp/npm2.json', JSON.stringify(entries, null, 2))
    return {
        ...npm1snap,
        entries,
        format: 'npm-2'
    }
}

const parsePackages = async (lockfile: string): Promise<any> => {
    const lf: TNpm2Lockfile = await JSON.parse(lockfile)
    const entries: Record<string, Record<string, TLockfileEntry>> = {}
    const upsertEntry = (name: string, version: string, extra?: Partial<TLockfileEntry>) => {
        if (!entries[name]) {
            entries[name] = {}
        }

        if (!entries[name][version]) {
            entries[name][version] = {
                name,
                version,
                ranges: [],
                hashes: {}
            }
        }

        if (extra) {
            Object.assign(entries[name][version], extra)
        }

        return entries[name][version]
    }
    const pushRange = (name: string, version: string, range: string): void => {
        const entry = upsertEntry(name, version)

        if (!entry.ranges.includes(range)) {
            entry.ranges.push(range)
            entry.ranges.sort()
        }
    }

    const getClosestEntry = (name: string, chain: string[], entries: Record<string, any>) => {
        let l = chain.length + 1

        while(l--) {
            const variant = 'node_modules/' + [...chain.slice(0, l), name].filter(Boolean).join('/node_modules/')
            const entry = entries[variant]

            if (entry) {
                return entry
            }
        }
        throw new Error(`Lockfile seems inconsistent: name=${name}, chain=${chain}`)
    }
    Object.entries(lf.packages).forEach(([path, entry]) => {
        // const name = path.slice(('/' + path).lastIndexOf('/node_modules/') + 13)
        const chain: string[] = path ? ('/' + path).split('/node_modules/').filter(Boolean) : [""]
        const name = chain[chain.length - 1] || ""

        entry.dependencies && Object.entries<string>(entry.dependencies).forEach(([_name, range]) => {
            const _entry = getClosestEntry(_name, chain, lf.packages)
            pushRange(_name, _entry.version, range)
        })

        // const [name]: string[] = ('/' + path).split('/node_modules').map(name => name.slice(1)).reverse()
        // const [name, parent]: string[] = ('/' + path).split('/node_modules').map(name => name.slice(1)).reverse()
        //
        // if (parent) {
        //
        // }

        // console.log('name=', name)

        upsertEntry(name, entry.version, {
            hashes: parseIntegrity(entry.integrity),
            dependencies: entry.dependencies,
            optionalDependencies: entry.optionalDependencies,
            engines: entry.engines,
            funding: entry.funding
        })
    })

    // TODO remove legacy cast
    return sortObject(Object.entries(entries).reduce((m,[name, set]) => {
        Object.entries(set).forEach(([version, entry]) => {
            m[`${name}@${version}`] = entry
        })
        return m
    }, {} as Record<string, any>))
}

export const format = async (snap: TSnapshot): Promise<string> => {
    const lfnpm1: TNpm1Lockfile = (await preformatNpm1(snap))
    const packages = Object.entries(lfnpm1.dependencies).reduce((m: TNpm2LockfileDeps, [name, entry]) => {
        m[`node_modules/${name}`] = {
            ...entry,
            requires: undefined,
            dependencies: entry.requires,
            engines: snap.entries[`${name}@${entry.version}`]?.engines
        }
        return m
    }, {
        "": snap.manifest
    })
    const lf = {
        name: lfnpm1.name,
        version: lfnpm1.version,
        lockfileVersion: 2,
        requires: true,
        packages,
        dependencies: lfnpm1.dependencies,
    }

    return JSON.stringify(lf, null, 2)
}
