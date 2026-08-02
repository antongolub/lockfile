import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parse as parseNpm2,
  stringify as stringifyNpm2,
} from '../../main/ts/formats/npm-2.ts'

const npmBin = resolve(process.cwd(), 'node_modules/pm-npm-11/bin/npm-cli.js')

const CASES = [
  {
    name: 'alias',
    packageJson: {
      name: 'npm-v2-alias-oracle',
      version: '1.0.0',
      dependencies: { 'pm-x': 'npm:@yarnpkg/cli-dist@4.17.1' },
    },
  },
  {
    name: 'override',
    packageJson: {
      name: 'npm-v2-override-oracle',
      version: '1.0.0',
      dependencies: { handlebars: '^4.7.0' },
      overrides: { minimist: '1.2.8' },
    },
  },
] as const

function npm(root: string, args: readonly string[]): void {
  execFileSync(process.execPath, [npmBin, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: 'pipe',
  })
}

function withProject<T>(packageJson: object, run: (root: string) => T): T {
  const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm-v2-native-'))
  try {
    writeFileSync(resolve(root, 'package.json'), JSON.stringify(packageJson, null, 2))
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('npm v2 alias/override producer oracle', () => {
  it.each(CASES)('$name output survives frozen and write-enabled npm unchanged', ({ packageJson }) => {
    withProject(packageJson, root => {
      npm(root, [
        'install',
        '--package-lock-only',
        '--lockfile-version=2',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ])
      const lockPath = resolve(root, 'package-lock.json')
      const producer = readFileSync(lockPath, 'utf8')
      const emitted = stringifyNpm2(parseNpm2(producer))
      writeFileSync(lockPath, emitted)

      npm(root, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
      expect(readFileSync(lockPath, 'utf8')).toBe(emitted)

      rmSync(resolve(root, 'node_modules'), { recursive: true, force: true })
      npm(root, [
        'install',
        '--lockfile-version=2',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ])
      expect(readFileSync(lockPath, 'utf8')).toBe(emitted)
      expect(emitted).toBe(producer)
    })
  })
})
