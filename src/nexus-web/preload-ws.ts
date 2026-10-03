/**
 * Nexus Agents web entry for the shared preload bridge.
 *
 * The upstream preload (src/preload/index.ts) builds the whole `cth` API from
 * an `ipcRenderer`-shaped transport. Bundle THIS file with
 * src/nexus-web/build-web.cjs (aliases 'electron' to electron-web-shim.ts).
 *
 * Result: window.cth with every preload method, talking to the sidecar over
 * WS — zero per-method maintenance when upstream edits the preload.
 */

// Side-effect import: evaluates exposeInMainWorld('cth', api).
import '../preload/index';
