#!/usr/bin/env node

import esbuild from 'esbuild'
import {nodeExternalsPlugin} from 'esbuild-node-externals'
import minimist from 'minimist'
import glob from 'fast-glob'
import fs from 'node:fs/promises'
import path from 'node:path'

const {entry, external} = minimist(process.argv.slice(2), {
  default: {
    entry: './src/main/ts/index.ts'
  }
})
const {argv} = process
const bundle = !argv.includes('--no-bundle')
const entryPoints = entry.split(':').map(e => e.includes('*') ? glob.sync(e, {absolute: false, onlyFiles: true}) : e).flat(1)

const esmConfig = {
  entryPoints,
  outdir: './target/esm',
  bundle,
  minify: false,
  sourcemap: false,
  sourcesContent: false,
  platform: 'node',
  target: 'esnext',
  format: 'esm',
  outExtension: {
    '.js': '.mjs'
  },
  external: bundle ? (external ? external.split(',') : ['node:*']) : undefined,  // https://github.com/evanw/esbuild/issues/1466
  plugins: [nodeExternalsPlugin()],           // https://github.com/evanw/esbuild/issues/619
  tsconfig: './tsconfig.json',
}

const cjsConfig = {
  ...esmConfig,
  outdir: './target/cjs',
  target: 'es6',
  format: 'cjs',
  outExtension: {
    '.js': '.cjs'
  }
}

const config = argv.includes('--cjs')
  ? cjsConfig
  : esmConfig

await esbuild
  .build(config)
  .catch(() => process.exit(1))

for (const entry of entryPoints) {
  const ext = config.outExtension['.js']
  const filename = path.resolve(config.outdir, path.basename(entry).replace('.ts', ext))
  const contents = await fs.readFile(filename, 'utf-8')
  const _contents = fixModuleReferences(contents, ext)
  await fs.writeFile(filename, _contents)
}

function fixModuleReferences (contents, ext = '.js') {
  return contents.replace(
    /((?:\s|^)import\s+|\s+from\s+|\W(?:import|require)\s*\()(["'])([^"']+\/[^"']+|\.{1,2})\/?(["'])/g,
    (_matched, control, q1, from, q2) =>
      `${control}${q1}${from.startsWith('.') ? from + ext : from}${q2}`,
  )
}
