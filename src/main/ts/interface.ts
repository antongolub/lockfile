export type TLockfileFormat = 'npm-1' | 'npm-2' | 'yarn-1' | 'yarn-5' | 'yarn-6' | 'yarn-7'

export type TScope = 'prod' | 'dev' | 'peer' | 'opt'

export type TSourceType = 'npm' | 'gh' | 'file' | 'workspace'

export type TDependencies = Record<string, string>

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
    dependencies?: TDependencies
    optionalDependencies?: TDependencies
    sourceType?: TSourceType
    source?: string
}

export interface TManifest {
    name: string
    dependencies?: TDependencies
    devDependencies?: TDependencies
    peerDependencies?: TDependencies
    optionalDependencies?: TDependencies
    [key: string]: any
}

export interface TWorkspace {
    name: string
    path: string // relative to the root of the workspace
    manifest: TManifest
}

export interface TSnapshot {
    format: TLockfileFormat
    entries: Record<string, TLockfileEntry>
    workspaces: Record<string, TWorkspace>
}

export interface TParseOptions {
    cwd?: string
    lockfile?: string
    workspaces?: Record<string, TWorkspace>
}

export type IParse = {
    (data: string, opts?: TParseOptions): Promise<TSnapshot>
    (opts?: TParseOptions): Promise<TSnapshot>
}

export type IFormatOptions = {
    format: TLockfileFormat
}

export type IFormat = {
    (data: TSnapshot, opts?: IFormatOptions): Promise<string>
}
