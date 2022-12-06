import { suite } from 'uvu'
import path from 'node:path'
import {parse, format} from '../../main/ts/yarn-5'
import { testParseFormatInterop } from './helpers'

const test = suite('yarn-5')
test('parse/format interop for monorepo', async () => {
  await testParseFormatInterop({input: path.resolve(__dirname, '../fixtures/yarn-5-mr/yarn.lock'), parse, format})
})

test.run()
