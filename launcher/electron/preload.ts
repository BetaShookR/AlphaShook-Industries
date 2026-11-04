import { contextBridge, ipcRenderer } from "electron";

type R<T> = Promise<{ ok: true; data: T } | { ok: false; error: string }>;
const call = <T>(ch: string, ...a: unknown[]): R<T> => ipcRenderer.invoke(ch, ...a);

/** Única puerta entre la interfaz y el sistema (contextIsolation + sandbox). */
contextBridge.exposeInMainWorld("alpha", {
  api: <T>(method: string, path: string, body?: unknown) => call<T>("api", method, path, body),
  login: (identifier: string, password: string) => call("auth:login", identifier, password),
  me: () => call("auth:me"),
  logout: () => call("auth:logout"),
  settings: () => call("settings:get"),
  setSettings: (s: { apiUrl?: string; libraryDir?: string }) => call("settings:set", s),
  pickDir: () => call<string | null>("settings:pickDir"),
  state: () => call("games:state"),
  install: (slug: string) => call("games:install", slug),
  update: (slug: string) => call("games:update", slug),
  pause: (slug: string) => call("games:pause", slug),
  resume: (slug: string) => call("games:resume", slug),
  cancel: (slug: string) => call("games:cancel", slug),
  checkUpdates: () => call("games:checkUpdates"),
  uninstall: (slug: string) => call("games:uninstall", slug),
  openDir: (slug: string) => call("games:openDir", slug),
  launch: (slug: string) => call("games:launch", slug),
  onState: (fn: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => fn(s);
    ipcRenderer.on("games:changed", h);
    return () => ipcRenderer.removeListener("games:changed", h);
  },
  onAuthExpired: (fn: () => void) => {
    const h = () => fn();
    ipcRenderer.on("auth:expired", h);
    return () => ipcRenderer.removeListener("auth:expired", h);
  },
});
