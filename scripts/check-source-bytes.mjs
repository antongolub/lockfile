#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_PATHS = ['*.ts', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']

export function rawNulOffsets (bytes) {
  const offsets = []
  for (let offset = bytes.indexOf(0); offset !== -1; offset = bytes.indexOf(0, offset + 1)) {
    offsets.push(offset)
  }
  return offsets
}

export function trackedSourceFiles (cwd = process.cwd()) {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...SOURCE_PATHS], {
    cwd,
    encoding: 'buffer',
  })
  return output.toString('utf8').split('\0').filter(Boolean)
}

export function sourceFilesWithRawNuls (files, cwd = process.cwd()) {
  return files.flatMap(file => {
    const absolute = resolve(cwd, file)
    const offsets = rawNulOffsets(readFileSync(absolute))
    return offsets.length === 0 ? [] : [{ file, absolute, offsets }]
  })
}

function displayPath (absolute, cwd) {
  const candidate = relative(cwd, absolute)
  return candidate === '' || candidate === '..' || candidate.startsWith(`..${sep}`)
    ? basename(absolute)
    : candidate
}

function main () {
  const cwd = process.cwd()
  const explicit = process.argv.slice(2)
  const files = explicit.length > 0 ? explicit : trackedSourceFiles(cwd)
  const failures = sourceFilesWithRawNuls(files, cwd)
  if (failures.length === 0) return

  for (const { absolute, offsets } of failures) {
    process.stderr.write(
      `${displayPath(absolute, cwd)}: raw NUL byte${offsets.length === 1 ? '' : 's'} at offset${offsets.length === 1 ? '' : 's'} ${offsets.join(', ')}\n`,
    )
  }
  process.exitCode = 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
