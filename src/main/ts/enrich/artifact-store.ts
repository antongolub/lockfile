import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import { parseByteSize, type ByteSize } from '../api/operation.ts'
import type { Diagnostic } from '../graph.ts'
import {
  enrichArtifactDiagnostic,
  type EnrichArtifactDiagnosticCode,
} from './diagnostics.ts'

export const DEFAULT_ARTIFACT_STORE_MAX_BYTES = 5 * 1024 ** 3

export interface ArtifactStoreOptions {
  readonly path?: string
  readonly maxBytes?: number
}

export interface ArtifactStoreSource {
  readonly kind: 'lockgraph-artifact-store'
  readonly path: string
  readonly maxBytes: number
}

declare const lockgraphStoreBrand: unique symbol

/** Opaque operation-level verified-content store handle. */
export interface Store {
  readonly [lockgraphStoreBrand]: true
}

/** Shared persistence policy for graph operations that may materialize artifacts. */
export interface ArtifactPersistenceOptions {
  /** Omitted uses the global XDG-aware store; false disables persistence. */
  readonly store?: Store | false
}

export type ArtifactStoreAlias =
  | Readonly<{
      namespace: 'tarball'
      algorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512'
      digest: string
    }>
  | Readonly<{
      namespace: 'berry-zip'
      algorithm: 'sha512'
      digest: string
      cacheKey: string
    }>

export interface ArtifactStoreEvidence {
  readonly aliases: readonly ArtifactStoreAlias[]
}

export interface ArtifactStoreHit {
  readonly bytes: Uint8Array
  readonly canonical: string
  readonly viaAlias: boolean
  accept(): Promise<void>
  rejectAlias(): Promise<void>
  release(): Promise<void>
}

export interface ArtifactStoreReadLimit {
  readonly exceededBytes: number
}

export type ArtifactStoreDiagnostic = (diagnostic: Diagnostic) => void

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const SHA512_HEX = /^[0-9a-f]{128}$/
const LOCK_RETRIES = 200
const LOCK_RETRY_MS = 10
const HEX_LENGTH: Record<ArtifactStoreAlias['algorithm'], number> = {
  sha1: 40,
  sha256: 64,
  sha384: 96,
  sha512: 128,
}

function invalidStore(message: string): TypeError {
  return new TypeError(`artifactStore: ${message}`)
}

function defaultStorePath(): string {
  const xdg = process.env.XDG_CACHE_HOME
  return resolve(
    xdg !== undefined && isAbsolute(xdg)
      ? xdg
      : resolve(homedir(), '.cache'),
    'lockgraph',
  )
}

export function artifactStore(
  options: ArtifactStoreOptions = {},
): ArtifactStoreSource {
  if (options.path !== undefined
    && (typeof options.path !== 'string' || options.path.length === 0)) {
    throw invalidStore('path must be a non-empty string')
  }
  const maxBytes = options.maxBytes ?? DEFAULT_ARTIFACT_STORE_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw invalidStore('maxBytes must be a positive safe integer')
  }
  const path = resolve(options.path ?? defaultStorePath())
  if (dirname(path) === path) {
    throw invalidStore('path must not be a filesystem root')
  }
  return Object.freeze({
    kind: 'lockgraph-artifact-store',
    path,
    maxBytes,
  })
}

/** Creates the coherent operation-level store. */
export function lockgraphStore(
  path?: string,
  options: Readonly<{ maxBytes?: ByteSize }> = {},
): Store {
  return artifactStore({
    ...(path === undefined ? {} : { path }),
    ...(options.maxBytes === undefined
      ? {}
      : { maxBytes: parseByteSize(options.maxBytes, 'lockgraphStore.maxBytes') }),
  }) as unknown as Store
}

export function validateArtifactStoreSource(value: unknown): ArtifactStoreSource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidStore('store must be created by artifactStore()')
  }
  const candidate = value as Partial<ArtifactStoreSource>
  if (candidate.kind !== 'lockgraph-artifact-store'
    || typeof candidate.path !== 'string'
    || candidate.path.length === 0
    || !isAbsolute(candidate.path)
    || dirname(candidate.path) === candidate.path
    || !Number.isSafeInteger(candidate.maxBytes)
    || candidate.maxBytes! <= 0) {
    throw invalidStore('store path and maxBytes are invalid')
  }
  return candidate as ArtifactStoreSource
}

