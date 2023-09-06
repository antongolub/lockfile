import {parse as parseNpm1, format as formatNpm1, check as checkNpm1} from './formats/npm-1'
import {parse as parseNpm2, format as formatNpm2, check as checkNpm2} from './formats/npm-1'
import {parse as parseYarn1, format as formatYarn1, check as checkYarn1} from './formats/yarn-1'
import {parse as parseYarn5, format as formatYarn5, check as checkYarn5} from './formats/yarn-5'
import {TSnapshot} from './interface'

export const foo = 'bar'

export { getSources } from './common'

export {
  parseNpm1,
  formatNpm1,
  parseYarn1,
  formatYarn1,
  parseYarn5,
  formatYarn5
}

export const parse = async (lockfile: string, pkg: string): Promise<TSnapshot> => {
  if (checkYarn1(lockfile)) {
    return parseYarn1(lockfile)
  }

  if (checkYarn5(lockfile)) {
    return parseYarn5(lockfile, pkg)
  }

  return parseNpm1(lockfile, pkg)
}