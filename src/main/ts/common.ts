import {TSnapshot} from './interface'

export const normalizeOptions = () => {

}

export const getSources = (snapshot: TSnapshot): string[] =>
  Object.values(snapshot.entries)
    .map(entry => entry.source as string)
    .filter(Boolean)
