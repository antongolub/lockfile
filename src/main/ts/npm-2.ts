import {TSnapshot} from './interface'

export const parse = async (value: string): Promise<TSnapshot> => {
    return {
        format: 'npm-1',
        entries: {}
    }
}

export const format = async (snap: TSnapshot): Promise<string> => {
    return ''
}
