const raw = (repository, commit, path) =>
  `https://raw.githubusercontent.com/${repository}/${commit}/${path}`

export const fixtures = [
  {
    id: 'pnpm-v6-type-challenges',
    family: 'pnpm',
    format: 'pnpm-v6',
    lockfile: 'pnpm-lock.yaml',
    repository: 'type-challenges/type-challenges',
    commit: '71ea914fc64dba977f4a453c58796b344f938145',
    files: [
      {
        path: 'package.json',
        sha256: 'ffb255c7d9facf9c59705fa34dce0e26ececa4e019e1aa856fe9d4a373d99de1',
      },
      {
        path: 'pnpm-lock.yaml',
        sha256: '16f346844b0368a7652883b63319bb93c94b9b8b7af55d3de4ffcfbd1a92c4b2',
      },
      {
        path: 'pnpm-workspace.yaml',
        sha256: 'a82441b15536e0d5c0879024a911bcc269bf8b870d8ff47cd9f16288498bcb67',
      },
      {
        path: 'scripts/package.json',
        sha256: 'a080af9c96fe22a91f5798873b261327eacb277a3194248d24cc4ddbcb869c4e',
      },
      {
        path: 'utils/package.json',
        sha256: '346733d5306c98ec66876b408ce1c34509d7e5124fbaa5792bbb3d50dd18d2a2',
      },
    ],
    tool: {
      alias: 'pm-pnpm-8',
      version: '8.15.9',
      runtime: 'node18',
      bin: 'bin/pnpm.cjs',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only'],
      rebuild: ['rebuild', '--pending', '--reporter=append-only'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
  {
    id: 'pnpm-v9-json-server',
    family: 'pnpm',
    format: 'pnpm-v9',
    lockfile: 'pnpm-lock.yaml',
    repository: 'typicode/json-server',
    commit: 'c3afd0fb197bfc5e790bd1a3d2df8dce6f2a4780',
    files: [
      {
        path: 'package.json',
        sha256: 'd9497e293aec29962c8539e091c59be2ad5a60ab27c0028389680c0731325657',
      },
      {
        path: 'pnpm-lock.yaml',
        sha256: 'e096c4d631579683065728527782af63d413831003cb6916d3cf5dbfd050b6c6',
      },
    ],
    tool: {
      alias: 'pm-pnpm-10',
      version: '10.34.5',
      runtime: 'node22',
      bin: 'bin/pnpm.cjs',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--reporter=append-only'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
]

for (const fixture of fixtures) {
  for (const file of fixture.files) {
    file.url = raw(fixture.repository, fixture.commit, file.path)
  }
}
