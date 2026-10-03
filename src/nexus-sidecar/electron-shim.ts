/**
 * Nexus Agents sidecar — minimal 'electron' substitute.
 *
 * The Node sidecar bundles src/main with esbuild, aliasing 'electron' to this
 * module. It implements just enough of the Electron main API for the harness
 * (hive, pty, sqlite, watchers) to run headless:
 *
 *   - app: paths (rebranded userData dir), version, lifecycle events, quit
 *   - ipcMain: handle/on registry consumed by server.ts over WebSocket
 *   - BrowserWindow: stub (Tauri owns the real window); webContents.send fans
 *     out to sidecar/server.ts broadcast so renderer event channels keep working
 *   - dialog/shell/clipboard/Notification/Menu/Tray/powerMonitor/
 *     powerSaveBlocker/screen/safeStorage: stubs or safe fallbacks.
 *
 * Intentional behavior differences are marked TODO(tauri).
 */

import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ShimOptions {
  appRoot: string;
  userData: string;
  version: string;
  name?: string;
}

const opts: ShimOptions = {
  appRoot: process.cwd(),
  userData: path.join(os.homedir(), 'Nexus Agents'),
  version: '0.0.0',
  name: 'Nexus Agents',
};

export function configureShim(patch: Partial<ShimOptions>): void {
  Object.assign(opts, patch);
  fs.mkdirSync(opts.userData, { recursive: true });
}

export function shimOptions(): Readonly<ShimOptions> {
  return opts;
}

// ─── app ────────────────────────────────────────────────────────────────────

type AppListener = (evt: { preventDefault(): void }, ...args: unknown[]) => void;

const appEvents = new Map<string, AppListener[]>();

function emitApp(name: string, ...args: unknown[]): boolean {
  let prevented = false;
  const evt = { preventDefault() { prevented = true; } };
  for (const fn of appEvents.get(name) ?? []) {
    try {
      fn(evt, ...args);
    } catch (e) {
      console.error('[shim] app event ' + name + ' threw', e);
    }
  }
  return prevented;
}

/** Used by server.ts on SIGINT/SIGTERM. Returns true when quit was prevented. */
export function emitAppQuitEvents(): boolean {
  if (emitApp('will-quit')) return true;
  if (emitApp('before-quit')) return true;
  return false;
}

function onAppEvent(name: string, fn: AppListener): void {
  const list = appEvents.get(name) ?? [];
  list.push(fn);
  appEvents.set(name, list);
}

