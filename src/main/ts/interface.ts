
export type TSourceType = 'npm' | 'gh' | 'file' | 'workspace' | 'semver'

export type TDependencies = Record<string, string>

export type TDependenciesMeta = Record<string, { optional: boolean }>

export interface TMetaEntry {
    conditions?: string
    dependencies?: TDependencies
    dependenciesMeta?: TDependenciesMeta
    optionalDependencies?: TDependencies
    peerDependencies?: TDependencies
    peerDependenciesMeta?: TDependenciesMeta
    bin?: Record<string, string>
    engines?: Record<string, string>
    funding?: Record<string, string>
    [index: string]: any
}

export type TMeta = Record<string, TMetaEntry>

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

    conditions?: string
    dependencies?: TDependencies
    dependenciesMeta?: TDependenciesMeta
    optionalDependencies?: TDependencies
    peerDependencies?: TDependencies
    peerDependenciesMeta?: TDependenciesMeta
    sourceType?: TSourceType
    source?: string
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

export interface TSnapshot {
    manifest: TManifest // root level package.json
    entries: Record<string, TLockfileEntry>
    workspaces: Record<string, TWorkspace>
    meta: TMeta
}

export type IParse = (lockfile: string, ...pkgJsons: string[]) => TSnapshot

export type IFormat = (snapshot: TSnapshot) => string

export type ICheck = (input: string) => boolean
