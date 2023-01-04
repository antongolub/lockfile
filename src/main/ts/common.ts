import {THashes, TManifest, TSnapshot} from './interface'

export const normalizeOptions = () => {

}

export const getSources = (snapshot: TSnapshot): string[] =>
  Object.values(snapshot.entries)
    .map(entry => entry.source as string)
    .filter(Boolean)

const isDepType = (type: keyof TManifest, manifest: TManifest, name: string): boolean => Boolean(manifest[type]?.[name])

export const isProd = isDepType.bind(null, 'dependencies')
export const isDev = isDepType.bind(null, 'devDependencies')
export const isPeer = isDepType.bind(null, 'peerDependencies')
export const isOptional = isDepType.bind(null, 'optionalDependencies')

export const parseIntegrity = (integrity: string): THashes =>
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