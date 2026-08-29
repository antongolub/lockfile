const raw = (repository, commit, path) =>
  `https://raw.githubusercontent.com/${repository}/${commit}/${path}`

export const fixtures = [
  {
    id: 'yarn-classic-stack-beautifier',
    family: 'yarn-classic',
    format: 'yarn-classic',
    treeSurface: 'node_modules',
    lockfile: 'yarn.lock',
    repository: 'software-mansion-labs/stack-beautifier',
    commit: 'f219584dc46dce1aa9e230f7f9ffc20cc857a8fc',
    repositoryPath: 'yarn.lock',
    files: [
      { path: 'package.json', sha256: 'b6faa14f030fe27a5a90b53b3ca6a434f3f55113252c7357b7758194e1d5ae79' },
      { path: 'yarn.lock', sha256: '341da535b9a0ebcf595c100564ad9bbcf0315727212cdc0de0de0c73a27e816a' },
    ],
    tool: {
      alias: 'pm-yarn-1',
      version: '1.22.22',
      runtime: 'node22',
      bin: 'bin/yarn.js',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'],
    },
    allowedOrigins: [
      'https://raw.githubusercontent.com',
      'https://registry.npmjs.org',
      'https://registry.yarnpkg.com',
    ],
  },
  {
    id: 'yarn-classic-fem-downloader',
    family: 'yarn-classic',
    format: 'yarn-classic',
    treeSurface: 'node_modules',
    lockfile: 'yarn.lock',
    repository: 'brucebentley/fem-downloader',
    commit: '7e932b9e6215dab8491e26ee7b60913019337c0b',
    repositoryPath: 'yarn.lock',
    files: [
      { path: 'package.json', sha256: '127d5eee06df5bb8ac0001e58187a2a89c6985e86f4d71d40454444042e87cb3' },
      { path: 'yarn.lock', sha256: '4dba38d3c4f102b485c1b90dce44e9912477c6efdab8e134214818b50e4c6005' },
    ],
    tool: {
      alias: 'pm-yarn-1',
      version: '1.22.22',
      runtime: 'node22',
      bin: 'bin/yarn.js',
    },
    commands: {
      online: ['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'],
      offline: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'],
    },
    allowedOrigins: [
      'https://raw.githubusercontent.com',
      'https://registry.npmjs.org',
      'https://registry.yarnpkg.com',
    ],
  },
]

for (const fixture of fixtures) {
  for (const file of fixture.files) file.url = raw(fixture.repository, fixture.commit, file.path)
}
