import assert from 'node:assert'
import { suite } from 'uvu'
import {
  isProd,
  isDev,
  isPeer,
  isOptional,
  formatIntegrity,
  parseIntegrity
} from '../../main/ts/common'

const test = suite('common')

test('`isProd`', async () => {
  assert.equal(isProd({dependencies: {foo: '1.0.0'}, name: 'test'}, 'foo'), true)
  assert.equal(isProd({dependencies: {foo: '1.0.0'}, name: 'test'}, 'bar'), false)
})

test('`isDev`', async () => {
  assert.equal(isDev({devDependencies: {foo: '1.0.0'}, name: 'test'}, 'foo'), true)
  assert.equal(isDev({devDependencies: {foo: '1.0.0'}, name: 'test'}, 'bar'), false)
})

test('`isPeer`', async () => {
  assert.equal(isPeer({peerDependencies: {foo: '1.0.0'}, name: 'test'}, 'foo'), true)
  assert.equal(isPeer({peerDependencies: {foo: '1.0.0'}, name: 'test'}, 'bar'), false)
})

test('`isOptional`', async () => {
  assert.equal(isOptional({optionalDependencies: {foo: '1.0.0'}, name: 'test'}, 'foo'), true)
  assert.equal(isOptional({optionalDependencies: {foo: '1.0.0'}, name: 'test'}, 'bar'), false)
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
