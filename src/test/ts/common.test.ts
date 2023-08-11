import assert from 'node:assert'
import semver from 'semver'
import { suite } from 'uvu'
import {
  isProd,
  isDev,
  isPeer,
  isOptional,
  formatIntegrity,
  parseIntegrity,
  parseReference,
} from '../../main/ts/common'
import {mapReference} from "../../main/ts/workspace";

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

test('`parseReference` poorly detects pkg reference type', () => {
  const cases = [
    ['1.0.0', {
      protocol: 'semver',
      value: '1.0.0',
      raw: '1.0.0',
      version: '1.0.0',
      caret: ''
    }],
    ['^1.0.0', {
      protocol: 'semver',
      value: '^1.0.0',
      raw: '^1.0.0',
      version: '1.0.0',
      caret: '^'
    }],
    ['1.2.3-beta.0', {
      protocol: 'semver',
      value: '1.2.3-beta.0',
      raw: '1.2.3-beta.0',
      version: '1.2.3-beta.0',
      caret: ''
    }],
    ['workspace:*', {
      protocol: 'workspace',
      value: '*',
      version: null,
      raw: 'workspace:*',
      caret: ''
    }],
    ['npm:1.0.0', {
      protocol: 'npm',
      value: '1.0.0',
      raw: 'npm:1.0.0',
      version: '1.0.0',
      caret: ''
    }],
  ];

  cases.forEach(([input, output]) => {
    assert.deepStrictEqual(parseReference(input), output)
  })
})

test('`mapReference` maps v declaration as expected', () => {
  const cases: [string, string, string, string][] = [
    ['workspace:*',   'workspace',  'inherit',  'workspace:*'],
    ['10.0.0',        'workspace',  'pin',      'workspace:10.0.0'],
    ['npm:^10.0.0',   'workspace',  'pin',      'workspace:10.0.0'],
    ['npm:^10.0.0',   'workspace',  'inherit',  'workspace:^10.0.0'],
    ['^10.0.0',       'npm',        'inherit',  'npm:^10.0.0'],
    ['^10.0.0',       'npm',        'pin',      'npm:10.0.0'],
    ['workspace:^10', 'npm',        'pin',      'npm:10.0.0'],
    ['workspace:*',   'npm',        'pin',      'npm:*'],
    ['workspace:*',   'semver',     'pin',      '*'],
    ['workspace:^10', 'semver',     'inherit',  '^10.0.0'],
    ['*',             'semver',     'inherit',  '*'],
    ['*',             'workspace',  'inherit',  'workspace:*'],
  ];

  cases.forEach(([input, protocol, strategy, result]) => {
    assert.equal(mapReference(input, protocol, strategy), result)
  })
})

test.run()