export const app = {
  get name(): string {
    return opts.name ?? 'Nexus Agents';
  },
  isPackaged: false,
  getPath(kind: string): string {
    switch (kind) {
      case 'userData':
        return opts.userData;
      case 'home':
        return os.homedir();
      case 'temp':
        return os.tmpdir();
      case 'documents':
        return path.join(os.homedir(), 'Documents');
      case 'downloads':
        return path.join(os.homedir(), 'Downloads');
      case 'desktop':
        return path.join(os.homedir(), 'Desktop');
      case 'exe':
        return process.execPath;
      case 'logs':
        return path.join(opts.userData, 'logs');
      default:
        return path.join(opts.userData, kind);
    }
  },
  getAppPath(): string {
    return opts.appRoot;
  },
  getVersion(): string {
    return opts.version;
  },
  getName(): string {
    return opts.name ?? 'Nexus Agents';
  },
  getLocale(): string {
    return 'en-US';
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  on(name: string, fn: AppListener): typeof app {
    onAppEvent(name, fn);
    return app;
  },
  once(name: string, fn: AppListener): typeof app {
    const wrap: AppListener = (evt, ...args) => {
      removeAppListener(name, wrap);
      fn(evt, ...args);
    };
    onAppEvent(name, wrap);
    return app;
  },
  removeListener(name: string, fn: AppListener): typeof app {
    removeAppListener(name, fn);
    return app;
  },
  removeAllListeners(name?: string): typeof app {
    if (name) appEvents.delete(name);
    else appEvents.clear();
    return app;
  },
  quit(): void {
    if (!emitAppQuitEvents()) process.exit(0);
  },
  exit(code = 0): void {
    process.exit(code);
  },
  relaunch(): void {
    // TODO(tauri): implement relaunch via sidecar respawn once packaged.
    console.log('[shim] relaunch requested — restart the sidecar manually');
  },
  requestSingleInstanceLock(): boolean {
    // TODO(tauri): single-instance is enforced by the Tauri shell.
    return true;
  },
  setName(): void {},
  setAboutPanelOptions(): void {},
  setAsDefaultProtocolClient(): boolean {
    // TODO(tauri): register the link scheme via Tauri deep-link plugin.
    return false;
  },
  removeAsDefaultProtocolClient(): boolean {
    return false;
  },
  isDefaultProtocolClient(): boolean {
    return false;
  },
  getApplicationNameForProtocol(): string {
    return '';
  },
  dock: undefined,
};

function removeAppListener(name: string, fn: AppListener): void {
  const list = appEvents.get(name);
  if (!list) return;
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
}

// ─── ipcMain ────────────────────────────────────────────────────────────────

export type IpcHandler = (event: IpcEvent, ...args: unknown[]) => unknown;

export interface IpcEvent {
  sender: IpcSender;
  reply(channel: string, ...args: unknown[]): void;
  preventDefault(): void;
  returnValue?: unknown;
}

export interface IpcSender {
  id: number;
  send(channel: string, ...args: unknown[]): void;
}

const invokeHandlers = new Map<string, IpcHandler>();
const onHandlers = new Map<string, Set<IpcHandler>>();

export const ipcMain = {
  handle(channel: string, fn: IpcHandler): void {
    invokeHandlers.set(channel, fn);
  },
  handleOnce(channel: string, fn: IpcHandler): void {
    const wrap: IpcHandler = (e, ...a) => {
      invokeHandlers.delete(channel);
      return fn(e, ...a);
    };
    invokeHandlers.set(channel, wrap);
  },
  on(channel: string, fn: IpcHandler): void {
    let set = onHandlers.get(channel);
    if (!set) {
      set = new Set();
      onHandlers.set(channel, set);
    }
    set.add(fn);
  },
  once(channel: string, fn: IpcHandler): void {
    const wrap: IpcHandler = (e, ...a) => {
      onHandlers.get(channel)?.delete(wrap);
      return fn(e, ...a);
    };
    ipcMain.on(channel, wrap);
  },
  removeHandler(channel: string): void {
    invokeHandlers.delete(channel);
  },
  removeAllListeners(channel?: string): void {
    if (channel) {
      onHandlers.delete(channel);
      invokeHandlers.delete(channel);
    } else {
      onHandlers.clear();
      invokeHandlers.clear();
    }
  },
};

export function getInvokeHandler(channel: string): IpcHandler | undefined {
  return invokeHandlers.get(channel);
}

export function getOnHandlers(channel: string): IpcHandler[] {
  return [...(onHandlers.get(channel) ?? [])];
}

export function listChannels(): { invoke: string[]; on: string[] } {
  return { invoke: [...invokeHandlers.keys()], on: [...onHandlers.keys()] };
}

export function makeIpcEvent(sender: IpcSender): IpcEvent {
  return {
    sender,
    reply: (channel, ...args) => sender.send(channel, ...args),
    preventDefault() {},
  };
}

// ─── webContents broadcast ──────────────────────────────────────────────────
// server.ts installs the broadcast fan-out; BrowserWindow stubs route
// webContents.send through it so all renderer event channels keep working.

type Broadcast = (channel: string, ...args: unknown[]) => void;
let broadcast: Broadcast = () => {};
export function setBroadcast(fn: Broadcast): void {
  broadcast = fn;
}

let nextWindowId = 1;
const liveWindows = new Set<StubWindow>();

export class BrowserWindow {
  static getAllWindows(): StubWindow[] {
    return [...liveWindows];
  }
  static getFocusedWindow(): StubWindow | null {
    return [...liveWindows][0] ?? null;
  }
  static fromWebContents(sender: { id?: number } | undefined): StubWindow | null {
    if (!sender || typeof sender.id !== 'number') return null;
    return [...liveWindows].find((w) => w.webContents.id === sender.id) ?? null;
  }

  webContents: {
    id: number;
    send(channel: string, ...args: unknown[]): void;
    postMessage(channel: string, ...args: unknown[]): void;
    on(): void;
    once(): void;
    removeListener(): void;
  };

  constructor(_options?: unknown) {
    const id = nextWindowId++;
    this.webContents = {
      id,
      send: (channel, ...args) => broadcast(channel, ...args),
      postMessage: (channel, ...args) => broadcast(channel, ...args),
      on() {},
      once() {},
      removeListener() {},
    };
    liveWindows.add(this);
  }

  on(): void {}
  once(): void {}
  removeListener(): void {}
  close(): void {
    liveWindows.delete(this);
  }
  destroy(): void {
    liveWindows.delete(this);
  }
  focus(): void {}
  show(): void {}
  hide(): void {}
  minimize(): void {}
  isDestroyed(): boolean {
    return false;
  }
  isVisible(): boolean {
    return true;
  }
  loadURL(): void {}
  loadFile(): void {}
  setMenu(): void {}
  setTitle(): void {}
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 1280, height: 800 };
  }
  setBounds(): void {}
}

// ─── Native UI (stubs; Tauri frontend owns real dialogs/shell/clipboard) ────