/** Resolves one operation's default/custom/disabled persistence policy. */
export function operationArtifactStore(
  value: Store | false | undefined,
): ArtifactStoreSource | undefined {
  if (value === false) return undefined
  return value === undefined ? artifactStore() : validateArtifactStoreSource(value)
}

function canonicalDigest(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('hex')
}

function objectPath(source: ArtifactStoreSource, canonical: string): string {
  if (!SHA512_HEX.test(canonical)) throw new Error('invalid canonical SHA-512')
  return resolve(
    source.path,
    'objects',
    'sha512',
    canonical.slice(0, 2),
    canonical.slice(2),
  )
}

function aliasPath(source: ArtifactStoreSource, alias: ArtifactStoreAlias): string {
  if (alias.digest.length !== HEX_LENGTH[alias.algorithm]
    || !/^[0-9a-f]+$/.test(alias.digest)) {
    throw new Error(`invalid ${alias.algorithm} artifact-store digest`)
  }
  if (alias.namespace === 'berry-zip'
    && !/^[A-Za-z0-9_-]+$/.test(alias.cacheKey)) {
    throw new Error('invalid Berry cache key for artifact-store alias')
  }
  return resolve(
    source.path,
    'aliases',
    alias.namespace,
    ...(alias.namespace === 'berry-zip' ? [alias.cacheKey] : []),
    alias.algorithm,
    alias.digest.slice(0, 2),
    alias.digest.slice(2),
  )
}

function nonce(): string {
  return randomBytes(8).toString('hex')
}

function ownerPid(name: string, separator: '-' | '.'): number | undefined {
  const raw = name.split(separator)[separator === '-' ? 0 : 1]
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const pid = Number(raw)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

async function checkedDirectory(path: string): Promise<void> {
  const facts = await lstat(path)
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error(`artifact store path is not a private directory: ${path}`)
  }
  await chmod(path, DIR_MODE)
}

async function privateDirectory(
  source: ArtifactStoreSource,
  path: string,
): Promise<void> {
  const root = resolve(source.path)
  const target = resolve(path)
  const suffix = relative(root, target)
  if (suffix.startsWith(`..${sep}`) || suffix === '..' || isAbsolute(suffix)) {
    throw new Error('artifact store internal path escaped its private root')
  }
  await mkdir(root, { recursive: true, mode: DIR_MODE })
  await checkedDirectory(root)
  let current = root
  for (const part of suffix === '' ? [] : suffix.split(sep)) {
    current = resolve(current, part)
    try {
      await mkdir(current, { mode: DIR_MODE })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await checkedDirectory(current)
  }
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const facts = await lstat(path)
    return facts.isFile() && !facts.isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function ensureRoot(source: ArtifactStoreSource): Promise<void> {
  await privateDirectory(source, source.path)
  await privateDirectory(source, resolve(source.path, 'objects'))
  await privateDirectory(source, resolve(source.path, 'objects', 'sha512'))
  await privateDirectory(source, resolve(source.path, 'aliases'))
  await privateDirectory(source, resolve(source.path, '.tmp'))
  await privateDirectory(source, resolve(source.path, '.pins'))
}

async function acquireLock(source: ArtifactStoreSource): Promise<() => Promise<void>> {
  await ensureRoot(source)
  const lock = resolve(source.path, '.lock')
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await mkdir(lock, { mode: DIR_MODE })
      await atomicWrite(source, resolve(lock, 'owner'), `${process.pid}\n`)
      return async () => {
        await rm(lock, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let facts
      try {
        facts = await lstat(lock)
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw lockError
      }
      if (!facts.isDirectory() || facts.isSymbolicLink()) {
        throw new Error('artifact store lock path is not a private directory')
      }
      let pid: number | undefined
      try {
        const raw = (await readFile(resolve(lock, 'owner'), 'utf8')).trim()
        pid = /^\d+$/.test(raw) ? Number(raw) : undefined
      } catch {
        // A competing creator may be between mkdir and owner rename.
      }
      if (pid === undefined) {
        let age
        try {
          age = Date.now() - (await stat(lock)).mtimeMs
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw lockError
        }
        if (age < 1_000) {
          await delay(LOCK_RETRY_MS)
          continue
        }
      }
      if (pid === undefined || !processAlive(pid)) {
        const stale = resolve(
          source.path,
          '.tmp',
          `${process.pid}-stale-lock-${nonce()}`,
        )
        try {
          await rename(lock, stale)
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw lockError
        }
        await rm(stale, { recursive: true, force: true })
        continue
      }
      await delay(LOCK_RETRY_MS)
    }
  }
  throw new Error('artifact store lock remained live')
}

async function withLock<T>(
  source: ArtifactStoreSource,
  task: () => Promise<T>,
): Promise<T> {
  const release = await acquireLock(source)
  try {
    await recoverDeadCoordination(source)
    return await task()
  } finally {
    await release()
  }
}

async function recoverDeadCoordination(source: ArtifactStoreSource): Promise<void> {
  const clean = async (folder: '.tmp' | '.pins', separator: '-' | '.'): Promise<void> => {
    const root = resolve(source.path, folder)
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() && (folder !== '.tmp' || !entry.isDirectory())) continue
      const pid = ownerPid(entry.name, separator)
      if (pid !== undefined && !processAlive(pid)) {
        await rm(resolve(root, entry.name), {
          recursive: entry.isDirectory(),
          force: true,
        })
      }
    }
  }
  await clean('.tmp', '-')
  await clean('.pins', '.')
}

