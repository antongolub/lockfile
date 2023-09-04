import { suite } from 'uvu'
import path from 'node:path'
import {parse, format} from '../../main/ts/formats/npm-2'
import { testParseFormatInterop } from './helpers'

const test = suite('npm-2')

test('parse/format interop for regular repo', async () => {
  await testParseFormatInterop({
    input: path.resolve(__dirname, '../fixtures/npm-2/package-lock.json'),
    opts: path.resolve(__dirname, '../fixtures/npm-2/package.json'),
    parse,
    format
  })
})

// test.run()
