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
    Object.keys(unordered).sort().reduce(
        (obj, key: keyof T) => {
            obj[key] = unordered[key]
            return obj
        },
        {} as T,
    )
