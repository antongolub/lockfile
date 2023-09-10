import { suite } from 'uvu'
import path from 'node:path'
import {parse, format} from '../../main/ts/formats/yarn-berry'
import { testParseFormatInterop } from './helpers'

const test = suite('yarn-5')
test('parse/format interop for monorepo', async () => {
  await testParseFormatInterop(
    parse,
    format,
    path.resolve(__dirname, '../fixtures/yarn-5-mr/yarn.lock'),
    path.resolve(__dirname, '../fixtures/yarn-5-mr/package.json'),
  )
})

// test.run()
