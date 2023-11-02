// https://github.com/yarnpkg/berry/commit/2f9e8073d15745f9d53e6b8b42fa9c81eb143d54

import {load, dump} from 'js-yaml'
import {
    ICheck,
    IFormat,
    IFormatOpts,
    IParse,
    IParseResolution,
    IPreformat,
    TDependencies,
    TDependenciesMeta,
    TSnapshot,
    TSnapshotIndex, TSource,
    TSourceType
} from '../interface'
import {normalizeDeps, normalizeReference, parseIntegrity, processDeps, referenceKeysSorter} from '../common'
import {debug, sortObject, unique} from '../util'

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

export const parse: IParse = (lockfile: string, pkg: string): TSnapshot => {
    const manifest = JSON.parse(pkg)
    const snapshot: TSnapshot = {}
    const raw = load(lockfile) as TYarn5Lockfile

    delete raw.__metadata

    Object.entries(raw).forEach((value) => {
        const [_key, _entry] = value
        const { version, checksum, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, resolution, bin, conditions } = _entry
        const chunks = _key.split(', ')
        const name = _key.slice(0, _key.indexOf('@', 1))
        const key = `${name}@${version}`
        const names = unique(chunks.map(c => c.slice(0, c.indexOf('@', 1))))

        for (const name of names) {
            // seems like a patch
            if (_key.includes('#')) {
                snapshot[key].patch = {
                    resolution,
                    refs: chunks,
                    checksum
                }
                return
            }

            const ranges = chunks.filter(c => c.startsWith(`${name}@`)).map(r => r.slice(r.indexOf('@', 1) + 1)).map(normalizeReference)//.sort()
            const hashes = parseIntegrity(checksum)
            const source = parseResolution(resolution)

            snapshot[key] = {
                name,
                version,
                ranges,
                hashes,
                source,
                dependencies: normalizeDeps(dependencies),
                dependenciesMeta,
                optionalDependencies: normalizeDeps(optionalDependencies),
                peerDependencies: normalizeDeps(peerDependencies),
                peerDependenciesMeta,
                bin,
                conditions,
            }

            if (source.type === 'workspace') {}
        }
    })

    snapshot[""] = {
        name: manifest.name,
        version: manifest.version,
        ranges: [],
        hashes: {},
        source: {
            type: 'workspace',
            id: '.'
        },
        manifest,
        dependencies: normalizeDeps(manifest.dependencies),
        devDependencies: normalizeDeps(manifest.devDependencies)
    }

    debug.json('yarn-berry-snapshot.json', snapshot)
    return snapshot
}

export const preformat: IPreformat<TYarn5Lockfile> = (idx): TYarn5Lockfile => {
    const {snapshot} = idx
    const lf: TYarn5Lockfile = {}
    const rangemap: Record<string, {keys: string[], key: string, name: string}> = {}

    Object.values(snapshot).forEach((entry) => {
        const { name, version, ranges, hashes: {checksum}, dependencies, dependenciesMeta, optionalDependencies, peerDependencies, peerDependenciesMeta, source, patch, bin, conditions } = entry
        const resolution = formatResolution(source)
        const alias = rangemap[resolution]
        const isLocal = version === '0.0.0-use.local'
        const languageName = isLocal ? 'unknown' : 'node'
        const linkType = isLocal ? 'soft' : 'hard'
        const keys = ranges.map(r => `${name}@${formatReference(r, {semverAsNpm: true, isLocal})}`)

        if (alias) {
            keys.push(...alias.keys)
            keys.sort(referenceKeysSorter)
            delete lf[alias.key]
        }

        const key = keys.join(', ')

        rangemap[resolution] = {keys, key, name}
        lf[key] = {
            version,
            resolution,
            dependencies: formatDeps(dependencies),
            dependenciesMeta,
            optionalDependencies: formatDeps(optionalDependencies),
            peerDependencies: formatDeps(peerDependencies),
            peerDependenciesMeta,
            bin,
            checksum: checksum as string,
            conditions,
            languageName,
            linkType,
        }

        if (patch) {
            lf[patch.refs.join(', ')] = {
                ...lf[key],
                resolution: patch.resolution,
                checksum: patch.checksum,
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

type IFormatReferenceOpts = Partial<{
    semverAsNpm: boolean
    isLocal: boolean
}>

const formatReference = (input: string, opts: IFormatReferenceOpts = {}): string | number => {
    const colonPos = input.indexOf(':')
    const protocol = input.slice(0, colonPos)
    const ref = input.slice(colonPos + 1)

    if (protocol === 'git' || protocol === 'tag') {
        return ref
    }

    if (protocol === 'semver') {
        return opts.semverAsNpm && !opts.isLocal
          ? 'npm:' + ref
          : /^\d+$/.test(ref) ? +ref : ref
    }
    // TODO restore github short alias

    return input
}

const formatDeps = (deps?: TDependencies, opts?: IFormatReferenceOpts) => processDeps(deps, formatReference, opts)

export const parseResolution: IParseResolution = (input: string) => {
    const colonPos = input.indexOf(':')
    const atPos = input.indexOf('@', 1)
    const name = input.slice(0, atPos)

    if (colonPos === -1) {
        return {
            name,
            id: input.slice(atPos + 1),
            type: 'npm'
        }
    }

    // throng@https://github.com/mixmaxhq/throng.git#commit=8a015a378c2c0db0c760b2147b2468a1c1e86edf
    // x      18                 y              12          40
    if (input.includes('https://github.com')) {
        return {
            type: 'github',
            name: input.slice(atPos + 20, -52),
            id: input.slice(-40),
            alias: input.slice(0, input.indexOf('@', 1))
        }
    }

    return {
        name,
        id: input.slice(colonPos + 1),
        type: input.slice(atPos + 1, colonPos) as TSourceType
    }
}

export const formatResolution = ({name, id, type = 'npm', alias = name, hash}: TSource): string => {
    // https://github.com/yarnpkg/berry/blob/a8ea92828badb4b6a1edddae18b0a163b0c4d2c5/packages/plugin-github/sources/GithubFetcher.ts
    if (type === 'github') {
        return `${alias}@https://github.com/${name}.git#commit=${id}`
    }
    return `${name}@${type === 'semver' ? '' : type + ':'}${id}`
}