import { suite } from 'uvu'
import path from 'node:path'
import fs from 'node:fs/promises'
import {parse, format, preparse} from '../../main/ts/formats/yarn-1'
import { testParseFormatInterop } from './helpers'

const test = suite('yarn-1')
// const fixtures = path.resolve(__dirname, '../fixtures/yarn-1')


// test.only('parse() returns valid dep snapshot', async () => {
//   const input = `
// "@parcel/fs-write-stream-atomic@^2.0.1":
//   version "2.0.1"
//   resolved "https://registry.yarnpkg.com/@parcel/fs-write-stream-atomic/-/fs-write-stream-atomic-2.0.1.tgz#700f9f2b3761494af305e71a185117e804b1ae41"
//   integrity sha512-+CSeXRCnI9f9K4jeBOYzZiOf+qw6t3TvhEstR/zeXenzx0nBMzPv28mjUMZ33vRMy8bQOHAim8qy/AMSIMolEg==
//   dependencies:
//     graceful-fs "^4.1.2"
//     iferr "^1.0.2"
//     imurmurhash "^0.1.4"
//     readable-stream "1 || 2"
// `
//   const snap = await parse(input)
//   console.log('snap', snap)
// })

// test.only('parse() returns valid dep snapshot', async () => {
//   const lf = await fs.readFile(path.resolve(__dirname, '../fixtures/yarn-1/yarn.lock'), 'utf8')
//   const snap = await parse(lf)
//   // console.log('snap', snap)
// })

test('parse/format interop for regular repo', async () => {
  await testParseFormatInterop(
    parse,
    format,
    path.resolve(__dirname, '../fixtures/yarn-1/yarn.lock'),
    path.resolve(__dirname, '../fixtures/yarn-1/package.json'),
  )
})

test('parse/format interop for monorepo', async () => {
  await testParseFormatInterop(
    parse,
    format,
    path.resolve(__dirname, '../fixtures/yarn-1-mr/yarn.lock'),
    path.resolve(__dirname, '../fixtures/yarn-1-mr/package.json'),
  )
})

test.run()
