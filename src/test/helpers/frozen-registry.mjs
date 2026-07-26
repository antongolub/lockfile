import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const defaultTarball = readFileSync(process.argv[2])
const fseventsTarball = process.argv[3] === undefined
  ? defaultTarball
  : readFileSync(process.argv[3])
const fixtures = {
  ms: { version: '2.1.3', extra: {}, tarball: defaultTarball },
  fsevents: {
    version: '2.3.3',
    extra: {
      os: ['darwin'],
      scripts: { build: 'node-gyp rebuild' },
    },
    tarball: fseventsTarball,
  },
  'node-gyp': { version: '11.5.0', extra: {}, tarball: defaultTarball },
}

const server = createServer((request, response) => {
  const base = `http://127.0.0.1:${server.address().port}`
  const path = new URL(request.url, base).pathname
  const packageName = path.slice(1)
  const fixture = fixtures[packageName]
  if (fixture !== undefined) {
    const sha1 = createHash('sha1').update(fixture.tarball).digest('hex')
    const integrity = `sha512-${createHash('sha512').update(fixture.tarball).digest('base64')}`
    const body = Buffer.from(JSON.stringify({
      name: packageName,
      'dist-tags': { latest: fixture.version },
      versions: {
        [fixture.version]: {
          name: packageName,
          version: fixture.version,
          ...fixture.extra,
          dist: {
            tarball: `${base}/${packageName}/-/${packageName}-${fixture.version}.tgz`,
            shasum: sha1,
            integrity,
          },
        },
      },
    }))
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(body.length),
    })
    if (request.method !== 'HEAD') response.end(body)
    else response.end()
    return
  }
  const tarballMatch = /^\/(ms|fsevents|node-gyp)\/-\/[^/]+\.tgz$/.exec(path)
  if (tarballMatch !== null) {
    const body = fixtures[tarballMatch[1]].tarball
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    })
    if (request.method !== 'HEAD') response.end(body)
    else response.end()
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'not found' }))
})

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${server.address().port}\n`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
