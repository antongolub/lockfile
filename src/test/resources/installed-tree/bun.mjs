const raw = (repository, commit, path) =>
  `https://raw.githubusercontent.com/${repository}/${commit}/${path}`

const manifest = value => `${JSON.stringify(value, null, 2)}\n`

const repository = 'oven-sh/bun'
const commit = 'f91d5c95c9e235d65977e6c42446f4f6e7d3ae78'

export const fixtures = [
  {
    id: 'bun-gzip-bench',
    family: 'bun',
    format: 'bun-text',
    treeSurface: 'node_modules',
    lockfile: 'bun.lock',
    repository,
    commit,
    repositoryPath: 'bench/gzip/bun.lock',
    files: [
      {
        path: 'package.json',
        sha256: '45bf0d88a698c3d8c9d05a9bed5bc82fb68bdc045492661aa1e3359739332430',
        content: manifest({
          name: 'bench',
          version: '0.0.0',
          private: true,
          dependencies: { '@babel/standalone': '7.24.10' },
        }),
      },
      { path: 'bun.lock', sha256: 'b940a2cb65833e2005fbcd48bf59bf789a3283ffdf2376626204fb6408507213' },
    ],
    tool: {
      alias: 'bun',
      version: '1.3.14',
      runtime: 'native',
      bin: 'bin/bun.exe',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
  {
    id: 'bun-websocket-server-bench',
    family: 'bun',
    format: 'bun-text',
    treeSurface: 'node_modules',
    lockfile: 'bun.lock',
    repository,
    commit,
    repositoryPath: 'bench/websocket-server/bun.lock',
    files: [
      {
        path: 'package.json',
        sha256: '2ebee620c36c763333e45252c234a164dec13852edc15300a97699a4f0aa09fa',
        content: manifest({
          name: 'websocket-server',
          version: '0.0.0',
          private: true,
          dependencies: {
            bufferutil: '4.0.7',
            'utf-8-validate': '6.0.3',
            ws: '8.13.0',
          },
        }),
      },
      { path: 'bun.lock', sha256: 'b36901a2f15f6bbddf8aa2e03aaf1c8a6681f9d83775cbdcde26c16f3ec2d7c3' },
    ],
    tool: {
      alias: 'bun',
      version: '1.3.14',
      runtime: 'native',
      bin: 'bin/bun.exe',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
]

for (const fixture of fixtures) {
  const prefix = fixture.id.includes('websocket') ? 'bench/websocket-server/' : 'bench/gzip/'
  for (const file of fixture.files) {
    if (file.content === undefined) file.url = raw(repository, commit, `${prefix}${file.path}`)
  }
}
