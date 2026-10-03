/**
 * Nexus Agents web IPC transport.
 *
 * Mimics Electron's ipcRenderer (invoke/on/removeListener/once/sendSync) over a
 * WebSocket to the Node sidecar (src/nexus-sidecar/server.ts). A small override
 * map routes natively-UI channels to Tauri (or browser) APIs instead of the
 * sidecar, matching the preload's expected return shapes.
 *
 * sendSync cannot block in a browser: it answers from a warm cache (fetched at
 * connect + refreshed on related events). All current sendSync callers in the
 * preload degrade gracefully (try/catch with fallbacks).
 */

type Listener = (event: unknown, ...args: unknown[]) => void;

const PORT = Number(
  (window as unknown as { __NEXUS_SIDECAR_PORT__?: number }).__NEXUS_SIDECAR_PORT__ ?? 4317,
);
const URL = 'ws://127.0.0.1:' + PORT;

let ws: WebSocket | null = null;
let seq = 0;
let connected = false;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
const subs = new Map<string, Set<Listener>>();
const cache = new Map<string, unknown>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

async function pickFolder(multiple: boolean): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ directory: true, multiple });
    const first = Array.isArray(sel) ? sel[0] : sel;
    if (!first) return { ok: false, error: 'cancelled' };
    return { ok: true, path: first };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

async function openExternal(url: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(String(url));
    return { ok: true };
  } catch (e) {
    // Plain-browser fallback: new tab (may be blocked without a gesture).
    try {
      window.open(String(url), '_blank', 'noopener');
      return { ok: true };
    } catch {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }
}

async function copyText(text: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    await navigator.clipboard.writeText(String(text));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

async function readText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

const OVERRIDES: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  'dialog:chooseFolder': () => pickFolder(false),
  'dialog:attachFiles': () => pickFolder(true),
  'app:copyToClipboard': (text) => copyText(text),
  'app:readClipboard': () => readText(),
  'app:openExternal': (url) => openExternal(url),
  'terminal:openAtFolder': async (cwd) => openExternal(cwd),
};

function rawSend(obj: unknown): void {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function connect(): void {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try {
    ws = new WebSocket(URL);
  } catch {
    scheduleRetry();
    return;
  }
  ws.onopen = () => {
    connected = true;
    for (const channel of subs.keys()) rawSend({ t: 'sub', channel });
    void warmCache();
  };
  ws.onmessage = (ev) => {
    let msg: { t: string; id?: number; ok?: boolean; result?: unknown; error?: string; channel?: string; args?: unknown[] };
    try {
      msg = JSON.parse(String(ev.data)) as typeof msg;
    } catch {
      return;
    }
    if (msg.t === 'res' && typeof msg.id === 'number') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(String(msg.error ?? 'sidecar error')));
    } else if (msg.t === 'event' && msg.channel) {
      const set = subs.get(msg.channel);
      if (!set) return;
      const fakeEvent = {};
      for (const fn of [...set]) {
        try {
          fn(fakeEvent, ...(msg.args ?? []));
        } catch (e) {
          console.error('[cth-ws] listener threw', e);
        }
      }
    }
  };
  const down = () => {
    connected = false;
    for (const [, p] of pending) p.reject(new Error('sidecar disconnected'));
    pending.clear();
    scheduleRetry();
  };
  ws.onclose = down;
  ws.onerror = down;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 2000);
}

async function warmCache(): Promise<void> {
  // Best-effort refresh of values that sendSync callers read.
  try {
    cache.set('app:readClipboardSync', await readText());
  } catch {
    /* keep last */
  }
}

export function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const ov = OVERRIDES[channel];
  if (ov) return ov(...args);
  connect();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    if (connected) rawSend({ t: 'invoke', id, channel, args });
    else {
      // Queue until connected (5s cap).
      const start = Date.now();
      const tick = (): void => {
        if (!pending.has(id)) return;
        if (connected) rawSend({ t: 'invoke', id, channel, args });
        else if (Date.now() - start > 5000) {
          pending.delete(id);
          reject(new Error('sidecar not reachable'));
        } else setTimeout(tick, 100);
      };
      tick();
    }
  });
}

export function send(channel: string, ...args: unknown[]): void {
  connect();
  rawSend({ t: 'send', channel, args });
}

export function on(channel: string, listener: Listener): () => void {
  let set = subs.get(channel);
  if (!set) {
    set = new Set();
    subs.set(channel, set);
  }
  set.add(listener);
  connect();
  rawSend({ t: 'sub', channel });
  return () => removeListener(channel, listener);
}

export function once(channel: string, listener: Listener): () => void {
  const wrap: Listener = (e, ...a) => {
    removeListener(channel, wrap);
    listener(e, ...a);
  };
  return on(channel, wrap);
}

export function removeListener(channel: string, listener: Listener): void {
  const set = subs.get(channel);
  if (!set) return;
  set.delete(listener);
  if (set.size === 0) {
    subs.delete(channel);
    rawSend({ t: 'unsub', channel });
  }
}

export function removeAllListeners(channel?: string): void {
  if (channel) {
    subs.delete(channel);
    rawSend({ t: 'unsub', channel });
  } else {
    subs.clear();
  }
}

/** Sync reads answer from cache (see module doc). */
export function sendSync(channel: string, ..._args: unknown[]): unknown {
  if (channel === 'app:readClipboardSync') return (cache.get(channel) as string) ?? '';
  return cache.get(channel) ?? null;
}

export function sidecarUrl(): string {
  return URL;
}
