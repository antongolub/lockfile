import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { detect, parse as parsePublic } from '../../main/ts/api/format-api.ts'
import { evidenceOf, internalEvidenceOf } from '../../main/ts/completeness/evidence.ts'
import { parse as parseYarnBerryV9 } from '../../main/ts/formats/yarn-berry-v9.ts'
import {
  check,
  npm4ManifestExtensionFeatureOf,
  parse,
  stringify,
} from '../../main/ts/formats/npm-4.ts'
import { hashAndNormalizeBytes } from '../../main/ts/recipe/patch.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = resolve(here, '../resources/fixtures')
const simpleV4Path = resolve(fixtureRoot, 'lockfiles/simple/npm-4.lock')
const patchProject = resolve(fixtureRoot, 'npm-v4/patch')
const patchLockPath = resolve(patchProject, 'package-lock.json')
const patchPath = resolve(patchProject, 'patches/is-number@7.0.0.patch')

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('npm-4 — npm 12 native format', () => {
  it('detects genuine packages-only lockfileVersion 4 and stays isolated from v3', () => {
    const v4 = readFileSync(simpleV4Path, 'utf8')
    const v3 = readFileSync(resolve(fixtureRoot, 'lockfiles/simple/npm-3.lock'), 'utf8')

    expect(check(v4)).toBe(true)
    expect(check(v3)).toBe(false)
    expect(detect(v4)).toBe('npm-4')
  })

  it('round-trips native packageExtensions fields byte-identically', () => {
    const input = readFileSync(simpleV4Path, 'utf8')
    const graph = parse(input)

    expect(stringify(graph)).toBe(input)
    expect(graph.out('is-number@7.0.0', 'dep').map(edge => edge.dst))
      .toEqual(['is-odd@3.0.1'])
    expect(npm4ManifestExtensionFeatureOf(graph)).toEqual({
      available: true,
      fingerprints: [{
        source: 'packageExtensionsHash',
        value: 'sha512-gg/eMLoRMAHmr3EQYIEvNK1BRk3AwR79s55NWIS0n78yo3ZB10j77asd7327kOC5chfmW4D1FgcvJ46bW1529A==',
      }],
    })
  })

  it('raises npm packageExtensionsHash to extended-fingerprinted manifest evidence', () => {
    const graph = parsePublic('npm-4', readFileSync(simpleV4Path, 'utf8'))
    expect(internalEvidenceOf(evidenceOf(graph)).observedManifestKnowledge).toEqual({
      knowledge: 'extended-fingerprinted',
      fingerprints: [{
        source: 'packageExtensionsHash',
        value: 'sha512-gg/eMLoRMAHmr3EQYIEvNK1BRk3AwR79s55NWIS0n78yo3ZB10j77asd7327kOC5chfmW4D1FgcvJ46bW1529A==',
      }],
    })
  })

  it('round-trips native .npm-extension hash and applied provenance byte-identically', () => {
    const path = resolve(fixtureRoot, 'npm-v4/npm-extension/package-lock.json')
    const input = readFileSync(path, 'utf8')
    const graph = parse(input)

    expect(stringify(graph)).toBe(input)
    expect(npm4ManifestExtensionFeatureOf(graph)).toEqual({
      available: true,
      fingerprints: [{
        source: 'npmExtensionHash',
        value: 'sha512-Bn45MA0x7GycXu9xZmJ/kOKLQ9okAwK2SNlxwAj7JxRSJym7upSGLGsP6xYdaPJNk5MWNMoFl3F4D2nhElpOug==',
      }],
    })
  })

  it('hashes genuine npm patch bytes into canonical Node.patch and replays native raw SRI', () => {
    const input = readFileSync(patchLockPath, 'utf8')
    const bytes = readFileSync(patchPath)
    const canonical = hashAndNormalizeBytes(bytes)
    const graph = parse(input, { workspaceRoot: patchProject })
    const nodeId = `is-number@7.0.0+patch=${canonical.hash}`

    expect(canonical.normalised).toBe(false)
    expect(graph.getNode(nodeId)?.patch).toBe(canonical.hash)
    expect(stringify(graph)).toBe(input)
  })

  it('uses a stable unresolved identity without patch bytes but still replays same-format metadata', () => {
    const input = readFileSync(patchLockPath, 'utf8')
    const graph = parse(input)
    const patched = [...graph.nodes()].find(node => node.name === 'is-number')

    expect(patched?.patch).toMatch(/^unresolved-[0-9a-f]{64}$/)
    expect(graph.diagnostics().map(diagnostic => diagnostic.code))
      .toContain('NPM_V4_PATCH_UNRESOLVED')
    expect(stringify(graph)).toBe(input)
  })

  it('diagnoses workspace patch drift while preserving npm native integrity', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm4-mismatch-'))
    temporaryDirectories.push(directory)
    writeFileSync(resolve(directory, 'patch.diff'), 'different bytes\n')
    const lock = JSON.parse(readFileSync(patchLockPath, 'utf8')) as {
      packages: Record<string, { patched?: { integrity: string; path: string } }>
    }
    lock.packages['node_modules/is-number']!.patched!.path = 'patch.diff'
    const graph = parse(JSON.stringify(lock), { workspaceRoot: directory })
    const output = stringify(graph)

    expect(graph.diagnostics()).toContainEqual(expect.objectContaining({
      code: 'NPM_V4_PATCH_INTEGRITY_MISMATCH',
      severity: 'warning',
    }))
    expect(output).toContain(`"integrity": ${
      JSON.stringify(lock.packages['node_modules/is-number']!.patched!.integrity)
    }`)
    expect(output).toContain('"path": "patch.diff"')
  })

  it('uses F5-normalised bytes for canonical identity while validating npm raw-byte SRI', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm4-normalise-'))
    temporaryDirectories.push(directory)
    const raw = Buffer.from('\uFEFFline one\r\nline two\r\n', 'utf8')
    writeFileSync(resolve(directory, 'patch.diff'), raw)
    const nativeIntegrity = `sha512-${createHash('sha512').update(raw).digest('base64')}`
    const input = JSON.stringify({
      name: 'normalise',
      version: '1.0.0',
      lockfileVersion: 4,
      requires: true,
      packages: {
        '': {
          name: 'normalise',
          version: '1.0.0',
          dependencies: { dep: '1.0.0' },
        },
        'node_modules/dep': {
          version: '1.0.0',
          patched: { integrity: nativeIntegrity, path: 'patch.diff' },
        },
      },
    }, null, 2) + '\n'
    const canonical = hashAndNormalizeBytes(raw)
    const graph = parse(input, { workspaceRoot: directory })

    expect(canonical.normalised).toBe(true)
    expect(graph.getNode(`dep@1.0.0+patch=${canonical.hash}`)?.patch).toBe(canonical.hash)
    expect(graph.diagnostics().map(diagnostic => diagnostic.code))
      .toContain('RECIPE_PATCH_NORMALISED')
    expect(stringify(graph)).toBe(input)
  })

  it('rejects malformed or forward-unknown patched carriers instead of silently dropping fields', () => {
    const malformed = JSON.parse(readFileSync(patchLockPath, 'utf8')) as {
      packages: Record<string, { patched?: Record<string, unknown> }>
    }
    malformed.packages['node_modules/is-number']!.patched!.future = true

    expect(() => parse(JSON.stringify(malformed))).toThrowError(
      expect.objectContaining({
        code: 'PARSE_FAILED',
        message: expect.stringContaining('exactly integrity and path'),
      }),
    )
  })

  it('fails closed when collapsed install paths disagree on extension provenance', () => {
    const input = JSON.stringify({
      name: 'conflicting-extension-provenance',
      version: '1.0.0',
      lockfileVersion: 4,
      requires: true,
      packages: {
        '': {
          name: 'conflicting-extension-provenance',
          version: '1.0.0',
          dependencies: { dep: '1.0.0', parent: '1.0.0' },
        },
        'node_modules/dep': {
          version: '1.0.0',
          packageExtensionsApplied: { dependencies: { added: '1.0.0' } },
        },
        'node_modules/parent': {
          version: '1.0.0',
          dependencies: { dep: '1.0.0' },
        },
        'node_modules/parent/node_modules/dep': {
          version: '1.0.0',
          packageExtensionsApplied: { dependencies: { added: '2.0.0' } },
        },
      },
    })

    expect(() => parse(input)).toThrowError(expect.objectContaining({
      code: 'PARSE_FAILED',
      message: expect.stringContaining('disagree on packageExtensionsApplied'),
    }))
  })

  it('does not fabricate npm native patch metadata for a cross-PM patched node', () => {
    const yarn = readFileSync(
      resolve(fixtureRoot, 'lockfiles/patch-yarn/yarn-berry-v9.lock'),
      'utf8',
    )
    const graph = parseYarnBerryV9(yarn)
    const diagnostics: string[] = []
    const output = stringify(graph, {
      onDiagnostic: diagnostic => diagnostics.push(diagnostic.code),
    })

    expect(output).not.toContain('"patched"')
    expect(diagnostics).toContain('RECIPE_FEATURE_DROPPED')
  })
})
