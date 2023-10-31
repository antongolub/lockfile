import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs/promises'
import { suite } from 'uvu'
import {parse, analyze} from '../../main/ts'

const test = suite('issue-1')

test('parse/format interop for regular repo', async () => {
  const pkgJson = await fs.readFile(path.resolve(__dirname, '../fixtures/issue-2/package.json'), 'utf8')
  const yarnLock = await fs.readFile(path.resolve(__dirname, '../fixtures/issue-2/yarn.lock'), 'utf8')

  const snapshot = await parse(yarnLock, pkgJson)
  // await fs.writeFile('snap.json', JSON.stringify(snapshot, null, 2))
  const tree = await analyze(snapshot)
})

test.run()