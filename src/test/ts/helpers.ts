import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import * as assert from 'uvu/assert'
import {IFormat, IParse} from '../../main/ts/interface'

export const testParseFormatInterop =  async (parse: IParse, format: IFormat, ...args: string[]) => {
    const [lockfile, pkg] = args.map(v => (v.endsWith('/yarn.lock') || v.endsWith('/package-lock.json') || v.endsWith('/package.json'))
      ? fss.readFileSync(path.resolve(v), 'utf-8')
      : v
    )
    const snapshot = parse(lockfile, pkg)
    const _lockfile = format(snapshot)

    const c1: string[] = _lockfile.split('\n')
    const c2: string[] = lockfile.split('\n')
    for (let i in c1) {
        if (c1[i] !== c2[i]) {
            await fs.writeFile(path.resolve(process.cwd(), 'actual.txt'), _lockfile)
            assert.ok(false, `${c1[i]} !== ${c2[i]}, index: ${i}`)
        }
    }
}

export const tempy = async () =>
    fs.mkdtemp(path.join(os.tmpdir(), 'tempy-'))
