import fs from 'node:fs/promises'
import path from 'node:path'
import * as process from "process";

export const sortObject = <T extends Record<string, any>>(
  unordered: T,
  predicate: (a: [string, any], b: [string, any]) => number = ([a], [b]) => a > b ? 1 : -1 // This actually what npm does
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

export const debugAsJson = (name: string, data: any, temp = path.resolve(process.cwd(), 'temp')) =>
  process.env.DEBUG && fs.writeFile(path.resolve(temp, name), JSON.stringify(data, null, 2))
