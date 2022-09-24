export type TLockfileFormat = 'npm-1' | 'npm-2' | 'yarn-1' | 'yarn-5' | 'yarn-6'

export type TScope = 'prod' | 'dev' | 'peer' | 'opt'

export type TSourceType = 'npm' | 'gh' | 'file' | 'workspace'

export type TLinkType = 'hard' | 'soft'

export type TDependencies = Record<string, string>

export interface THashes {
    sha512?: string
    sha256?: string
    sha1?: string
    checksum?: string
}

export interface TLockfileEntry {
    name: string
    version: string
    scope: TScope
    deps: TDependencies
    hashes: THashes
    linkType: TLinkType
    link: string
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
    path: string
    manifest: TManifest
}

export interface TDepsSnapshot {
    format: TLockfileFormat
    entries: Record<string, TLockfileEntry>
    workspaces: Record<string, TWorkspace>
}

export interface TParseOptions {
    cwd?: string
    filename?: string
    workspaces?: Record<string, TWorkspace>
}

export type IParse = {
    (data: string, opts?: TParseOptions): Promise<TDepsSnapshot>
    (opts?: TParseOptions): Promise<TDepsSnapshot>
}

export type IFormatOptions = {
    format: TLockfileFormat
}

export type IFormat = {
    (data: TDepsSnapshot, opts?: IFormatOptions): Promise<string>
}
