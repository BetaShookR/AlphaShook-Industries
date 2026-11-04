import { EventEmitter } from "node:events";
import { createWriteStream, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { sha256File } from "./installer.js";

/** Datos que entrega la API (GET /v1/library/:slug/download). */
export interface Ticket {
  slug: string;
  name: string;
  version: string;
  platform: "windows" | "linux";
  sizeBytes: number;
  sha256: string;
  fileName: string;
  launchPath: string;
  url: string;
}

export type JobStatus = "queued" | "downloading" | "paused" | "verifying" | "installing" | "error";

export interface Job {
  slug: string;
  name: string;
  version: string;
  platform: "windows" | "linux";
  sizeBytes: number;
  sha256: string;
  launchPath: string;
  kind: "install" | "update";
  status: JobStatus;
  received: number;
  speed: number; // bytes/s
  etaSec: number | null;
  error: string | null;
  installPct: number;
}

export interface DownloadManagerOptions {
  dir: string; // carpeta de archivos temporales .part
  stateFile: string;
  getTicket: (slug: string, platform: Job["platform"]) => Promise<Ticket>;
  /** Se llama con el .zip verificado; instala y devuelve cuando termina. */
  install: (job: Job, zipPath: string, onPct: (pct: number) => void) => Promise<void>;
}

/** Gestor de descargas: una a la vez, con Range para pausar/reanudar (también tras cerrar el launcher). */
export class DownloadManager extends EventEmitter {
  jobs: Job[] = [];
  private active: { slug: string; abort: () => void } | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private o: DownloadManagerOptions) {
    super();
    try {
      const saved = JSON.parse(readFileSync(o.stateFile, "utf8")) as Job[];
      // Lo que estaba en curso al cerrar queda en pausa (el usuario reanuda).
      this.jobs = saved.map((j) => ({ ...j, speed: 0, etaSec: null,
        status: ["downloading", "queued", "verifying", "installing"].includes(j.status) ? "paused" : j.status }));
    } catch {
      this.jobs = [];
    }
  }

  partPath(j: Pick<Job, "slug" | "version" | "platform">) {
    return path.join(this.o.dir, `${j.slug}-${j.platform}-${j.version.replace(/[^\w.-]/g, "_")}.zip.part`);
  }

  private changed(save = true) {
    this.emit("changed", this.jobs);
    if (save && !this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void fs.mkdir(path.dirname(this.o.stateFile), { recursive: true })
          .then(() => fs.writeFile(this.o.stateFile, JSON.stringify(this.jobs)));
      }, 500);
    }
  }

  get(slug: string) {
    return this.jobs.find((j) => j.slug === slug);
  }

  enqueue(t: Ticket, kind: Job["kind"]) {
    const cur = this.get(t.slug);
    if (cur && cur.status !== "error" && cur.status !== "paused") return;
    if (cur) this.jobs = this.jobs.filter((j) => j !== cur);
    this.jobs.push({ slug: t.slug, name: t.name, version: t.version, platform: t.platform, sizeBytes: t.sizeBytes, sha256: t.sha256,
      launchPath: t.launchPath, kind, status: "queued", received: 0, speed: 0, etaSec: null, error: null, installPct: 0 });
    this.changed();
    this.next();
  }

  pause(slug: string) {
    const j = this.get(slug);
    if (!j) return;
    if (this.active?.slug === slug && j.status === "downloading") this.active.abort();
    if (j.status === "queued" || j.status === "downloading") j.status = "paused";
    j.speed = 0;
    this.changed();
    this.next();
  }

  resume(slug: string) {
    const j = this.get(slug);
    if (!j || (j.status !== "paused" && j.status !== "error")) return;
    j.status = "queued";
    j.error = null;
    this.changed();
    this.next();
  }

  async cancel(slug: string) {
    const j = this.get(slug);
    if (!j || j.status === "verifying" || j.status === "installing") return;
    if (this.active?.slug === slug) this.active.abort();
    this.jobs = this.jobs.filter((x) => x !== j);
    await fs.rm(this.partPath(j), { force: true });
    this.changed();
    this.next();
  }

  private next() {
    if (this.active) return;
    const j = this.jobs.find((x) => x.status === "queued");
    if (j) void this.run(j);
  }

  private async run(j: Job) {
    this.active = { slug: j.slug, abort: () => undefined };
    try {
      const part = this.partPath(j);
      await fs.mkdir(this.o.dir, { recursive: true });
      let t = await this.o.getTicket(j.slug, j.platform);
      if (t.version !== j.version || t.sha256 !== j.sha256) {
        // Salió otra versión mientras estaba en pausa: empezar de cero con la nueva.
        await fs.rm(part, { force: true });
        Object.assign(j, { version: t.version, sha256: t.sha256, sizeBytes: t.sizeBytes, launchPath: t.launchPath, received: 0 });
      }
      const size = await fs.stat(part).then((s) => s.size, () => 0);
      j.received = size > j.sizeBytes ? 0 : size;
      if (size > j.sizeBytes) await fs.rm(part, { force: true });
      if (j.received < j.sizeBytes) {
        j.status = "downloading";
        this.changed();
        let done = await this.fetchRange(j, t.url, part);
        if (done === "expired") {
          t = await this.o.getTicket(j.slug, j.platform); // la URL firmada venció: pedir otra
          done = await this.fetchRange(j, t.url, part);
        }
        if (done === "aborted") return;
        if (done !== "ok") throw new Error(done);
      }
      j.status = "verifying";
      j.speed = 0;
      j.etaSec = null;
      this.changed();
      if ((await sha256File(part)) !== j.sha256) {
        await fs.rm(part, { force: true });
        j.received = 0;
        throw new Error("El archivo descargado está dañado (no coincide la verificación). Reintentá la descarga.");
      }
      j.status = "installing";
      this.changed();
      await this.o.install(j, part, (pct) => {
        j.installPct = pct;
        this.changed(false);
      });
      await fs.rm(part, { force: true });
      this.jobs = this.jobs.filter((x) => x !== j);
      this.changed();
      this.emit("installed", j);
    } catch (e) {
      j.status = "error";
      j.speed = 0;
      j.error = e instanceof Error ? e.message : String(e);
      this.changed();
    } finally {
      this.active = null;
      this.next();
    }
  }

  /** Descarga desde `received` hasta el final, agregando al archivo .part. */
  private fetchRange(j: Job, url: string, part: string): Promise<"ok" | "aborted" | "expired" | string> {
    return new Promise((resolve) => {
      const lib = url.startsWith("https:") ? https : http;
      const headers: Record<string, string> = j.received > 0 ? { range: `bytes=${j.received}-` } : {};
      let aborted = false;
      const req = lib.get(url, { headers, timeout: 30_000 }, (res) => {
        const code = res.statusCode ?? 0;
        if (code === 403 || code === 401 || code === 400) {
          res.resume();
          return resolve("expired");
        }
        if (code !== 200 && code !== 206) {
          res.resume();
          return resolve(`Error del servidor de descargas (${code})`);
        }
        if (code === 200) j.received = 0; // el servidor ignoró Range: empezar de cero
        const out = createWriteStream(part, { flags: code === 206 ? "a" : "w" });
        let windowStart = Date.now(), windowBytes = 0;
        res.on("data", (chunk: Buffer) => {
          j.received += chunk.length;
          windowBytes += chunk.length;
          const now = Date.now();
          if (now - windowStart >= 500) {
            j.speed = Math.round((windowBytes * 1000) / (now - windowStart));
            j.etaSec = j.speed > 0 ? Math.round((j.sizeBytes - j.received) / j.speed) : null;
            windowStart = now;
            windowBytes = 0;
            this.changed();
          }
        });
        res.pipe(out);
        let finished = false;
        const finish = (r: string) => {
          if (finished) return;
          finished = true;
          out.end(() => resolve(r));
        };
        res.on("end", () => finish(aborted ? "aborted" : j.received >= j.sizeBytes ? "ok" : "La conexión se cortó. Reanudá la descarga."));
        res.on("error", () => finish(aborted ? "aborted" : "La conexión se cortó. Reanudá la descarga."));
        res.on("close", () => !res.complete && finish(aborted ? "aborted" : "La conexión se cortó. Reanudá la descarga."));
        out.on("error", (e) => resolve(`No se pudo escribir en el disco: ${e.message}`));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve(aborted ? "aborted" : "Sin conexión con el servidor de descargas. Reanudá cuando vuelva internet."));
      this.active = { slug: j.slug, abort: () => { aborted = true; req.destroy(); } };
    });
  }
}
