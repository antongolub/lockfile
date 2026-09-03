import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const gate = resolve('scripts/check-source-bytes.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source-text byte hygiene', () => {
  it('keeps every tracked source file free of raw NUL bytes', () => {
    const result = spawnSync(process.execPath, [gate], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('fails closed and reports byte offsets for a raw-NUL source fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'lockgraph-source-bytes-'))
    temporaryRoots.push(root)
    const fixture = join(root, 'raw-nul.ts')
    writeFileSync(fixture, Buffer.from('const key = `left\0right`\n'))

    const result = spawnSync(process.execPath, [gate, fixture], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`${basename(fixture)}: raw NUL byte at offset 17\n`)
  })
})
