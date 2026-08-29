const raw = (repository, commit, path) =>
  `https://raw.githubusercontent.com/${repository}/${commit}/${path}`

const manifest = value => `${JSON.stringify(value, null, 2)}\n`

export const fixtures = [
  {
    id: 'yarn-berry-v8-thermal',
    family: 'yarn-berry',
    format: 'yarn-berry-v8',
    treeSurface: 'node_modules',
    lockfile: 'yarn.lock',
    repository: 'DillonJettCallis/thermal',
    commit: '57bd5a307326e14a83ed6f719840b315a4a6233a',
    repositoryPath: 'yarn.lock',
    files: [
      {
        path: 'package.json',
        sha256: 'b2461b990b53dd115242f240181fe56ba500141726f2a6e56c70a2e97560b6e5',
        content: manifest({
          name: 'thermal',
          version: '0.0.0-use.local',
          private: true,
          dependencies: {
            '@types/node': '20.11.17',
            immutable: '4.3.5',
            typescript: '5.3.3',
          },
        }),
      },
      { path: 'yarn.lock', sha256: '1aef7c8cbe681e13787a7ab57e696c233fefb54b861d7f11442d9d9ec733ba92' },
    ],
    tool: {
      alias: 'pm-yarn-berry-v8',
      version: '4.13.0',
      runtime: 'node22',
      bin: 'bin/yarn.js',
    },
    commands: {
      online: ['install', '--immutable', '--mode=skip-build'],
      offline: ['install', '--immutable', '--mode=skip-build'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
  {
    id: 'yarn-berry-v8-vite-plugin-emit-qr',
    family: 'yarn-berry',
    format: 'yarn-berry-v8',
    treeSurface: 'node_modules',
    lockfile: 'yarn.lock',
    repository: 'RandomSearch18/vite-plugin-emit-qr',
    commit: '8654a938eeeaea063585ce45d0aaf143fbfad4d0',
    repositoryPath: 'test-project/yarn.lock',
    files: [
      {
        path: 'package.json',
        sha256: 'e107cb07ed4b5a0fff024316e9325b7b8f80d598c83c4724ec8e7279cfd1fbd7',
        content: manifest({
          name: 'vite-plugin-emit-qr-test-project',
          version: '0.0.0-use.local',
          private: true,
          dependencies: {
            rollup: '^4.32.0',
            typescript: '~5.6.2',
            'vite-plugin-html': '^3.2.2',
            'vite-plugin-inspect': '^10.0.6',
            'vite-plugin-singlefile': '^2.1.0',
            vite: '^6.0.11',
          },
        }),
      },
      { path: 'yarn.lock', sha256: 'fb369e991a86422cf67e0c289265f7e8ac25eaee90382a4cef5aa31791b41782' },
    ],
    tool: {
      alias: 'pm-yarn-berry-v8',
      version: '4.13.0',
      runtime: 'node22',
      bin: 'bin/yarn.js',
    },
    commands: {
      online: ['install', '--immutable', '--mode=skip-build'],
      offline: ['install', '--immutable', '--mode=skip-build'],
    },
    allowedOrigins: ['https://raw.githubusercontent.com', 'https://registry.npmjs.org'],
  },
]

for (const fixture of fixtures) {
  for (const file of fixture.files) {
    if (file.content === undefined) {
      const prefix = fixture.id.includes('vite-plugin') ? 'test-project/' : ''
      file.url = raw(fixture.repository, fixture.commit, `${prefix}${file.path}`)
    }
  }
}
