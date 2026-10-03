// Builds dist-sidecar/sidecar.cjs (gitignored): the harness backend bundled for
// plain Node with 'electron' aliased to the sidecar shim.
// Usage: node src/nexus-sidecar/build.cjs
//
// Also stages node-pty prebuilds into build/Release (node-gyp-build resolution)
// so no native compile is needed.

const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const version = require(path.join(ROOT, 'package.json')).version;

esbuild.buildSync({
  entryPoints: [path.join(HERE, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: path.join(ROOT, 'dist-sidecar', 'sidecar.cjs'),
  alias: { electron: path.join(HERE, 'electron-shim.ts') },
  external: ['node-pty', 'better-sqlite3', 'ws'],
  // Mirror electron.vite.config.ts defines. Empty POSTHOG_KEY = telemetry off
  // (forks ship with no key and send nothing). __MD_SHELL_FENCE__ is
  // deliberately NOT defined — it must stay a literal (same as upstream).
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __POSTHOG_KEY__: JSON.stringify(''),
    __POSTHOG_HOST__: JSON.stringify('https://us.i.posthog.com'),
  },
  logLevel: 'warning',
});

// Stage node-pty binaries where its loader looks (build/Release).
const ptyPre = path.join(ROOT, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64');
const ptyRel = path.join(ROOT, 'node_modules', 'node-pty', 'build', 'Release');
if (fs.existsSync(ptyPre)) {
  fs.mkdirSync(ptyRel, { recursive: true });
  for (const f of fs.readdirSync(ptyPre)) {
    if (f.endsWith('.pdb')) continue;
    const src = path.join(ptyPre, f);
    const dst = path.join(ptyRel, f);
    if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
  console.log('node-pty prebuilds staged');
} else {
  console.log('WARN: node-pty prebuilds missing at ' + ptyPre);
}

console.log('sidecar bundle ok: dist-sidecar/sidecar.cjs');
