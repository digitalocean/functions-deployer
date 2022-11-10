const esbuild = require('esbuild');

// Automatically exclude all node_modules from the bundled version
const { nodeExternalsPlugin } = require('esbuild-node-externals');

esbuild
  .build({
    // traverse dependency tree for bundling from this file
    entryPoints: ['./src/index.ts'],
    // built version of the library
    outfile: 'lib/index.js',
    // bundle & minify output file
    bundle: true,
    minify: false,
    platform: 'node',
    sourcemap: true,
    target: 'node14',
    external: ['*.html', '*.json'],
    plugins: [nodeExternalsPlugin()]
  })
  .catch(() => process.exit(1));
