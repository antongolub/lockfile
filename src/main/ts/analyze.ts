import {TLockfileEntry, TSnapshot} from './interface'
import {debugAsJson, sortObject} from './util'

export interface TSnapshotIndex {
  edges: [string, string][]
  tree: Record<string, {
    key: string
    chunks: string[]
    id: string
    name: string
    version: string
    entry: TLockfileEntry
  }>
  prod: Set<TLockfileEntry>
  getDeps(entry: TLockfileEntry): TLockfileEntry[]
  getId ({name, version}: TLockfileEntry): string
  getEntry (name: string, version?: string): TLockfileEntry | undefined,
  findEntry (name: string, range: string): TLockfileEntry | undefined
}

export const analyze = (snapshot: TSnapshot): TSnapshotIndex => {
  const rootEntry = snapshot.entries[""]
  const prod =  new Set([rootEntry])
  const deps = new Map()
  const entries: TLockfileEntry[] = Object.values(snapshot.entries)
  const edges: [string, string][] = []
  const tree: TSnapshotIndex['tree'] = {}
  const prodRoots = Object.keys(snapshot.manifest.dependencies || {})

  const idx = {
    edges,
    tree,
    prod,
    deps,
    entries,
    getDeps (entry: TLockfileEntry): TLockfileEntry[] {
      if (!deps.has(entry)) {
        deps.set(entry, [])
      }
      return deps.get(entry)
    },
    getId ({name, version}: TLockfileEntry): string {
      return `${name}@${version}`
    },
    getEntry (name: string, version?: string) {
      return snapshot.entries[`${name || ''}${name && version ? '@' + version : ''}`]
    },
    findEntry (name: string, range: string) {
      return entries.find(({name: _name, ranges}) => name === _name && ranges.includes(range))
    }
  }

  const done: any[] = []
  const getDeps = (entry: TLockfileEntry, snap: TSnapshot): Record<string, string> => entry.name === ''
    ? {...sortObject(snap.manifest.dependencies || {}), ...sortObject({...snap.manifest.devDependencies, ...snap.manifest.optionalDependencies})}
    : entry.dependencies ? sortObject(entry.dependencies): {}

  const walk = (ctx: {entry: TLockfileEntry, prefix?: string, depth?: number, parentId?: string}) => {
    const {entry, prefix, depth = 0, parentId} = ctx
    const id = idx.getId(entry)
    const key = (prefix ? prefix + ',' : '') + entry.name

    if (!tree[key]) {
      const chunks = key.split(',')
      const version = id.slice(id.lastIndexOf('@') + 1)
      tree[key] = {
        key,
        chunks,
        id,
        name: entry.name,
        version,
        entry
      }
      if (prodRoots.includes(chunks[0])) {
        prod.add(entry)
      }
      if (parentId) {
        edges.push([parentId, id])
        return
      }
    }

    const dependencies = getDeps(entry, snapshot)
    const stack: any[] = []

    Object.entries(dependencies).forEach(([name, range]) => {
      const _entry = idx.findEntry(name, range)
      if (!_entry) {
        throw new Error(`inconsistent snapshot: ${name} ${range}`)
      }
      const _ctx = {entry: _entry, prefix: key, depth: depth + 1, parentId: id}
      walk(_ctx)
      stack.push(_ctx)
    })

    stack.forEach(walk)
  }
  walk({entry: {...rootEntry, name: ''}})

  debugAsJson('deptree.json', tree)
  debugAsJson('queue.json', done)

  entries.forEach((entry) => {
    entry.dependencies && Object.entries(entry.dependencies).forEach(([_name, range]) => {
      const target = entries.find(({name, ranges}) => name === _name && ranges.includes(range))
      if (!target) {
        throw new Error(`inconsistent snapshot: ${_name} ${range}`)
      }
      idx.getDeps(entry).push(target)
    })
  })

  return idx
}