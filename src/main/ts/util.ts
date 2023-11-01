import fs from 'node:fs/promises'
import path from 'node:path'
import * as process from 'node:process'

export const sortObject = <T extends Record<string, any>>(
  unordered: T,
  predicate: (a: [string, any], b: [string, any]) => number = ([a], [b]) => a > b ? 1 : -1 // This is actually what npm does
): T =>
    Object.entries({...unordered})
        .sort(predicate)
        .reduce((obj, [key, value]: [keyof T, T[keyof T]]) => {
            obj[key] = value
            return obj
        },
        flushObject(unordered) as T,
    )

export const flushObject = (obj: Record<string, any>) => {
    for (const key in obj) {
        delete obj[key]
    }

    return obj
}

export const loadContents = async (value: string): Promise<string> =>
  value.includes('\n')
    ? value
    : fs.readFile(value, 'utf-8')

export const debug = Object.assign((...chunks: any[]) => {
  if (!debug.enable) return

  console.log(...chunks)
}, {
  enable: process.env.DEBUG,
  json(data: any, name: any = `debug-${Math.random().toString(16).slice(2)}.json`, base = path.resolve(process.cwd(), 'temp')) {
    if (!this.enable) return

    if (typeof data === 'string') {
      this.json(name, data)
      return
    }

    const _data = typeof data === 'function' ? data() : data

    fs.writeFile(path.resolve(base, name), JSON.stringify(_data, null, 2))
  }
})

export const unique = (arr: string[]): string[] => [...new Set(arr)]