async function atomicWrite(
  source: ArtifactStoreSource,
  destination: string,
  content: Uint8Array | string,
): Promise<void> {
  await privateDirectory(source, dirname(destination))
  const temp = resolve(source.path, '.tmp', `${process.pid}-${nonce()}`)
  const handle = await open(temp, 'wx', FILE_MODE)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    try {
      await rename(temp, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      await rm(destination, { force: true })
      await rename(temp, destination)
    }
    await chmod(destination, FILE_MODE)
  } finally {
    await rm(temp, { force: true })
  }
}

function diagnostic(
  onDiagnostic: ArtifactStoreDiagnostic,
  code: EnrichArtifactDiagnosticCode,
  subject: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  onDiagnostic(enrichArtifactDiagnostic(code, subject, message, data))
}

interface Candidate {
  readonly canonical: string
  readonly alias?: string
}

async function candidateOf(
  source: ArtifactStoreSource,
  alias: ArtifactStoreAlias,
): Promise<Candidate | undefined> {
  if (alias.namespace === 'tarball' && alias.algorithm === 'sha512') {
    return SHA512_HEX.test(alias.digest)
      ? { canonical: alias.digest }
      : undefined
  }
  const path = aliasPath(source, alias)
  try {
    if (!await regularFile(path)) {
      try {
        await lstat(path)
        return { canonical: '', alias: path }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    }
    if ((await stat(path)).size !== 129) {
      return { canonical: '', alias: path }
    }
    const canonical = (await readFile(path, 'utf8')).trim()
    return SHA512_HEX.test(canonical)
      ? { canonical, alias: path }
      : { canonical: '', alias: path }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function pin(
  source: ArtifactStoreSource,
  canonical: string,
): Promise<string> {
  const path = resolve(
    source.path,
    '.pins',
    `${canonical}.${process.pid}.${nonce()}`,
  )
  await atomicWrite(source, path, '')
  return path
}

async function removeUnderLock(
  source: ArtifactStoreSource,
  paths: readonly string[],
): Promise<void> {
  await withLock(source, async () => {
    for (const path of paths) await rm(path, { force: true })
  })
}

export async function readArtifactStore(
  source: ArtifactStoreSource,
  evidence: ArtifactStoreEvidence,
  subject: string,
  onDiagnostic: ArtifactStoreDiagnostic,
  maxCompressedBytes?: number,
): Promise<ArtifactStoreHit | ArtifactStoreReadLimit | undefined> {
  for (const evidenceAlias of evidence.aliases) {
    let selected:
      | { candidate: Candidate; pin: string }
      | ArtifactStoreReadLimit
      | undefined
    try {
      selected = await withLock(source, async () => {
        const candidate = await candidateOf(source, evidenceAlias)
        if (candidate === undefined) return undefined
        if (!SHA512_HEX.test(candidate.canonical)) {
          if (candidate.alias !== undefined) await rm(candidate.alias, { force: true })
          diagnostic(
            onDiagnostic,
            'ENRICH_ARTIFACT_STORE_CORRUPT',
            subject,
            'found a malformed digest alias; deleted the index and continued',
          )
          return undefined
        }
        const path = objectPath(source, candidate.canonical)
        if (!await regularFile(path)) {
          if (candidate.alias !== undefined) {
            await rm(candidate.alias, { force: true })
            diagnostic(
              onDiagnostic,
              'ENRICH_ARTIFACT_STORE_CORRUPT',
              subject,
              'found a dangling digest alias; deleted the index and continued',
            )
          }
          return undefined
        }
        const size = (await stat(path)).size
        if (maxCompressedBytes !== undefined && size > maxCompressedBytes) {
          return { exceededBytes: size }
        }
        return { candidate, pin: await pin(source, candidate.canonical) }
      })
    } catch (error) {
      diagnostic(
        onDiagnostic,
        'ENRICH_ARTIFACT_STORE_READ_FAILED',
        subject,
        'could not read the configured artifact store; continued in source order',
        { cause: error instanceof Error ? error.message : String(error) },
      )
      return undefined
    }
    if (selected === undefined) continue
    if ('exceededBytes' in selected) return selected

    const path = objectPath(source, selected.candidate.canonical)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(path))
    } catch (error) {
      await removeUnderLock(source, [selected.pin])
      diagnostic(
        onDiagnostic,
        'ENRICH_ARTIFACT_STORE_READ_FAILED',
        subject,
        'could not read a pinned artifact object; continued in source order',
        { cause: error instanceof Error ? error.message : String(error) },
      )
      return undefined
    }
    if (canonicalDigest(bytes) !== selected.candidate.canonical) {
      await removeUnderLock(source, [
        path,
        ...(selected.candidate.alias === undefined ? [] : [selected.candidate.alias]),
        selected.pin,
      ])
      diagnostic(
        onDiagnostic,
        'ENRICH_ARTIFACT_STORE_CORRUPT',
        subject,
        'failed canonical SHA-512 self-verification; deleted the object and traversed alias',
      )
      continue
    }

    let settled = false
    const settle = async (
      action: 'accept' | 'reject-alias' | 'release',
    ): Promise<void> => {
      if (settled) return
      settled = true
      try {
        await withLock(source, async () => {
          if (action === 'accept') {
            const now = new Date()
            await utimes(path, now, now)
          }
          if (action === 'reject-alias' && selected!.candidate.alias !== undefined) {
            await rm(selected!.candidate.alias, { force: true })
          }
          await rm(selected!.pin, { force: true })
        })
      } catch (error) {
        // This process owns the marker; direct cleanup cannot expose a
        // not-yet-pinned object even when the shared lock is unavailable.
        await rm(selected!.pin, { force: true })
        throw error
      }
      if (action === 'reject-alias' && selected!.candidate.alias !== undefined) {
        diagnostic(
          onDiagnostic,
          'ENRICH_ARTIFACT_STORE_CORRUPT',
          subject,
          'failed current-lock verification; deleted only the digest alias and continued',
        )
      }
    }
    return {
      bytes,
      canonical: selected.candidate.canonical,
      viaAlias: selected.candidate.alias !== undefined,
      accept: () => settle('accept'),
      rejectAlias: () => settle('reject-alias'),
      release: () => settle('release'),
    }
  }
  return undefined
}

interface StableObject {
  readonly canonical: string
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

interface StableAlias {
  readonly path: string
  readonly size: number
  readonly canonical: string | undefined
}

function validAliasLayout(
  source: ArtifactStoreSource,
  path: string,
): boolean {
  const parts = relative(resolve(source.path, 'aliases'), path).split(sep)
  const digestMatches = (
    algorithm: string | undefined,
    head: string | undefined,
    tail: string | undefined,
  ): boolean => {
    if (algorithm === undefined
      || !Object.hasOwn(HEX_LENGTH, algorithm)
      || head === undefined
      || tail === undefined) return false
    const digest = `${head}${tail}`
    return digest.length === HEX_LENGTH[algorithm as ArtifactStoreAlias['algorithm']]
      && /^[0-9a-f]+$/.test(digest)
  }
  if (parts[0] === 'tarball' && parts.length === 4) {
    return digestMatches(parts[1], parts[2], parts[3])
  }
  if (parts[0] === 'berry-zip' && parts.length === 5) {
    return parts[1] !== undefined
      && /^[A-Za-z0-9_-]+$/.test(parts[1])
      && parts[2] === 'sha512'
      && digestMatches(parts[2], parts[3], parts[4])
  }
  return false
}

async function filesBelow(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) found.push(child)
      else throw new Error(
        entry.isSymbolicLink()
          ? 'artifact store contains a symbolic-link entry'
          : 'artifact store contains a non-regular entry',
      )
    }
  }
  await visit(root)
  return found
}

