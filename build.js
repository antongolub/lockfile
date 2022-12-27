import esbuild from 'esbuild'
import { nodeExternalsPlugin } from 'esbuild-node-externals'

esbuild.build({
  entryPoints: ['./src/main/ts/index.ts'],
  outfile: './target/es6/index.js',
  bundle: true,
  minify: false,
  sourcemap: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  plugins: [nodeExternalsPlugin()]
})
  .catch(() => process.exit(1))
