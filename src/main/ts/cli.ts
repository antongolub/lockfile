#!/usr/bin/env node

import fs from 'node:fs/promises'
import glob from 'fast-glob'
import minimist from 'minimist'
import { parse } from './parse'
import { format } from './format'
import { TSnapshot } from './interface'
import * as process from 'node:process'
import path from "node:path";

export const parseArgv = (argv: string[] = process.argv.slice(2)) => {
  const _argv = minimist(argv, {
    string: ['input', 'output', 'nmtree', 'format']
  })

  const cmd = _argv._[0]
  const cwd = _argv.cwd || process.cwd()
  const input = [
    _argv._.slice(1),
    _argv.input?.split(','),
  ].flat(1).filter(Boolean)

  return {
    ..._argv,
    cwd,
    cmd,
    input,
  }
}

export const returnResult = (result: string, cwd?: string, output?: string) => {
  if (output && cwd) {
    return fs.writeFile(path.resolve(cwd, output), result)
  }
  console.log(result)
}

export const invoke = async (cmd: string, opts: Record<string, any>)=> {
  if (!opts.input) {
    throw new TypeError('input is required')
  }

  if (cmd === 'parse') {
    const inputs = await glob(opts.input, {cwd: opts.cwd, absolute: true, onlyFiles: true})
    const files = await Promise.all(inputs.map(v => fs.readFile(v, 'utf8')))
    const snapshot = parse(...files)
    const result = JSON.stringify(snapshot, null, 2)

    return returnResult(result, opts.cwd, opts.output)
  }

  if (cmd === 'format') {
    const snapshot = JSON.parse(await fs.readFile(path.resolve(opts.cwd, opts.input[0]), 'utf8')) as TSnapshot
    const result = format(snapshot, opts.format)

    return returnResult(result, opts.cwd, opts.output)
  }

  throw new TypeError(`unsupported command: ${cmd}`)
}

export const main = async () => {
  const argv = parseArgv()
  return invoke(argv.cmd, argv)
}

main()