async function stableState(
  source: ArtifactStoreSource,
  subject: string,
  onDiagnostic: ArtifactStoreDiagnostic,
): Promise<{ objects: StableObject[]; aliases: StableAlias[]; bytes: number }> {
  const objects: StableObject[] = []
  for (const path of await filesBelow(resolve(source.path, 'objects'))) {
    const canonical = `${basename(dirname(path))}${basename(path)}`
    if (!SHA512_HEX.test(canonical)
      || path !== objectPath(source, canonical)) {
      await rm(path, { force: true })
      diagnostic(
        onDiagnostic,
        'ENRICH_ARTIFACT_STORE_CORRUPT',
        subject,
        'deleted an object stored outside the canonical SHA-512 layout',
      )
      continue
    }
    const facts = await stat(path)
    objects.push({
      canonical,
      path,
      size: facts.size,
      mtimeMs: facts.mtimeMs,
    })
  }
  const objectCanonicals = new Set(objects.map(item => item.canonical))
  const aliases: StableAlias[] = []
  for (const path of await filesBelow(resolve(source.path, 'aliases'))) {
    const facts = await stat(path)
    const canonical = facts.size === 129
      ? (await readFile(path, 'utf8')).trim()
      : ''
    if (!validAliasLayout(source, path)
      || !SHA512_HEX.test(canonical)
      || !objectCanonicals.has(canonical)) {
      await rm(path, { force: true })
      diagnostic(
        onDiagnostic,
        'ENRICH_ARTIFACT_STORE_CORRUPT',
        subject,
        'deleted malformed digest-alias metadata during capacity accounting',
      )
      continue
    }
    aliases.push({ path, size: facts.size, canonical })
  }
  return {
    objects,
    aliases,
    bytes: objects.reduce((sum, item) => sum + item.size, 0)
      + aliases.reduce((sum, item) => sum + item.size, 0),
  }
}

