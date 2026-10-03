// Bundles the upstream preload bridge for web/Tauri (window.cth over WS).
// Usage: node src/nexus-web/build-web.cjs
// Output: dist-web/cth-ws.js (gitignored) — load it before the renderer app.

const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const version = require(path.join(ROOT, 'package.json')).version;

esbuild.buildSync({
  entryPoints: [path.join(HERE, 'preload-ws.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: path.join(ROOT, 'dist-web', 'cth-ws.js'),
  alias: { electron: path.join(HERE, 'electron-web-shim.ts') },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
});

console.log('web bridge bundle ok: dist-web/cth-ws.js');
