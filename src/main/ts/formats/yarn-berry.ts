// https://github.com/yarnpkg/berry/commit/2f9e8073d15745f9d53e6b8b42fa9c81eb143d54

import {load, dump} from 'js-yaml'
import {
    ICheck,
    IFormat,
    IParse,
    IPreformat,
    TDependencies,
    TDependenciesMeta,
    TSnapshot,
    TSnapshotIndex,
    TSourceType
} from '../interface'
import {parseIntegrity} from '../common'
import {sortObject} from '../util'

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

export const version = 'yarn-berry'

export const check: ICheck = (value: string): boolean => value.includes(`
__metadata:
  version:`)

const parseResolution = (resolution: string): {source: string, sourceType: TSourceType, name: string} => {
    const colonPos = resolution.indexOf(':')
    const atPos = resolution.indexOf('@', 1)
    const name = resolution.slice(0, atPos)

    if (colonPos === -1) {
        return {
            name,
            source: resolution.slice(atPos + 1),
            sourceType: 'npm'
        }
    }
    return {
        name,
        source: resolution.slice(colonPos + 1),
        sourceType: resolution.slice(atPos + 1, colonPos) as TSourceType
    }
}

const formatResolution = (name: string, source: string, sourceType: TSourceType = 'npm'): string =>
  `${name}@${sourceType === 'semver' ? '' : sourceType + ':'}${source}`

export const parse: IParse = (lockfile: string, pkg: string): TSnapshot => {
    const manifest = JSON.parse(pkg)
    const snapshot: TSnapshot = {}
    const raw = load(lockfile) as TYarn5Lockfile

    delete raw.__metadata

    Object.entries(raw).forEach((value) => {
        const [_key, _entry] = value
        const { version, checksum, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, resolution, bin, conditions } = _entry
        const chunks = _key.split(', ')
        const refs = chunks.map(parseResolution)
        const name = refs[0].name
        const key = `${name}@${version}`

        // seems like a patch
        if (_key.includes('#')) {
            snapshot[key].patch = {
                resolution,
                refs: chunks,
                checksum
            }
            return
        }


        const ranges = refs.map(r => r.source).sort()
        const {sourceType, source} = parseResolution(resolution)
        const hashes = parseIntegrity(checksum)

        snapshot[key] = {
            name,
            version,
            ranges,
            hashes,
            source,
            sourceType,
            dependencies,
            dependenciesMeta,
            optionalDependencies,
            peerDependencies,
            peerDependenciesMeta,
            bin,
            conditions,
        }

        if (sourceType === 'workspace') {}
    })

    snapshot[""] = {
        name: manifest.name,
        version: manifest.version,
        ranges: [],
        hashes: {},
        manifest,
        dependencies: manifest.dependencies,
        devDependencies: manifest.devDependencies
    }

    return snapshot
}

export const preformat: IPreformat<TYarn5Lockfile> = (idx): TYarn5Lockfile => {
    const {snapshot} = idx
    const lf: TYarn5Lockfile = {}

    Object.values(snapshot).forEach((entry) => {
        const { name, version, ranges, hashes: {checksum}, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, source, sourceType, patch, bin, conditions } = entry
        const isLocal = version === '0.0.0-use.local'
        const languageName = isLocal ? 'unknown' : 'node'
        const linkType = isLocal ? 'soft' : 'hard'
        const key = ranges.map(r => formatResolution(name, r, sourceType === 'workspace' ? ((r === '.' || r.includes('/')) ? 'workspace' : 'semver'): 'npm')).join(', ')

        lf[key] = {
            version,
            resolution: formatResolution(name, source as string, sourceType),
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

        if (patch) {
            lf[patch.refs.join(', ')] = {
                version,
                resolution: patch.resolution,
                dependencies,
                dependenciesMeta,
                optionalDependencies,
                peerDependencies,
                peerDependenciesMeta,
                bin,
                checksum: patch.checksum,
                conditions,
                languageName,
                linkType,
            }
        }

    })

    delete lf[""]

    return sortObject(lf)
}

export const format: IFormat = (snapshot: TSnapshot, {__metadata = {
    version: 5,
    cacheKey: 8,
}} = {}): string => {
    const lines = dump({
        __metadata,
        ...preformat({snapshot} as TSnapshotIndex)
    }, {
        quotingType: '"',
        flowLevel: -1,
        lineWidth: -1,
        forceQuotes: false,
        noRefs: true
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