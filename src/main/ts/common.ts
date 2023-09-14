import semver from 'semver'
import fs from 'node:fs/promises'
import {topo, traverseDeps} from '@semrel-extra/topo'
import {THashes, TManifest, TSnapshot} from './interface'

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

export type IReferenceDeclaration = {
  protocol: string
  raw: string
  version: string | null
  [extra: string]: any
}

const buildReference = (protocol: string, raw: string, value: string) => ({
  protocol,
  value,
  raw,
  caret: (value.startsWith('^') || value.startsWith('~')) ? value[0] : '',
  version: semver.valid(raw) || semver.coerce(raw)?.version || null
})

export const parseReference = (raw?: any): IReferenceDeclaration => {
  if (raw.startsWith('workspace:')) {
    return buildReference('workspace', raw, raw.slice(10))
  }

  if (raw.startsWith('npm:')) {
    return buildReference('npm', raw, raw.slice(4))
  }

  return buildReference('semver', raw, raw)
}

export const mapReference = (current: string, targetProtocol: string, strategy = 'inherit'): string => {
  const {caret, version, protocol} = parseReference(current)
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
