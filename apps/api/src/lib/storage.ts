import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

/** Almacenamiento de objetos (Cloudflare R2 o cualquier S3 compatible). */
export interface ObjectStorage {
  /** URL firmada para subir el archivo con PUT directo desde el navegador. */
  presignPut(key: string, contentType: string, expiresSec: number): Promise<string>;
  /** URL firmada de descarga (admite Range para reanudar). */
  presignGet(key: string, expiresSec: number, downloadName?: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  /** SHA-256 en hex leyendo el objeto en streaming (memoria constante). */
  sha256(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface R2Config {
  endpoint: string; // https://<cuenta>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class R2Storage implements ObjectStorage {
  private client: AwsClient;
  private base: string;
  constructor(cfg: R2Config) {
    this.client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto" });
    this.base = `${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}`;
  }
  private url(key: string, params: Record<string, string> = {}) {
    const u = new URL(`${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  }
  private async presign(method: string, u: URL, expiresSec: number, headers: Record<string, string> = {}) {
    u.searchParams.set("X-Amz-Expires", String(expiresSec));
    const req = await this.client.sign(u.toString(), { method, headers, aws: { signQuery: true } });
    return req.url;
  }
  presignPut(key: string, contentType: string, expiresSec: number) {
    return this.presign("PUT", this.url(key), expiresSec, { "content-type": contentType });
  }
  presignGet(key: string, expiresSec: number, downloadName?: string) {
    const params: Record<string, string> = downloadName
      ? { "response-content-disposition": `attachment; filename="${downloadName.replace(/[^\w.-]/g, "_")}"` }
      : {};
    return this.presign("GET", this.url(key, params), expiresSec);
  }
  async head(key: string) {
    const r = await this.client.fetch(this.url(key).toString(), { method: "HEAD" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`R2 HEAD ${r.status}`);
    return { size: Number(r.headers.get("content-length") ?? 0) };
  }
  async sha256(key: string) {
    const r = await this.client.fetch(this.url(key).toString(), { method: "GET" });
    if (!r.ok || !r.body) throw new Error(`R2 GET ${r.status}`);
    const h = createHash("sha256");
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) h.update(chunk);
    return h.digest("hex");
  }
  async delete(key: string) {
    const r = await this.client.fetch(this.url(key).toString(), { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${r.status}`);
  }
}

/** Implementación en memoria para tests. `put` simula la subida del navegador. */
export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Buffer>();
  put(key: string, data: Buffer) {
    this.objects.set(key, data);
  }
  async presignPut(key: string) {
    return `memory://put/${key}`;
  }
  async presignGet(key: string) {
    return `memory://get/${key}`;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.length } : null;
  }
  async sha256(key: string) {
    return createHash("sha256").update(this.objects.get(key)!).digest("hex");
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
