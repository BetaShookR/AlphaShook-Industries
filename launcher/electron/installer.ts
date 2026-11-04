import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

/** Lista de archivos (rutas relativas con "/") que pertenecen al producto instalado. */
export type Manifest = string[];

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

/** Bytes libres en el disco que contiene `dir` (o su carpeta existente más cercana). */
export async function freeBytes(dir: string): Promise<number> {
  let d = path.resolve(dir);
  for (;;) {
    try {
      const s = await fs.statfs(d);
      return s.bavail * s.bsize;
    } catch {
      const up = path.dirname(d);
      if (up === d) throw new Error("No se pudo leer el espacio libre");
      d = up;
    }
  }
}

const openZip = (file: string) =>
  new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, z) => (err ? rej(err) : res(z!))));

/** Recorre las entradas del .zip de a una (yauzl usa callbacks). */
async function* entriesOf(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  for (;;) {
    const e = await new Promise<yauzl.Entry | null>((res, rej) => {
      const onEntry = (en: yauzl.Entry) => { cleanup(); res(en); };
      const onEnd = () => { cleanup(); res(null); };
      const onErr = (err: Error) => { cleanup(); rej(err); };
      const cleanup = () => { zip.off("entry", onEntry); zip.off("end", onEnd); zip.off("error", onErr); };
      zip.on("entry", onEntry).on("end", onEnd).on("error", onErr);
      zip.readEntry();
    });
    if (!e) return;
    yield e;
  }
}

const readStream = (zip: yauzl.ZipFile, e: yauzl.Entry) =>
  new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))));

/** Suma de tamaños descomprimidos (para comprobar espacio antes de extraer). */
export async function zipUncompressedSize(file: string): Promise<number> {
  const zip = await openZip(file);
  try {
    let total = 0;
    for await (const e of entriesOf(zip)) total += e.uncompressedSize;
    return total;
  } finally {
    zip.close();
  }
}

/** Ruta segura dentro de `root`; null si el .zip intenta salir de la carpeta (zip-slip). */
function safeJoin(root: string, name: string): string | null {
  const rel = name.replace(/\\/g, "/");
  if (rel.startsWith("/") || /^[a-z]:/i.test(rel)) return null;
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

/** Extrae el .zip en `dest`. Ignora enlaces simbólicos y rutas peligrosas. Devuelve el manifiesto. */
export async function extractZip(file: string, dest: string, onProgress?: (done: number, total: number) => void): Promise<Manifest> {
  const root = path.resolve(dest);
  await fs.mkdir(root, { recursive: true });
  const zip = await openZip(file);
  const manifest: Manifest = [];
  try {
    const entries = zip.entryCount;
    let n = 0;
    for await (const e of entriesOf(zip)) {
      n++;
      // decodeStrings:false → validamos nosotros las rutas (yauzl aborta todo el .zip ante una ruta inválida).
      const name = (e.fileName as unknown as Buffer).toString("utf8");
      const target = safeJoin(root, name);
      const mode = (e.externalFileAttributes >>> 16) & 0o170777;
      const isLink = (mode & 0o170000) === 0o120000;
      if (!target || isLink) continue;
      if (name.endsWith("/")) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      const stream = await readStream(zip, e);
      await pipeline(stream, createWriteStream(target));
      if (process.platform !== "win32" && mode & 0o111) await fs.chmod(target, (mode & 0o777) | 0o600);
      manifest.push(path.relative(root, target).split(path.sep).join("/"));
      onProgress?.(n, entries);
    }
  } finally {
    zip.close();
  }
  return manifest;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function listFiles(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await listFiles(root, r)));
    else out.push(r);
  }
  return out;
}

async function pruneEmptyDirs(dir: string): Promise<void> {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (d.isDirectory()) await pruneEmptyDirs(path.join(dir, d.name));
  }
  if (!(await fs.readdir(dir)).length) await fs.rmdir(dir);
}

/**
 * Instala o actualiza. Extrae en `<dir>.nuevo`; si había una versión anterior, conserva los archivos
 * creados por el juego (los que no estaban en el manifiesto anterior) y reemplaza la carpeta al final.
 */
export async function installZip(opts: { zipPath: string; installDir: string; previous?: Manifest; onProgress?: (done: number, total: number) => void }): Promise<Manifest> {
  const dir = path.resolve(opts.installDir);
  const staging = `${dir}.nuevo`;
  await fs.rm(staging, { recursive: true, force: true });
  const hadDir = await exists(dir);
  if (hadDir && !opts.previous && (await fs.readdir(dir)).length) {
    throw new Error(`La carpeta ${dir} ya existe y no es de este juego. Elegí otra carpeta de instalación.`);
  }
  const manifest = await extractZip(opts.zipPath, staging, opts.onProgress);
  if (hadDir) {
    const old = new Set(opts.previous ?? []);
    const fresh = new Set(manifest);
    for (const f of await listFiles(dir)) {
      if (old.has(f) || fresh.has(f)) continue; // archivo del juego: se reemplaza
      const to = path.join(staging, f);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(path.join(dir, f), to); // dato del usuario: se conserva
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.rename(staging, dir);
  return manifest;
}

/** Borra solo los archivos del producto. Devuelve cuántos archivos ajenos (partidas, configs) quedaron. */
export async function uninstall(installDir: string, manifest: Manifest): Promise<number> {
  const dir = path.resolve(installDir);
  if (!(await exists(dir))) return 0;
  for (const f of manifest) {
    const p = safeJoin(dir, f);
    if (p) await fs.rm(p, { force: true });
  }
  await pruneEmptyDirs(dir).catch(() => undefined);
  return (await exists(dir)) ? (await listFiles(dir)).length : 0;
}

/** Ruta del ejecutable validada dentro de la carpeta de instalación. */
export function resolveLaunch(installDir: string, launchPath: string): string | null {
  return safeJoin(path.resolve(installDir), launchPath);
}

/**
 * Busca el ejecutable en el manifiesto. Si el desarrollador puso solo el nombre ("Juego.exe") pero
 * el .zip lo tiene dentro de una carpeta ("Juego PC/Juego.exe"), usa esa ruta (la más corta).
 */
export function findLaunchPath(manifest: Manifest, launchPath: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\/+/, "").toLowerCase();
  const want = norm(launchPath);
  const exact = manifest.find((f) => norm(f) === want);
  if (exact) return exact;
  const byEnd = manifest.filter((f) => norm(f).endsWith("/" + want)).sort((a, b) => a.length - b.length);
  return byEnd[0] ?? null;
}
