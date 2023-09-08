import {load, dump} from 'js-yaml'
import {TDependencies, TSnapshot, THashes, ICheck, IFormat, IParse, TMeta} from '../interface'
import {parseIntegrity} from '../common'

const kvEntryPattern = /^(\s+)"?([^"]+)"?\s"?([^"]+)"?$/

export type TYarn1Lockfile = Record<string, {
    version: string
    resolved: string
    integrity: string
    dependencies?: TDependencies
    optionalDependencies?: TDependencies
}>

export const version = 'yarn-1'

export const check: ICheck = (value: string): boolean => value.includes('# yarn lockfile v1')

export const preparse = (value: string): TYarn1Lockfile  => {
    const lines = value.split('\n')
    const _value = lines.map((line) => {
        if (line.startsWith('#')) {
            return ''
        }

        // "@babel/code-frame@^7.0.0", "@babel/code-frame@^7.12.13"
        if (line.length !==0 && line.charAt(0) !== ' ') {
            return `"${line.replaceAll('"', '').slice(0, -1)}":`
        }

        const [,p,k,v]: string[] = line.match(kvEntryPattern) || []
        if (line.match(kvEntryPattern)) {
            return `${p}"${k}": "${v}"`
        }

        return line
    }, '').join('\n')

    return load(_value) as TYarn1Lockfile
}

export const parse: IParse = (value: string, pkg: string): TSnapshot => {
    const meta: TMeta = {}
    const manifest = JSON.parse(pkg)
    const raw = preparse(value)
    const snapshot: TSnapshot = {
        entries: {},
        workspaces: {},
        manifest,
        meta,
    }

    Object.entries(raw).forEach((value) => {
        const [_key, _entry] = value
        const chunks = _key.split(', ')
        const ranges = chunks.map(r => r.slice(r.lastIndexOf('@') + 1)).sort()
        const { version, integrity, dependencies, optionalDependencies, resolved: source } = _entry
        const name = chunks[0].slice(0, chunks[0].lastIndexOf('@'))
        const key = `${name}@${version}`
        const hashes = parseIntegrity(integrity)

        snapshot.entries[key] = {
            name,
            version,
            ranges,
            hashes,
            dependencies,
            optionalDependencies,
            source,
        }
    })

    return snapshot
}

export const preformat = (value: TSnapshot): TYarn1Lockfile => {
    const lf: TYarn1Lockfile = {}

    Object.values(value.entries).forEach((entry) => {
        const { name, version, ranges, hashes, dependencies, optionalDependencies, source } = entry
        const key = ranges.map(r => `${name}@${r}`).join(', ')
        const integrity = Object.entries(hashes).map(([k, v]) => `${k}-${v}`).join(' ')

        lf[key] = {
            version,
            resolved: source as string,
            integrity,
            dependencies,
            optionalDependencies,
        }
    })

    return lf
}

export const format: IFormat = (value: TSnapshot): string => {
    const lf = preformat(value)
    const lines: string[] = dump(lf, {
        quotingType: '"',
        flowLevel: -1,
        lineWidth: -1,
        forceQuotes: true
    }).split('\n')
    const _value = lines.map((line) => {
        // "@babel/code-frame@^7.0.0", "@babel/code-frame@^7.12.13"
        if (line.length !==0 && line.charAt(0) !== ' ') {
            const chunks = line.slice(0, -1).replaceAll('"', '').split(', ').map(chunk => chunk.startsWith('@') || chunk.includes(' ') ? `"${chunk}"` : chunk)
            return `\n${chunks.join(', ')}:`
        }

        if (line.startsWith('  integrity')) {
            const _line = line.replace(':', '')

            return line.includes('= ') // multiple hashes
                ? _line.replaceAll('"integrity"', 'integrity')
                : _line.replaceAll('"', '')
        }

        if (line.endsWith('ependencies:')) {
            return line
        }

        return line.replace(':', '')
    }, '').join('\n')

    return `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

${_value}`
}
