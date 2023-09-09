import {TEntry, TManifest, TSnapshot, TSnapshotIndex} from './interface'
import {debugAsJson, sortObject} from './util'

type TWalkCtx = {
  entry: TEntry
  idx: TSnapshotIndex
  prefix?: string
  depth?: number
  parentId?: string
  parents?: TEntry[]
}

const getDeps = (entry: TEntry, snap: TSnapshot, manifest: TManifest = (snap[""].manifest || {}) as TManifest): Record<string, string> => entry.name === ''
  ? {...sortObject(manifest.dependencies || {}), ...sortObject({...manifest.devDependencies, ...manifest.optionalDependencies})}
  : entry.dependencies ? sortObject(entry.dependencies): {}

const walk = (ctx: TWalkCtx) => {
  const {entry, prefix, depth = 0, parentId, idx, parents = []} = ctx
  const id = idx.getId(entry)
  const key = (prefix ? prefix + ',' : '') + entry.name

  if (!idx.tree[key]) {
    const chunks = key.split(',')
    const version = id.slice(id.lastIndexOf('@') + 1)
    idx.tree[key] = {
      key,
      chunks,
      id,
      name: entry.name,
      version,
      entry,
      parents
    }
    if (idx.prodRoots.includes(chunks[0])) {
      idx.prod.add(entry)
    }
    if (parentId) {
      idx.edges.push([parentId, id])
      return
    }
  }

  const dependencies = getDeps(entry, idx.snapshot)
  const stack: any[] = []

  Object.entries(dependencies).forEach(([name, range]) => {
    const _entry = idx.findEntry(name, range)
    if (!_entry) {
      throw new Error(`inconsistent snapshot: ${name} ${range}`)
    }
    const _ctx = {entry: _entry, prefix: key, depth: depth + 1, parentId: id, idx, parents: [...parents, entry]}
    walk(_ctx)
    idx.bound(entry, _entry)
    stack.push(_ctx)
  })

  stack.forEach(walk)
}

export const analyze = (snapshot: TSnapshot): TSnapshotIndex => {
  const rootEntry = snapshot[""]
  const prod =  new Set([rootEntry])
  const deps = new Map()
  const entries: TEntry[] = Object.values(snapshot)
  const edges: [string, string][] = []
  const tree: TSnapshotIndex['tree'] = {}
  const prodRoots = Object.keys(rootEntry?.manifest?.dependencies || {})

  rootEntry.name = '' // temporary workaround

  const idx = {
    snapshot,
    edges,
    tree,
    prod,
    prodRoots,
    deps,
    entries,
    bound(from: TEntry, to: TEntry) {
      const deps = this.getDeps(from)
      if (deps.includes(to)) {
        return
      }

      deps.push(to)
    },
    getDeps (entry: TEntry): TEntry[] {
      if (!deps.has(entry)) {
        deps.set(entry, [])
      }
      return deps.get(entry)
    },
    getId ({name, version}: TEntry): string {
      return `${name}@${version}`
    },
    getEntry (name: string, version?: string) {
      return snapshot[`${name || ''}${name && version ? '@' + version : ''}`]
    },
    findEntry (name: string, range: string) {
      return entries.find(({name: _name, ranges}) => name === _name && ranges.includes(range))
    }
  }

  // const queue: any[] = []

  walk({entry: rootEntry, idx})

  // debugAsJson('deptree.json', Object.values(tree).map(({parents, name}) => [...parents.map(p=> p.name).slice(1), name].join(',')))
  // debugAsJson('queue.json', queue)

  return idx
}
