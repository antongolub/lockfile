import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import * as assert from 'uvu/assert'
import {IFormat, IParse} from '../../main/ts/interface'

const checkLineByLine = (a: string, b: string) => {
    const c1: string[] = a.split('\n')
    const c2: string[] = b.split('\n')
    for (let i in c1) {
        if (c1[i] !== c2[i]) {
            fss.writeFileSync(path.resolve(process.cwd(), 'actual.txt'), b)
            assert.ok(false, `${c1[i]} !== ${c2[i]}, index: ${i}`)
        }
    }
}

export const testInterop =  async (parse: IParse, format: IFormat, ...args: string[]) => {
    const [lockfile, pkg] = args.map(v => (v.endsWith('/yarn.lock') || v.endsWith('/package-lock.json') || v.endsWith('/package.json'))
      ? fss.readFileSync(path.resolve(v), 'utf-8')
      : v
    )
    const snapshot = parse(lockfile, pkg)
    const _lockfile = format(snapshot)

    checkLineByLine(
      lockfile,
      _lockfile
    )
}

export const testInteropBySnapshot =  async (parse: IParse, format: IFormat, ...args: string[]) => {
    const [lockfile, pkg] = args.map(v => (v.endsWith('/yarn.lock') || v.endsWith('/package-lock.json') || v.endsWith('/package.json'))
      ? fss.readFileSync(path.resolve(v), 'utf-8')
      : v
    )
    const snapshot = parse(lockfile, pkg)
    const f = format(snapshot)
    const _snapshot = parse(f, pkg)

    const s1 = JSON.stringify(snapshot, null, 2)
    const s2 = JSON.stringify(_snapshot, null, 2)

    await fs.writeFile(path.resolve(process.cwd(), 'temp', 's1.json'), s1)
    await fs.writeFile(path.resolve(process.cwd(), 'temp', 's2.json'), s2)
    await fs.writeFile(path.resolve(process.cwd(), 'temp', 'pkg-lock.json'), f)

    checkLineByLine(
      s1,
      s2
    )

    // assert.ok(JSON.stringify(snapshot) === JSON.stringify(_snapshot))
}

export const tempy = async () =>
    fs.mkdtemp(path.join(os.tmpdir(), 'tempy-'))
