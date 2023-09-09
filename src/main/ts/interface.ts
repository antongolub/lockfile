
export type TSourceType = 'npm' | 'gh' | 'file' | 'workspace' | 'semver'

export type TDependencies = Record<string, string>

export type TDependenciesMeta = Record<string, { optional: boolean }>

export interface THashes {
    sha512?: string
    sha256?: string
    sha1?: string
    checksum?: string
    md5?: string
}

export interface TLockfileEntry {
    name: string
    version: string
    ranges: string[]
    hashes: THashes
    source?: string
    sourceType?: TSourceType

    manifest?: TManifest
    conditions?: string
    dependencies?: TDependencies
    dependenciesMeta?: TDependenciesMeta
    optionalDependencies?: TDependencies
    peerDependencies?: TDependencies
    peerDependenciesMeta?: TDependenciesMeta
    bin?: Record<string, string>
    engines?: Record<string, string>
    funding?: Record<string, string>
}

export interface TManifest {
    name: string
    dependencies?: TDependencies
    devDependencies?: TDependencies
    optionalDependencies?: TDependencies
    peerDependencies?: TDependencies
    [key: string]: any
}

export interface TWorkspace {
    name: string
    path: string // relative to the root of the workspace
    // manifest: TManifest
}

export type TSnapshot = Record<string, TLockfileEntry>

export type IParse = (lockfile: string, ...pkgJsons: string[]) => TSnapshot

export type IFormat = (snapshot: TSnapshot) => string

export type IPreformat<T> = (snapshot: TSnapshot) => T

export type ICheck = (input: string) => boolean
