import { suite } from 'uvu'
import path from 'node:path'
import assert from 'node:assert'
import fs from 'node:fs/promises'
import { analyze } from '../../main/ts/analyze'
import {parse} from '../../main/ts/formats/npm-1'
import {TLockfileEntry} from '../../main/ts/interface'

const test = suite('analyze')

test('builds index by a snapshot', async () => {
  const pkgLock = await fs.readFile(path.resolve(__dirname, '../fixtures/npm-1-recursive/package-lock.json'), 'utf-8')
  const pkgJson = await fs.readFile(path.resolve(__dirname, '../fixtures/npm-1-recursive/package.json'), 'utf-8')

  const snap = await parse(pkgLock, pkgJson)
  const idx = analyze(snap)
  const entry = idx.getEntry('@antongolub/npm-test', '4.0.1') as TLockfileEntry

  assert.ok(idx.prod.has(entry))
  assert.deepEqual(idx.edges, [
    [ '@5.0.0', '@antongolub/npm-test@4.0.1' ],
    [ '@antongolub/npm-test@4.0.1', '@antongolub/npm-test@3.0.1' ],
    [ '@antongolub/npm-test@3.0.1', '@antongolub/npm-test@2.0.1' ],
    [ '@antongolub/npm-test@2.0.1', '@antongolub/npm-test@1.0.0' ]
  ])
})

// test.run()
