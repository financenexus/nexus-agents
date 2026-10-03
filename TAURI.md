# Nexus Agents — Tauri migration (from Munder Difflin Electron base)

Fork base: upstream `munder-difflin` (MIT). This document tracks the move from
Electron to a **Tauri shell + Node sidecar**. No Pro/license code is touched —
the fork builds only on the free open-source core plus our own features.

## Architecture

```
Tauri window (Rust, src-tauri/)          Node sidecar (src/nexus-sidecar, from src/main)
  - hosts the webview                      - hive, pty (node-pty), sqlite (better-sqlite3)
  - native menus/dialogs/updater           - serves 127.0.0.1 WebSocket API:
  - spawns sidecar via plugin-shell           invoke(channel, args) / subscribe(event)
Renderer (src/renderer, React)
  - window.cth shim -> WebSocket (works in Tauri webview AND plain browser)
  - 137 window.cth.* methods + event subscriptions (counted 2026-10-02)
```

## Status

- [x] `src-tauri/` scaffold: productName **Nexus Agents**, id `com.nexus.agents`
      (`cargo check` passes)
- [x] Icons generated from `build/icon.png` (replace with Nexus art later)
- [x] `tools/rebrand.cjs` — re-run after every upstream `git pull`
- [ ] Node sidecar bundle (esbuild `src/main` -> single cjs, electron imports stubbed)
- [ ] `window.cth` WebSocket shim in renderer
- [ ] Standalone vite config for renderer (port 1420) replacing electron-vite dev
- [ ] Tauri updater + installer branding (replaces electron-builder/updater)

## Commands

```bash
node tools/rebrand.cjs          # re-apply branding after git pull
cargo check --manifest-path src-tauri/Cargo.toml
```

## After every upstream update

```bash
git pull upstream main
node tools/rebrand.cjs
# resolve conflicts in src/main + src/renderer, then re-run checks
```

Kept intentionally unchanged for compatibility: `munderdifflin://` link scheme,
upstream repo URLs, telemetry IDs, CHANGELOG history, MIT/LimeZu attributions.
