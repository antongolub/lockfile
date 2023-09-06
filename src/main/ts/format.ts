import {TSnapshot} from './interface'

import {version as versionNpm1, format as formatNpm1} from './formats/npm-1'
import {version as versionNpm2, format as formatNpm2} from './formats/npm-2'
import {version as versionYarn1, format as formatYarn1} from './formats/yarn-1'
import {version as versionYarn5, format as formatYarn5} from './formats/yarn-5'

const variants = [
  [versionNpm1, formatNpm1],
  [versionNpm2, formatNpm2],
  [versionYarn1, formatYarn1],
  [versionYarn5, formatYarn5],
]

export const format = (snapshot: TSnapshot, version: string, meta: any = {}): string => {
  const [,formatter] = variants.find(([_version]) => version === _version) || []

  if (!formatter) {
    throw new TypeError(`Unsupported lockfile format: ${version}`)
  }

  return 'test'
}