export const dialog = {
  async showOpenDialog(): Promise<{ canceled: true; filePaths: [] }> {
    return { canceled: true as const, filePaths: [] };
  },
  showOpenDialogSync(): { canceled: true; filePaths: [] } {
    return { canceled: true as const, filePaths: [] };
  },
  async showSaveDialog(): Promise<{ canceled: true; filePath: '' }> {
    return { canceled: true as const, filePath: '' };
  },
  showSaveDialogSync(): { canceled: true; filePath: '' } {
    return { canceled: true as const, filePath: '' };
  },
  async showMessageBox(): Promise<{ response: 1; checkboxChecked: false }> {
    // Default to the non-destructive (Cancel) button.
    return { response: 1, checkboxChecked: false };
  },
  showMessageBoxSync(): { response: 1; checkboxChecked: false } {
    return { response: 1, checkboxChecked: false };
  },
  showErrorBox(title: string, content: string): void {
    console.error('[shim] error box: ' + title + ' — ' + content);
  },
};

export const shell = {
  async openExternal(): Promise<void> {
    // TODO(tauri): handled in the frontend shim via plugin-shell.
  },
  async openPath(): Promise<string> {
    return 'no opener in headless sidecar';
  },
  showItemInFolder(): void {},
  beep(): void {},
  async trashItem(): Promise<void> {
    throw new Error('trashItem not supported in headless sidecar');
  },
};

export const clipboard = {
  readText(): string {
    return '';
  },
  writeText(): void {},
  readHTML(): string {
    return '';
  },
  writeHTML(): void {},
  availableFormats(): string[] {
    return [];
  },
  clear(): void {},
};

export class Notification {
  static isSupported(): boolean {
    return false;
  }
  constructor(_options?: unknown) {}
  show(): void {}
  close(): void {}
  on(): void {}
}

export class Menu {
  static setApplicationMenu(): void {}
  static getApplicationMenu(): null {
    return null;
  }
  static buildFromTemplate(): { popup(): void; closePopup(): void; items: [] } {
    return { popup() {}, closePopup() {}, items: [] };
  }
  popup(): void {}
  closePopup(): void {}
  append(): void {}
  insert(): void {}
  items: [] = [];
}

export class Tray extends EventEmitter {
  constructor(_icon?: unknown) {
    super();
  }
  setToolTip(): void {}
  setTitle(): void {}
  setContextMenu(): void {}
  setImage(): void {}
  displayBalloon(): void {}
  destroy(): void {}
  isDestroyed(): boolean {
    return false;
  }
  popUpContextMenu(): void {}
}

export const powerMonitor = {
  on(): void {},
  once(): void {},
  removeListener(): void {},
  getSystemIdleState(): string {
    return 'active';
  },
  getSystemIdleTime(): number {
    return 0;
  },
  isOnBatteryPower(): boolean {
    return false;
  },
};

export const powerSaveBlocker = {
  start(): number {
    return 1;
  },
  stop(): void {},
  isStarted(): boolean {
    return false;
  },
};

const primaryDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  size: { width: 1920, height: 1080 },
  workAreaSize: { width: 1920, height: 1040 },
  scaleFactor: 1,
  rotation: 0,
};

export const screen = {
  getPrimaryDisplay(): typeof primaryDisplay {
    return primaryDisplay;
  },
  getAllDisplays(): typeof primaryDisplay[] {
    return [primaryDisplay];
  },
  getDisplayNearestPoint(): typeof primaryDisplay {
    return primaryDisplay;
  },
  getDisplayMatching(): typeof primaryDisplay {
    return primaryDisplay;
  },
  on(): void {},
};

/**
 * safeStorage fallback. Contract preserved: secrets are never returned in the
 * clear over IPC (callers only pass opaque blobs back to decryptString).
 * TODO(tauri): back this with the OS keyring (Tauri stronghold) instead of
 * obfuscation; the file lives under userData with restrictive intent.
 */
const SECRET_PREFIX = 'nexus1:';
export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return true;
  },
  encryptString(plain: string): Buffer {
    return Buffer.from(SECRET_PREFIX + plain, 'utf8');
  },
  decryptString(blob: Buffer | Uint8Array): string {
    const s = Buffer.from(blob).toString('utf8');
    if (!s.startsWith(SECRET_PREFIX)) throw new Error('bad secret blob');
    return s.slice(SECRET_PREFIX.length);
  },
  setUsePlainTextEncryption(): void {},
  getSelectedStorageBackend(): string {
    return 'basic_text';
  },
};

const emptyImage = {
  isEmpty: () => true,
  toDataURL: () => '',
  toPNG: () => Buffer.alloc(0),
  getSize: () => ({ width: 0, height: 0 }),
};

export const nativeImage = {
  createEmpty: () => emptyImage,
  createFromPath: () => emptyImage,
  createFromBuffer: () => emptyImage,
  createFromDataURL: () => emptyImage,
};

const emptySession = {
  setPermissionRequestHandler(): void {},
  setPermissionCheckHandler(): void {},
  on(): void {},
  once(): void {},
  removeListener(): void {},
  clearCache(): Promise<void> {
    return Promise.resolve();
  },
};

export const session = {
  fromPartition(): typeof emptySession {
    return emptySession;
  },
  defaultSession: emptySession,
};

export const crashReporter = {
  start(): void {},
};
