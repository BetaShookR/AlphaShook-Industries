import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DownloadManager, type Job, type Ticket } from "./downloads.js";
import { freeBytes, installZip, resolveLaunch, uninstall, zipUncompressedSize, type Manifest } from "./installer.js";

const DEFAULT_API = process.env.ALPHASHOOK_API_URL ?? "https://alphashook.onrender.com";
const PLATFORM: "windows" | "linux" = process.platform === "win32" ? "windows" : "linux";

// Datos del launcher: carpeta propia (permite tests aislados con ALPHASHOOK_DATA_DIR).
if (process.env.ALPHASHOOK_DATA_DIR) app.setPath("userData", process.env.ALPHASHOOK_DATA_DIR);
const data = (f: string) => path.join(app.getPath("userData"), f);

interface Install {
  slug: string;
  name: string;
  version: string;
  platform: "windows" | "linux";
  dir: string;
  launchPath: string;
  manifest: Manifest;
  installedAt: string;
}
interface Settings {
  apiUrl: string;
  libraryDir: string;
  installs: Record<string, Install>;
}

let settings: Settings;
function loadSettings(): Settings {
  const def: Settings = { apiUrl: DEFAULT_API, libraryDir: path.join(app.getPath("home"), "AlphaShook Games"), installs: {} };
  try {
    return { ...def, ...JSON.parse(readFileSync(data("launcher.json"), "utf8")) };
  } catch {
    return def;
  }
}
async function saveSettings() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(data("launcher.json"), JSON.stringify(settings, null, 2));
}

