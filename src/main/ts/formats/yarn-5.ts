// https://github.com/yarnpkg/berry/commit/2f9e8073d15745f9d53e6b8b42fa9c81eb143d54

import {load, dump} from 'js-yaml'
import {ICheck, IFormat, IParse, IPreformat, TDependencies, TDependenciesMeta, TSnapshot} from '../interface'
import {parseIntegrity} from '../common'

export type TYarn5Lockfile = Record<string, {
    version: string
    resolution: string
    conditions?: string
    checksum: string
    languageName: string
    linkType: string
    dependencies?: TDependencies
    dependenciesMeta?: TDependenciesMeta
    optionalDependencies?: TDependencies
    peerDependencies?: TDependencies
    peerDependenciesMeta?: TDependenciesMeta
    bin?: Record<string, string>
}>

export const version = 'yarn-5'

export const check: ICheck = (value: string): boolean => value.includes(`
__metadata:
  version: 5
`)

export const parse: IParse = (lockfile: string, pkg: string): TSnapshot => {
    const manifest = JSON.parse(pkg)
    const snapshot: TSnapshot = {}

    const raw = load(lockfile) as TYarn5Lockfile

    delete raw.__metadata

    Object.entries(raw).forEach((value) => {
        const [_key, _entry] = value
        const chunks = _key.split(', ')
        const ranges = chunks.map(r => r.slice(r.lastIndexOf('@') + 1)).sort()
        const { version, checksum, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, resolution: source, bin, conditions } = _entry
        const name = chunks[0].slice(0, chunks[0].lastIndexOf('@'))
        const key = `${name}@${version}`
        const hashes = parseIntegrity(checksum)

        snapshot[key] = {
            name,
            version,
            ranges,
            hashes,
            dependencies,
            dependenciesMeta,
            optionalDependencies,
            peerDependencies,
            peerDependenciesMeta,
            source,
            bin,
            conditions,
        }
    })

    snapshot[""] = {
        name: manifest.name,
        version: manifest.version,
        ranges: [],
        hashes: {},
        manifest,
        dependencies: manifest.dependencies
    }

    return snapshot
}

export const preformat: IPreformat<TYarn5Lockfile> = (snapshot: TSnapshot): TYarn5Lockfile => {
    const lf: TYarn5Lockfile = {}

    Object.values(snapshot).forEach((entry) => {
        const { name, version, ranges, hashes: {checksum}, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, source, bin, conditions } = entry
        const key = ranges.map(r => `${name}@${r}`).join(', ')
        const isLocal = version === '0.0.0-use.local'
        const languageName = isLocal ? 'unknown' : 'node'
        const linkType = isLocal ? 'soft' : 'hard'

        lf[key] = {
            version,
            resolution: source as string,
            dependencies,
            dependenciesMeta,
            optionalDependencies,
            peerDependencies,
            peerDependenciesMeta,
            bin,
            checksum: checksum as string,
            conditions,
            languageName,
            linkType,
        }
    })

    delete lf[""]

    return lf
}

export const format: IFormat = (snapshot: TSnapshot): string => {
    const lines = dump({
        __metadata: {
            version: 5,
            cacheKey: 8,
        },
        ...preformat(snapshot)
    }, {
        quotingType: '"',
        flowLevel: -1,
        lineWidth: -1,
        forceQuotes: false
    })
        .split('\n')
        .map(line => {
            if (line === '__metadata:') {
                return `\n${line}`
            }

            if (line.length !==0 && line.charAt(0) !== ' ') {
                return `\n"${line.replaceAll('"', '').slice(0, -1)}":`
            }

            if (line.startsWith('  resolution: ')) {
                return line.replaceAll('"', '').replace('  resolution: ', '  resolution: "').concat('"')
            }

            return line
        })

    const _value = lines.join('\n')

    return `# This file is generated by running "yarn install" inside your project.
# Manual changes might be lost - proceed with caution!
${_value}`
}