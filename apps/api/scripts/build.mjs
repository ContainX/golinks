// Bundles the service entry point (dist/index.js) and the command-line tool (dist/cli.js).
// Workspace packages (@golinks/*) are bundled from source; every other bare import stays
// external and is resolved from node_modules at runtime.
import { build } from 'esbuild'

const externalizeNodeModules = {
  name: 'externalize-node-modules',
  setup(api) {
    api.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@golinks/') ? null : { path: args.path, external: true },
    )
  },
}

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalizeNodeModules],
})