// ── Sesión: token Bearer guardado cifrado con el sistema operativo cuando es posible ──
let token: string | null = null;
function loadToken() {
  try {
    const raw = readFileSync(data("session.bin"));
    token = safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b ? safeStorage.decryptString(raw) : JSON.parse(raw.toString()).t;
  } catch {
    token = null;
  }
}
async function saveToken(t: string | null) {
  token = t;
  if (!t) return fs.rm(data("session.bin"), { force: true });
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(JSON.stringify({ t }));
  await fs.writeFile(data("session.bin"), buf);
}

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
async function api<T>(method: string, p: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/v1${p}`, {
      method,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error");
  }
  if (res.status === 401 && token) {
    await saveToken(null);
    win?.webContents.send("auth:expired");
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? "network_error");
  return json as T;
}

const getTicket = (slug: string, platform: string) => api<Ticket>("GET", `/library/${encodeURIComponent(slug)}/download?platform=${platform}`);

// ── Descargas e instalación ──
let downloads: DownloadManager;
const installDirFor = (slug: string) => settings.installs[slug]?.dir ?? path.join(settings.libraryDir, slug);

async function installJob(job: Job, zipPath: string, onPct: (n: number) => void) {
  const dir = installDirFor(job.slug);
  const need = await zipUncompressedSize(zipPath);
  const prev = settings.installs[job.slug];
  if ((await freeBytes(path.dirname(dir))) < need + 50 * 1024 ** 2) throw new Error("No hay espacio suficiente en el disco para instalar.");
  const manifest = await installZip({ zipPath, installDir: dir, ...(prev && { previous: prev.manifest }), onProgress: (d, t) => onPct(Math.round((d / t) * 100)) });
  if (!resolveLaunch(dir, job.launchPath)) throw new Error("El ejecutable indicado por el desarrollador no es válido.");
  settings.installs[job.slug] = { slug: job.slug, name: job.name, version: job.version, platform: job.platform, dir, launchPath: job.launchPath, manifest, installedAt: new Date().toISOString() };
  await saveSettings();
}

let win: BrowserWindow | null = null;
const pushState = () => win?.webContents.send("games:changed", state());
const state = () => ({ installs: settings.installs, jobs: downloads.jobs, platform: PLATFORM, libraryDir: settings.libraryDir });

async function startDownload(slug: string, kind: Job["kind"]) {
  const t = await getTicket(slug, PLATFORM);
  const dir = installDirFor(slug);
  // Espacio: el .zip + lo descomprimido (estimado en 2x) durante la instalación.
  if ((await freeBytes(settings.libraryDir)) < t.sizeBytes * 3) throw new ApiError(507, "no_space");
  if (kind === "install" && !settings.installs[slug]) {
    const used = await fs.readdir(dir).then((f) => f.length > 0, () => false);
    if (used) throw new ApiError(409, "dir_not_empty");
  }
  downloads.enqueue(t, kind);
  return { version: t.version, sizeBytes: t.sizeBytes };
}

function registerIpc() {
  const handle = <A extends unknown[]>(ch: string, fn: (...a: A) => unknown) =>
    ipcMain.handle(ch, async (_e, ...a: A) => {
      try {
        return { ok: true, data: await fn(...a) };
      } catch (e) {
        return { ok: false, error: e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e) };
      }
    });

  handle("api", (method: string, p: string, body?: unknown) => {
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) || !p.startsWith("/")) throw new Error("bad_request");
    return api(method, p, body);
  });
  handle("auth:login", async (identifier: string, password: string) => {
    const r = await api<{ token: string; user: unknown }>("POST", "/auth/login", { identifier, password, deviceType: "launcher", deviceName: `Launcher ${os.hostname()}`.slice(0, 100) });
    await saveToken(r.token);
    return r.user;
  });
  handle("auth:me", async () => (token ? (await api<{ user: unknown }>("GET", "/me")).user : null));
  handle("auth:logout", async () => {
    await api("POST", "/auth/logout").catch(() => undefined);
    await saveToken(null);
  });
  handle("settings:get", () => ({ apiUrl: settings.apiUrl, libraryDir: settings.libraryDir, platform: PLATFORM, version: app.getVersion() }));
  handle("settings:set", async (s: { apiUrl?: string; libraryDir?: string }) => {
    if (s.apiUrl !== undefined) {
      const u = new URL(s.apiUrl); // valida
      settings.apiUrl = u.origin;
    }
    if (s.libraryDir) settings.libraryDir = s.libraryDir;
    await saveSettings();
    pushState();
  });
  handle("settings:pickDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], defaultPath: settings.libraryDir });
    return r.canceled ? null : r.filePaths[0];
  });

  handle("games:state", () => state());
  handle("games:install", (slug: string) => startDownload(slug, "install"));
  handle("games:update", (slug: string) => startDownload(slug, "update"));
  handle("games:pause", (slug: string) => downloads.pause(slug));
  handle("games:resume", (slug: string) => downloads.resume(slug));
  handle("games:cancel", (slug: string) => downloads.cancel(slug));
  /** Versión disponible por producto instalado (para avisar actualizaciones). */
  handle("games:checkUpdates", async () => {
    const out: Record<string, { version: string; sizeBytes: number } | null> = {};
    for (const i of Object.values(settings.installs)) {
      out[i.slug] = await getTicket(i.slug, i.platform).then((t) => ({ version: t.version, sizeBytes: t.sizeBytes }), () => null);
    }
    return out;
  });
  handle("games:uninstall", async (slug: string) => {
    const i = settings.installs[slug];
    if (!i) return { kept: 0 };
    const kept = await uninstall(i.dir, i.manifest);
    delete settings.installs[slug];
    await saveSettings();
    pushState();
    return { kept, dir: i.dir };
  });
  handle("games:openDir", async (slug: string) => {
    const i = settings.installs[slug];
    if (i) await shell.openPath(i.dir);
  });
  handle("games:launch", async (slug: string) => {
    const i = settings.installs[slug];
    if (!i) throw new Error("No está instalado.");
    const exe = resolveLaunch(i.dir, i.launchPath);
    if (!exe || !(await fs.access(exe).then(() => true, () => false))) throw new Error("No se encontró el ejecutable. Probá reinstalar.");
    if (process.platform !== "win32") await fs.chmod(exe, 0o755).catch(() => undefined);
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    await new Promise<void>((res, rej) => {
      child.once("spawn", () => res());
      child.once("error", (e) => rej(new Error(`No se pudo abrir el juego: ${e.message}`)));
    });
    child.unref();
  });
}

app.whenReady().then(() => {
  settings = loadSettings();
  loadToken();
  downloads = new DownloadManager({ dir: data("descargas"), stateFile: data("downloads.json"), getTicket, install: installJob });
  downloads.on("changed", pushState);
  registerIpc();

  win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 900, minHeight: 600, backgroundColor: "#0e0f14", autoHideMenuBar: true, title: "AlphaShook",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  // Enlaces externos → navegador del sistema; la ventana nunca navega fuera del launcher.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  void win.loadFile(path.join(__dirname, "../dist/index.html"));
});

app.on("window-all-closed", () => app.quit());
