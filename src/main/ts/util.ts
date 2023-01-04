import fs from 'node:fs/promises'

export const sortObject = <T extends Record<string, any>>(unordered: T): T =>
    Object.entries({...unordered})
        .sort(([a], [b]) => a > b ? 1 : -1)
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
