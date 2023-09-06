import {parse as parseNpm1, format as formatNpm1, check as checkNpm1} from './formats/npm-1'
import {parse as parseNpm2, format as formatNpm2, check as checkNpm2} from './formats/npm-2'
import {parse as parseYarn1, format as formatYarn1, check as checkYarn1} from './formats/yarn-1'
import {parse as parseYarn5, format as formatYarn5, check as checkYarn5} from './formats/yarn-5'
import {ICheck, IParse, TSnapshot} from './interface'

const isPkgJson = (input: string) => input.startsWith('{') && input.includes('"name":') && input.includes('"version":')
const variants: [ICheck, IParse][] = [
  [checkNpm1, parseNpm1],
  [checkNpm2, parseNpm2],
  [checkYarn1, parseYarn1],
  [checkYarn5, parseYarn5],
]
export const parse = (lockfile: string, ...pkgJsons: string[]): TSnapshot => {
  const [,parser] = variants.find(([check]) => check(lockfile)) || []

  if (!parser) {
    throw new TypeError('Unsupported lockfile format')
  }

  if (!pkgJsons.every(isPkgJson)) {
    throw new TypeError('Invalid package json')
  }

  return parser(lockfile, ...pkgJsons)
}
