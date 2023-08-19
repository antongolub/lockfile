import {TManifest, TSnapshot} from '../interface'
import {parse as parseNpm1, preformat as preformatNpm1, TNpm1Lockfile} from './npm-1'

export type TNpm2LockfileEntry = {
    version: string
    resolved: string
    integrity: string
    dev?: boolean
    requires?: Record<string, string>
    dependencies?: TNpm2LockfileDeps,
    engines?: Record<string, string>
}

export type TNpm2LockfileDeps = Record<string, any>

export type TNpm2Lockfile = {
    lockfileVersion: 2
    name: string
    version: string
    requires?: true
    packages?: TNpm2LockfileDeps
    dependencies: TNpm2LockfileDeps
}

export const parse = async (lockfile: string): Promise<TSnapshot> => {
    const lfraw = await JSON.parse(lockfile)

    return {
        ...await parseNpm1(lockfile, JSON.stringify(lfraw.packages[''])),
        format: 'npm-2'
    }
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
