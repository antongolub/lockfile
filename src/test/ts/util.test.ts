import assert from 'node:assert'
import fs from 'node:fs/promises'
import path from 'node:path'
import { suite } from 'uvu'
import { loadContents, parseIntegrity, formatIntegrity } from '../../main/ts/util'

const test = suite('util')

test('`loadContents` detects path-like arguments and loads the file contents', async () => {
  const ref = path.resolve(__dirname, '../fixtures/yarn-1/yarn.lock')
  const contents = await fs.readFile(ref, 'utf8')

  assert.equal(await loadContents(ref), contents)
})

test('`loadContents` returns content-like input as is', async () => {
  assert.equal(await loadContents(`foo
`), 'foo\n')
})

test('`parseIntegrity` extracts checksums from has string', async () => {
  const hash = 'sha512-foo sha256-bar sha1-baz'
  const integrity = parseIntegrity(hash)

  assert.equal(integrity['sha512'], 'foo')
  assert.equal(integrity['sha256'], 'bar')
  assert.equal(integrity['sha1'], 'baz')
  assert.equal(formatIntegrity(integrity), hash)

  assert.equal(parseIntegrity('qux').checksum, 'qux') // checksum is preferred
  assert.equal(formatIntegrity({checksum: 'qux', sha1: 'baz'}), 'qux')
})

test.run()
