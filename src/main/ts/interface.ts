export type TLockfileFormat = 'npm-1' | 'npm-2' | 'npm-3' | 'yarn-1' | 'yarn-5' | 'yarn-6' | 'yarn-7'

export type TScope = 'prod' | 'dev' | 'peer' | 'opt'

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



    scope?: TScope
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
    format: TLockfileFormat
    manifest: TManifest // root level package.json
    entries: Record<string, TLockfileEntry>
    workspaces: Record<string, TWorkspace>
}

export interface TParseOptions {
    cwd?: string
    lockfile?: string
    workspaces?: Record<string, TWorkspace>
}

export type IParse = (lockfile: string, ...pkgJsons: string[]) => TSnapshot

export type IFormat = (snapshot: TSnapshot) => string

export type ICheck = (input: string) => boolean

export type IFormatOptions = {
    format: TLockfileFormat
}
