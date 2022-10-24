import {THashes} from "./interface";

export const parseIntegrity = (integrity: string): THashes =>
    integrity.split(' ').reduce<THashes>((m, item) => {
        const [k, v] = item.split('-')
        if (k === 'sha512' || k === 'sha256' || k === 'sha1' || k === 'checksum') {
            m[k] = v
        }
        return m
    }, {})

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