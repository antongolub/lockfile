import { suite } from 'uvu'
import path from 'node:path'
import {parse, format} from '../../main/ts/formats/npm-1'
import { testInterop } from './helpers'

const test = suite('npm-1')

test('parse/format interop for regular repo', async () => {
  await testInterop(
    parse,
    format,
    path.resolve(__dirname, '../fixtures/npm-1/package-lock.json'),
    path.resolve(__dirname, '../fixtures/npm-1/package.json')
  )
})

test('parse/format interop for regular repo with recursive deps', async () => {
  await testInterop(
    parse,
    format,
    path.resolve(__dirname, '../fixtures/npm-1-recursive/package-lock.json'),
    path.resolve(__dirname, '../fixtures/npm-1-recursive/package.json'),
  )
})

test.run()
