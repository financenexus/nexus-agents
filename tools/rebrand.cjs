// tools/rebrand.cjs — re-applies Nexus Agents branding after `git pull` from upstream.
//
// Usage: node tools/rebrand.cjs
//
// Idempotent: running it twice changes nothing the second time.
// DELIBERATELY NEVER TOUCHED by this script:
//   - LICENSE, LICENSE-ASSETS, CONTRIBUTORS.md, attributions, copyright lines
//   - git remote / upstream owner+repo (updates still come from upstream)
//   - munderdiffl.in URLs, GitHub URLs, telemetry IDs
//   - the `munderdifflin://` share-link scheme (kept so existing hire links keep working)
//   - CHANGELOG.md history (past releases keep their real names)
//   - internal identifiers that would break code (CSS --cth-* vars, window.cth bridge,
//     hive folder layout, config keys). Those are renamed only via the Tauri migration.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PRODUCT = 'Nexus Agents';
const SLUG = 'nexus-agents';
const APP_ID = 'com.nexus.agents';
const ARTIFACT = 'Nexus-Agents';

const edits = [
  {
    file: 'package.json',
    pairs: [['"name": "munder-difflin"', '"name": "' + SLUG + '"']],
  },
  {
    file: 'src/renderer/index.html',
    pairs: [['<title>Munder Difflin</title>', '<title>' + PRODUCT + '</title>']],
  },
  {
    file: 'src/main/index.ts',
    pairs: [
      [
        "title: isFloor ? 'Munder Difflin — Floor' : 'Munder Difflin'",
        "title: isFloor ? '" + PRODUCT + " — Floor' : '" + PRODUCT + "'",
      ],
    ],
  },
  {
    file: 'electron-builder.yml',
    pairs: [
      ['appId: in.munderdiffl.app', 'appId: ' + APP_ID],
      ['productName: Munder Difflin', 'productName: ' + PRODUCT],
      ['shortcutName: Munder Difflin', 'shortcutName: ' + PRODUCT],
      ['title: Munder Difflin ${version}', 'title: ' + PRODUCT + ' ${version}'],
      ['Munder-Difflin-${version}', ARTIFACT + '-${version}'],
      ['- name: Munder Difflin', '- name: ' + PRODUCT],
    ],
  },
  {
    file: 'README.md',
    pairs: [['# Munder Difflin', '# ' + PRODUCT]],
  },
  {
    file: 'src-tauri/tauri.conf.json',
    pairs: [
      ['"productName": "Munder Difflin"', '"productName": "' + PRODUCT + '"'],
      ['"identifier": "in.munderdiffl.app"', '"identifier": "' + APP_ID + '"'],
    ],
  },
];

let changedFiles = 0;
for (const { file, pairs } of edits) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    console.log('SKIP (missing): ' + file);
    continue;
  }
  let text = fs.readFileSync(abs, 'utf8');
  let changed = false;
  for (const [from, to] of pairs) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      changed = true;
      console.log('  [' + file + '] ' + JSON.stringify(from.slice(0, 60)));
    }
  }
  if (changed) {
    fs.writeFileSync(abs, text);
    changedFiles++;
  }
}
console.log(changedFiles === 0 ? 'Rebrand: already applied.' : 'Rebrand applied to ' + changedFiles + ' file(s).');
