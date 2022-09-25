import fs from 'node:fs/promises'
import path from 'node:path'

import * as assert from 'uvu/assert'

export const testParseFormatInterop =  async ({input, parse, format, opts}: {input: string, parse: any, format: any, opts?: any}) => {
    const lockfile: string = input.endsWith('/yarn.lock') ? await fs.readFile(path.resolve(input), 'utf-8') : input
    const obj = await parse(lockfile, opts)
    const output: string = await format(obj)

    // assert.ok(output === lockfile)
    const c1 = output.split('\n')
    const c2 = lockfile.split('\n')
    for (let i in c1) {
        if (c1[i] !== c2[i]) {
            assert.ok(false, `${c1[i]} !== ${c2[i]}, index: ${i}`)
        }
    }
}
