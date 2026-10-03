/**
 * Nexus Agents sidecar entry point.
 *
 * Boots the harness backend (src/main, bundled with electron-shim) headless and
 * exposes its ipcMain registry over a localhost WebSocket:
 *
 *   C→S  { t: 'invoke', id, channel, args }  →  S→C { t: 'res', id, ok, result|error }
 *   C→S  { t: 'send', channel, args }        →  runs ipcMain.on handlers (no reply)
 *   S→C  { t: 'event', channel, args }       →  renderer event channels
 *   C→S  { t: 'sync', id, channel, args }    →  S→C { t: 'res', ... } (for sendSync callers;
 *        the web transport answers from cache — see src/nexus-web/ipc-ws.ts)
 *
 * Env:
 *   NEXUS_SIDECAR_PORT  (default 4317)
 *   NEXUS_AGENTS_HOME   (default %APPDATA%/Nexus Agents — fresh dir, NOT shared
 *                        with any Electron install, so floors never collide)
 *   NEXUS_APPROOT       (default: repo root)
 */

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  configureShim,
  getInvokeHandler,
  getOnHandlers,
  makeIpcEvent,
  setBroadcast,
  emitAppQuitEvents,
  listChannels,
} from './electron-shim';
import type { IpcSender } from './electron-shim';

const APP_ROOT = process.env.NEXUS_APPROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.NEXUS_SIDECAR_PORT || 4317);
const pkgVersion: string = JSON.parse(
  fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'),
).version as string;
const USER_DATA =
  process.env.NEXUS_AGENTS_HOME ||
  path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Nexus Agents',
  );

configureShim({ appRoot: APP_ROOT, userData: USER_DATA, version: pkgVersion });

const sockets = new Set<WebSocket>();

setBroadcast((channel: string, ...args: unknown[]) => {
  const msg = JSON.stringify({ t: 'event', channel, args });
  for (const s of sockets) {
    if (s.readyState === 1) s.send(msg);
  }
});

function senderFor(ws: WebSocket): IpcSender {
  return {
    id: 1,
    send: (channel: string, ...args: unknown[]) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'event', channel, args }));
    },
  };
}

async function handleInvoke(id: number, channel: string, args: unknown[], ws: WebSocket): Promise<void> {
  const fn = getInvokeHandler(channel);
  if (!fn) {
    ws.send(JSON.stringify({ t: 'res', id, ok: false, error: 'no-handler:' + channel }));
    return;
  }
  try {
    const result = await fn(makeIpcEvent(senderFor(ws)), ...args);
    ws.send(JSON.stringify({ t: 'res', id, ok: true, result: result === undefined ? null : result }));
  } catch (e: unknown) {
    ws.send(
      JSON.stringify({ t: 'res', id, ok: false, error: String((e as Error)?.message ?? e) }),
    );
  }
}

function handleSend(channel: string, args: unknown[], ws: WebSocket): void {
  const sender = senderFor(ws);
  for (const fn of getOnHandlers(channel)) {
    try {
      fn(makeIpcEvent(sender), ...args);
    } catch (e) {
      console.error('[sidecar] on-handler ' + channel + ' threw', e);
    }
  }
}

function handleSync(id: number, channel: string, args: unknown[], ws: WebSocket): void {
  // sendSync callers in the renderer use ipcMain.on + event.returnValue handlers.
  const fns = getOnHandlers(channel);
  const sender = senderFor(ws);
  const evt = { ...makeIpcEvent(sender), returnValue: undefined as unknown };
  for (const fn of fns) {
    try {
      fn(evt, ...args);
    } catch (e) {
      console.error('[sidecar] sync-handler ' + channel + ' threw', e);
    }
  }
  ws.send(JSON.stringify({ t: 'res', id, ok: true, result: evt.returnValue ?? null }));
}

async function boot(): Promise<void> {
  // Registers every ipcMain handler and starts hive/watchers/timers.
  await import('../main/index');
  const ch = listChannels();
  console.log(`[sidecar] ${ch.invoke.length} invoke + ${ch.on.length} on channels registered`);

  const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  wss.on('connection', (ws: WebSocket) => {
    sockets.add(ws);
    ws.on('message', (raw: Buffer) => {
      let msg: { t: string; id?: number; channel?: string; args?: unknown[] };
      try {
        msg = JSON.parse(String(raw)) as typeof msg;
      } catch {
        return;
      }
      if (msg.t === 'invoke' && typeof msg.id === 'number' && msg.channel) {
        void handleInvoke(msg.id, msg.channel, msg.args ?? [], ws);
      } else if (msg.t === 'send' && msg.channel) {
        handleSend(msg.channel, msg.args ?? [], ws);
      } else if (msg.t === 'sync' && typeof msg.id === 'number' && msg.channel) {
        handleSync(msg.id, msg.channel, msg.args ?? [], ws);
      }
    });
    ws.on('close', () => {
      sockets.delete(ws);
    });
  });

  console.log(`[sidecar] Nexus Agents backend on 127.0.0.1:${PORT} (home: ${USER_DATA})`);

  const shutdown = (): void => {
    if (!emitAppQuitEvents()) process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot().catch((e) => {
  console.error('[sidecar] boot failed', e);
  process.exit(1);
});
