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

// Optional: inject the bridge into a built renderer (Tauri packaging).
// NEXUS_RENDERER_OUT=out/renderer → copies cth-ws.js beside index.html and
// inserts <script src="./cth-ws.js"> first in <head> so window.cth exists
// before the React app boots.
const rendererOut = process.env.NEXUS_RENDERER_OUT;
if (rendererOut) {
  const outDir = path.isAbsolute(rendererOut) ? rendererOut : path.join(ROOT, rendererOut);
  const htmlPath = path.join(outDir, 'index.html');
  fs.copyFileSync(path.join(ROOT, 'dist-web', 'cth-ws.js'), path.join(outDir, 'cth-ws.js'));
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('cth-ws.js')) {
    html = html.replace('<head>', '<head><script src="./cth-ws.js"></script>');
    fs.writeFileSync(htmlPath, html);
  }
  console.log('bridge injected into ' + htmlPath);
}
