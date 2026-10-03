// 'electron' module substitute for the web/TTauri build of the upstream preload.
// See preload-ws.ts (entry) and ipc-ws.ts (transport).
import { invoke, send, on, once, removeListener, removeAllListeners, sendSync } from './ipc-ws';

export const ipcRenderer = {
  invoke,
  send,
  on,
  once,
  removeListener,
  removeAllListeners,
  sendSync,
};

export type IpcRendererEvent = unknown;

export const contextBridge = {
  exposeInMainWorld(key: string, value: unknown): void {
    (window as unknown as Record<string, unknown>)[key] = value;
  },
};

export const webUtils = {
  getPathForFile(file: File): string {
    const withPath = file as File & { path?: string };
    return withPath.path ?? file.name;
  },
};
