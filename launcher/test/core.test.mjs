// Pruebas del núcleo del launcher (sin interfaz): descargas con Range, pausa/reanudación, integridad e instalación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DownloadManager } = require("../dist-electron/downloads.js");
const inst = require("../dist-electron/installer.js");

/** .zip mínimo (sin compresión) armado a mano para no depender de herramientas externas. */
function makeZip(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = []; let off = 0;
  for (const [name, content, mode = 0o644] of files) {
    const n = Buffer.from(name), d = Buffer.from(content), c = crc(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, d); centrals.push(ch, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-launcher-"));
const big = Buffer.alloc(4 * 1024 * 1024, 1);
const zipV1 = makeZip([["Juego/bin/run.sh", "#!/bin/sh\necho v1\n", 0o755], ["Juego/data.bin", big], ["../malo.txt", "zip-slip"]]);
const zipV2 = makeZip([["Juego/bin/run.sh", "#!/bin/sh\necho v2\n", 0o755], ["Juego/data.bin", "nuevo"]]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Servidor de descargas con soporte de Range y velocidad limitada (para poder pausar a mitad).
let served = { "v1": zipV1, "v2": zipV2 }, ranges = [];
const srv = http.createServer((req, res) => {
  const file = served[req.url.slice(1)];
  if (!file) { res.writeHead(404); return res.end(); }
  const m = /bytes=(\d+)-/.exec(req.headers.range ?? "");
  const start = m ? Number(m[1]) : 0; ranges.push(start);
  res.writeHead(m ? 206 : 200, { "content-length": file.length - start });
  let pos = start;
  const tick = () => { if (pos >= file.length) return res.end(); res.write(file.subarray(pos, pos + 256 * 1024)); pos += 256 * 1024; setTimeout(tick, 20); };
  tick();
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

let current = "v1", shaOverride = null;
const ticket = () => ({ slug: "juego", name: "Juego", version: current === "v1" ? "1.0" : "2.0", platform: "linux",
  sizeBytes: served[current].length, sha256: shaOverride ?? sha(served[current]), fileName: "j.zip", launchPath: "Juego/bin/run.sh", url: `${base}/${current}` });
const installDir = path.join(tmp, "lib", "juego");
let manifest;
const make = () => new DownloadManager({ dir: path.join(tmp, "dl"), stateFile: path.join(tmp, "dl.json"), getTicket: async () => ticket(),
  install: async (job, zip) => { manifest = await inst.installZip({ zipPath: zip, installDir, previous: manifest }); } });
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } };

test("descarga, pausa, reanuda tras 'reiniciar' el launcher, verifica e instala", async () => {
  let dm = make(); let installed = false; dm.on("installed", () => (installed = true));
  dm.enqueue(ticket(), "install");
  await waitFor(() => (dm.get("juego")?.received ?? 0) > 1024 * 1024);
  dm.pause("juego");
  const at = dm.get("juego").received;
  assert.equal(dm.get("juego").status, "paused");
  await new Promise((r) => setTimeout(r, 700)); // deja guardar el estado
  // Simula cerrar y abrir el launcher: nuevo gestor que lee el estado guardado.
  dm = make(); dm.on("installed", () => (installed = true));
  assert.equal(dm.get("juego").status, "paused");
  dm.resume("juego");
  await waitFor(() => installed);
  assert.ok(ranges.at(-1) > 0 && ranges.at(-1) <= at + 512 * 1024, "reanudó con Range desde donde quedó");
  assert.equal(await fs.readFile(path.join(installDir, "Juego/bin/run.sh"), "utf8"), "#!/bin/sh\necho v1\n");
  assert.ok(((await fs.stat(path.join(installDir, "Juego/bin/run.sh"))).mode & 0o111) !== 0, "conserva permiso de ejecución");
  await assert.rejects(fs.access(path.join(tmp, "lib", "malo.txt")), "bloquea zip-slip");
  assert.deepEqual(manifest.sort(), ["Juego/bin/run.sh", "Juego/data.bin"]);
  assert.equal(dm.jobs.length, 0);
  assert.equal((await fs.readdir(path.join(tmp, "dl"))).length, 0, "borra el .part");
});

test("actualiza conservando archivos creados por el juego", async () => {
  await fs.writeFile(path.join(installDir, "Juego/partida.sav"), "progreso");
  current = "v2";
  const dm = make(); let installed = false; dm.on("installed", () => (installed = true));
  dm.enqueue(ticket(), "update");
  await waitFor(() => installed);
  assert.equal(await fs.readFile(path.join(installDir, "Juego/data.bin"), "utf8"), "nuevo");
  assert.equal(await fs.readFile(path.join(installDir, "Juego/partida.sav"), "utf8"), "progreso");
});

test("rechaza un archivo dañado", async () => {
  const good = served.v2; served.v2 = Buffer.from(good); served.v2[10] ^= 0xff; // mismo tamaño, otro contenido
  shaOverride = sha(good);
  const dm = make();
  dm.enqueue(ticket(), "update");
  await waitFor(() => dm.get("juego")?.status === "error");
  assert.match(dm.get("juego").error, /dañado/);
  served.v2 = good; shaOverride = null;
  await dm.cancel("juego");
});

test("desinstala solo los archivos del juego", async () => {
  const kept = await inst.uninstall(installDir, manifest);
  assert.equal(kept, 1);
  assert.deepEqual(await fs.readdir(path.join(installDir, "Juego")), ["partida.sav"]);
});

test("no instala sobre una carpeta ajena", async () => {
  const other = path.join(tmp, "ajena"); await fs.mkdir(other); await fs.writeFile(path.join(other, "mio.txt"), "x");
  const z = path.join(tmp, "z.zip"); await fs.writeFile(z, zipV2);
  await assert.rejects(inst.installZip({ zipPath: z, installDir: other }), /no es de este juego/);
  assert.equal(await fs.readFile(path.join(other, "mio.txt"), "utf8"), "x");
  assert.equal(inst.resolveLaunch(other, "../x.exe"), null);
  assert.ok((await inst.freeBytes(path.join(tmp, "no-existe", "x"))) > 0);
});

test.after(() => { srv.close(); return fs.rm(tmp, { recursive: true, force: true }); });
