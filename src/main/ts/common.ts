import semver from 'semver'
import fs from 'node:fs/promises'
import {topo, traverseDeps} from '@semrel-extra/topo'
import {URL} from 'node:url'
import {THashes, TSnapshot} from './interface'

export const formatTarballUrl = (name: string, version: string, registry = 'https://registry.npmjs.org') =>
  `${registry}/${name}/-/${name.slice(name.indexOf('/') + 1)}-${version}.tgz`

export const getSources = (snapshot: TSnapshot): string[] =>
  Object.values(snapshot)
    .map(entry => entry.source.id)
    .filter(Boolean)

export const parseIntegrity = (integrity?: string): THashes =>
  integrity
    ? integrity.split(' ').reduce<THashes>((m, item) => {
      const [k, v] = item.split('-')
      if (k === 'sha512' || k === 'sha256' || k === 'sha1' || k === 'checksum') {
        m[k] = v
      } else if (!v){
        m['checksum'] = k
      }

      return m
    }, {})
    : {}

export const formatIntegrity = (hashes: THashes): string => {
  const checksum = hashes['checksum']
  if (checksum) {
    return checksum
  }

  return Object.entries(hashes).map(([k, v]) => `${k}-${v}`).join(' ')
}

export interface IReference {
  protocol: string
  id: string
  name?: string
  host?: string
  [extra: string]: any
}

const parseVersion = (version: string): string | null => semver.valid(version) || semver.coerce(version)?.version || null

const parseCaret = (value: string): string => (value.startsWith('^') || value.startsWith('~')) ? value[0] : ''

const parseName = (value: string): string => (value).slice(0, (value + '.').indexOf('.'))

export const parseReference = (raw?: any): IReference => {
  if (raw.startsWith('workspace:')) {
    return {
      protocol: 'workspace',
      id: raw.slice(10)
    }
  }

  if (raw.startsWith('npm:')) {
    return {
      protocol: 'npm',
      id: raw.slice(4)
    }
  }

  if (URL.canParse(raw)) {
    const url = new URL(raw)
    return {
      protocol: url.protocol.slice(0, -1),
      name: parseName(url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname),
      id: url.hash.slice(1),
      host: url.host
    }
  }

  if (raw.includes('/') && !raw.includes(':')) { // use regexp?
    const name = raw.slice(0, (raw + '#').indexOf('#'))
    return {
      protocol: 'github',
      name,
      id: raw.slice(name.length + 1)
    }
  }

  return {
    protocol: 'semver',
    id: raw,
  }
}

export const mapReference = (current: string, targetProtocol: string, strategy = 'inherit'): string => {
  const {id, protocol} = parseReference(current)
  const version = parseVersion(id)
  const caret = parseCaret(id)
  const prefix = targetProtocol === 'semver' ? '' : `${targetProtocol}:`

  if (protocol === targetProtocol) {
    return current
  }

  if (version === null) {
    return prefix + '*'
  }

  const _version = strategy === 'pin'
    ? version
    : strategy === 'inherit'
      ? (caret + version)
      : strategy

  return prefix + _version
}

/**
 * Replaces local monorepo cross-refs with the target protocol: workspace or semver
 */
export const switchMonorefs = async ({cwd, strategy, protocol = 'semver', dryrun = false}: {
  cwd?: string
  strategy?: string // 'inherit' | 'pin' | 'coerce'
  protocol?: string
  dryrun?: boolean
}) => {
  const {packages} = await topo({cwd})

  await Promise.all(Object.values(packages).map(async pkg => {
    await traverseDeps({pkg, packages, cb({name, version, deps}) {
      deps[name] = mapReference(version, protocol, strategy)
    }})

    if (dryrun) {
      return
    }

    await fs.writeFile(pkg.manifestAbsPath, JSON.stringify(pkg.manifest), 'utf8')
  }))

  return packages
}
