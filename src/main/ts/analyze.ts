import {TEntry, TManifest, TSnapshot, TSnapshotIndex} from './interface'
import {debugAsJson, sortObject} from './util'

const getDeps = (entry: TEntry, snap: TSnapshot, manifest: TManifest = (snap[""].manifest || {}) as TManifest): Record<string, string> => entry === snap[""]
  ? {...sortObject(manifest.dependencies || {}), ...sortObject({...manifest.devDependencies, ...manifest.optionalDependencies})}
  : entry.dependencies ? sortObject(entry.dependencies): {}

type TWalkCtx = {
  root: TEntry,
  entry?: TEntry
  idx: TSnapshotIndex
  id?: string
  prefix?: string
  depth?: number
  parentId?: string
  parents?: TEntry[]
}

const walk = (ctx: TWalkCtx) => {
  const {root, entry = root, prefix, depth = 0, parentId, idx, id = idx.getEntryId(entry), parents = []} = ctx
  const key = (prefix ? prefix + ',' : '') + entry.name

  if (id === undefined) {
    throw new TypeError(`Invalid snapshot: ${key}`)
  }

  // console.log('key', depth, key)

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
    if (root.dependencies?.[chunks[1]] || idx.prodRoots.includes(chunks[1])) {
      idx.prod.add(entry)
    }
    if (parentId !== undefined) {
      idx.edges.push([parentId, id])
      return
    }
    if (depth) {
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
    idx.bound(entry, _entry)
    if (parents.includes(entry)) {
      return
    }
    const _ctx: TWalkCtx = {root, entry: _entry, prefix: key, depth: depth + 1, parentId: id, idx, parents: [...parents, entry]}
    walk(_ctx)
    stack.push(_ctx)
  })

  stack.forEach(walk)
}

export const getId = (name?: string, version: string = ''): string => name
  ? `${name}@${version}`
  : ''

export const analyze = (snapshot: TSnapshot): TSnapshotIndex => {
  const entries: TEntry[] = Object.values(snapshot)
  const workspaces = entries.filter(e => e.sourceType === 'workspace')
  const roots = [snapshot[""], ...workspaces]
  const rootEntry = snapshot[""]
  const prod =  new Set(roots)
  const deps = new Map()
  const edges: [string, string][] = []
  const tree: TSnapshotIndex['tree'] = {}
  const prodRoots = Object.keys(rootEntry?.manifest?.dependencies || {})
  const idx: TSnapshotIndex = {
    snapshot,
    roots,
    edges,
    tree,
    prod,
    prodRoots,
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
    getEntryId ({name, version}: TEntry): string {
      return getId(name, version)
    },
    getEntry (name: string, version?: string) {
      return snapshot[name] || snapshot[getId(name, version)]
    },
    findEntry (name: string, range: string) {
      return entries.find(({name: _name, ranges}) => name === _name && ranges.includes(range))
    }
  }

  roots.forEach((root, i) => walk({root, idx, id: i === 0 ? '' : undefined}))

  // walk({root: roots[0], idx, id: ''})
  // walk({root: roots[2], idx})

  debugAsJson('deptree.json', Object.values(tree).map(({parents, name}) => [...parents.map(p=> p.name).slice(1), name].join(',')))

  return idx
}