async function livePins(source: ArtifactStoreSource): Promise<Set<string>> {
  const pins = new Set<string>()
  for (const entry of await readdir(resolve(source.path, '.pins'), { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const canonical = entry.name.split('.')[0]
    if (canonical !== undefined && SHA512_HEX.test(canonical)) pins.add(canonical)
  }
  return pins
}

async function aliasesForWrite(
  source: ArtifactStoreSource,
  evidence: ArtifactStoreEvidence,
  canonical: string,
): Promise<Array<{ path: string; content: string }>> {
  const aliases = new Map<string, { path: string; content: string }>()
  for (const alias of evidence.aliases) {
    if (alias.namespace === 'tarball'
      && alias.algorithm === 'sha512'
      && alias.digest === canonical) continue
    const path = aliasPath(source, alias)
    aliases.set(path, { path, content: `${canonical}\n` })
  }
  return [...aliases.values()]
}

export async function writeArtifactStore(
  source: ArtifactStoreSource,
  evidence: ArtifactStoreEvidence,
  bytes: Uint8Array,
  subject: string,
  onDiagnostic: ArtifactStoreDiagnostic,
): Promise<void> {
  const canonical = canonicalDigest(bytes)
  if (bytes.byteLength > source.maxBytes) {
    diagnostic(
      onDiagnostic,
      'ENRICH_ARTIFACT_STORE_CAPACITY_EXCEEDED',
      subject,
      `exceeded the configured artifact-store capacity of ${source.maxBytes} bytes; verified bytes were not persisted`,
      { maxBytes: source.maxBytes, artifactBytes: bytes.byteLength },
    )
    return
  }

  try {
    await withLock(source, async () => {
      const object = objectPath(source, canonical)
      let objectExists = await regularFile(object)
      if (objectExists) {
        const existingFacts = await stat(object)
        const existingMatches = existingFacts.size === bytes.byteLength
          && canonicalDigest(new Uint8Array(await readFile(object))) === canonical
        if (!existingMatches) {
          await rm(object, { force: true })
          objectExists = false
          diagnostic(
            onDiagnostic,
            'ENRICH_ARTIFACT_STORE_CORRUPT',
            subject,
            'replaced a canonical object that failed SHA-512 self-verification',
          )
        }
      }
      const aliases = await aliasesForWrite(source, evidence, canonical)
      const aliasesBeingWritten = new Set(aliases.map(alias => alias.path))
      let state
      try {
        state = await stableState(source, subject, onDiagnostic)
      } catch (error) {
        if (error !== null && typeof error === 'object') {
          Object.assign(error, { artifactStorePhase: 'eviction' })
        }
        throw error
      }
      const aliasPaths = new Set(state.aliases.map(alias => alias.path))
      const additions = (objectExists ? 0 : bytes.byteLength)
        + aliases.reduce((sum, alias) =>
          sum + (aliasPaths.has(alias.path) ? 0 : Buffer.byteLength(alias.content)), 0)
      const pinPath = await pin(source, canonical)
      try {
        let projected = state.bytes + additions
        if (projected > source.maxBytes) {
          try {
            const pinned = await livePins(source)
            const victims = state.objects
              .filter(candidate =>
                candidate.canonical !== canonical && !pinned.has(candidate.canonical))
              .sort((left, right) =>
                left.mtimeMs - right.mtimeMs
                || left.canonical.localeCompare(right.canonical))
            const removable = victims.reduce((sum, victim) =>
              sum + victim.size + state.aliases.reduce((aliasSum, alias) =>
                alias.canonical === victim.canonical
                  && !aliasesBeingWritten.has(alias.path)
                  ? aliasSum + alias.size
                  : aliasSum, 0), 0)
            if (projected - removable > source.maxBytes) {
              diagnostic(
                onDiagnostic,
                'ENRICH_ARTIFACT_STORE_CAPACITY_EXCEEDED',
                subject,
                'could not free configured capacity without evicting live pinned objects; verified bytes were not persisted',
                { maxBytes: source.maxBytes, projectedBytes: projected },
              )
              return
            }
            for (const victim of victims) {
              await rm(victim.path, { force: true })
              projected -= victim.size
              for (const alias of state.aliases) {
                if (alias.canonical !== victim.canonical) continue
                if (aliasesBeingWritten.has(alias.path)) continue
                await rm(alias.path, { force: true })
                projected -= alias.size
              }
              if (projected <= source.maxBytes) break
            }
          } catch (error) {
            if (error !== null && typeof error === 'object') {
              Object.assign(error, { artifactStorePhase: 'eviction' })
            }
            throw error
          }
        }
        if (projected > source.maxBytes) {
          diagnostic(
            onDiagnostic,
            'ENRICH_ARTIFACT_STORE_CAPACITY_EXCEEDED',
            subject,
            'could not free configured capacity without evicting live pinned objects; verified bytes were not persisted',
            { maxBytes: source.maxBytes, projectedBytes: projected },
          )
          return
        }
        if (!objectExists) await atomicWrite(source, object, bytes)
        for (const alias of aliases) {
          await atomicWrite(source, alias.path, alias.content)
        }
        if (objectExists) {
          const now = new Date()
          await utimes(object, now, now)
        }
      } finally {
        await rm(pinPath, { force: true })
      }
    })
  } catch (error) {
    const code = (error as { artifactStorePhase?: string }).artifactStorePhase === 'eviction'
      ? 'ENRICH_ARTIFACT_STORE_EVICTION_FAILED'
      : 'ENRICH_ARTIFACT_STORE_WRITE_FAILED'
    diagnostic(
      onDiagnostic,
      code,
      subject,
      'could not persist centrally verified artifact bytes; enrichment continued without persistence',
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
}
