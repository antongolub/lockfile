import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import path from 'node:path'
import fs from 'node:fs/promises'
import {parse, format} from '../../main/ts/yarn-1'

const test = suite('yarn-1')
const fixtures = path.resolve(__dirname, '../fixtures/yarn-1')


// const lockfile = `
//   "@parcel/fs-write-stream-atomic@^2.0.1":
//   version "2.0.1"
//   resolved "https://registry.yarnpkg.com/@parcel/fs-write-stream-atomic/-/fs-write-stream-atomic-2.0.1.tgz#700f9f2b3761494af305e71a185117e804b1ae41"
//   integrity sha512-+CSeXRCnI9f9K4jeBOYzZiOf+qw6t3TvhEstR/zeXenzx0nBMzPv28mjUMZ33vRMy8bQOHAim8qy/AMSIMolEg==
//   dependencies:
//     graceful-fs "^4.1.2"
//     iferr "^1.0.2"
//     imurmurhash "^0.1.4"
//     readable-stream "1 || 2"
// `

test('parse/format interop', async () => {
  const lockfile = await fs.readFile(path.resolve(fixtures, 'yarn.lock'), 'utf-8')
  const pkgjson = await fs.readFile(path.resolve(fixtures, 'package.json'), 'utf-8')

  const obj = await parse(lockfile)
  const output = await format(obj)

  // assert.ok(output === lockfile)
  const c1 = output.split('\n')
  const c2 = lockfile.split('\n')
  for (let i in c1) {
    if (c1[i] !== c2[i]) {
      assert.ok(false, `${c1[i]} !== ${c2[i]}, index: ${i}`)
    }
  }
  //
  // console.log(output.length, lockfile.length)
  // console.log(output.slice(0, 3000))
  // console.log(lockfile.slice(0, 3000))
})

test.run()
