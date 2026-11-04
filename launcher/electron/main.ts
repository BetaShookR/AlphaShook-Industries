import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { DownloadManager, type Job, type Ticket } from "./downloads.js";
import { findLaunchPath, freeBytes, installZip, resolveLaunch, uninstall, zipUncompressedSize, type Manifest } from "./installer.js";

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
/** Último usuario conocido: permite entrar sin conexión o con el servidor dormido. */
let cachedUser: unknown = null;
function loadToken() {
  try {
    const raw = readFileSync(data("session.bin"));
    const text = safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b ? safeStorage.decryptString(raw) : raw.toString();
    if (text.startsWith("{")) {
      const j = JSON.parse(text) as { t: string; u?: unknown };
      token = j.t;
      cachedUser = j.u ?? null;
    } else token = text; // formato anterior: solo el token
  } catch {
    token = null;
  }
}
async function saveToken(t: string | null, user: unknown = cachedUser) {
  token = t;
  cachedUser = t ? user : null;
  if (!t) return fs.rm(data("session.bin"), { force: true });
  const text = JSON.stringify({ t, u: cachedUser });
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
  await fs.writeFile(data("session.bin"), buf);
}

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
/** Registro de diagnóstico en la carpeta de datos del launcher (launcher.log). */
function logLine(msg: string) {
  void fs.appendFile(data("launcher.log"), `${new Date().toISOString()} ${msg}\n`).catch(() => undefined);
}

async function api<T>(method: string, p: string, body?: unknown, timeoutMs = 75_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/v1${p}`, {
      method,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs), // el servidor gratuito tarda hasta ~1 min en despertar
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e as Error).name ?? String(e);
    logLine(`${method} ${settings.apiUrl}${p} → ${detail}`);
    throw new ApiError(0, `network_error:${detail}`);
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
  const launchPath = findLaunchPath(manifest, job.launchPath);
  if (!launchPath || !resolveLaunch(dir, launchPath)) throw new Error(`El juego no trae el ejecutable "${job.launchPath}". Avisale al desarrollador.`);
  settings.installs[job.slug] = { slug: job.slug, name: job.name, version: job.version, platform: job.platform, dir, launchPath, manifest, installedAt: new Date().toISOString() };
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
    await saveToken(r.token, r.user);
    return r.user;
  });
  /** La sesión dura hasta "Cerrar sesión": solo se pierde si el servidor la rechaza (401). */
  handle("auth:me", async () => {
    if (!token) return null;
    try {
      const u = await api<unknown>("GET", "/me", undefined, 20_000); // /me devuelve el usuario directo
      await saveToken(token, u);
      return u;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      if (cachedUser) return cachedUser; // sin conexión o servidor dormido: seguir con la sesión guardada
      throw e;
    }
  });
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
  handle("app:updateReady", () => updateReady);
  handle("app:restartToUpdate", () => {
    if (updateReady) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
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
    const exe = resolveLaunch(i.dir, findLaunchPath(i.manifest, i.launchPath) ?? i.launchPath);
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

// Una sola ventana: si se abre de nuevo, se enfoca la existente (dos copias compartirían los mismos datos).
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

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
  // F12: herramientas de diagnóstico (para reportar errores).
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") win?.webContents.toggleDevTools();
  });
  void win.loadFile(path.join(__dirname, "../dist/index.html"));
  setupAutoUpdate();
});

// ── Actualización automática del propio launcher (solo en la versión instalada) ──
let updateReady: string | null = null;
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  if (process.env.ALPHASHOOK_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: process.env.ALPHASHOOK_UPDATE_URL }); // pruebas
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // si no reinicia, se aplica al cerrar
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = info.version;
    logLine(`actualización ${info.version} descargada`);
    win?.webContents.send("app:update", updateReady);
  });
  autoUpdater.on("error", (e) => logLine(`actualización: ${e.message}`));
  const check = () => void autoUpdater.checkForUpdates().catch((e: Error) => logLine(`actualización: ${e.message}`));
  setTimeout(check, 10_000);
  setInterval(check, 4 * 3600 * 1000);
}

app.on("window-all-closed", () => app.quit());
