import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { DesktopPlatform, DevRelease, DownloadTicket, ReleaseCreateInput } from "@alphashook/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../../db/client.js";
import { libraryEntries, products, releases } from "../../db/schema.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { createDeveloperService, DevError, isUniqueViolation, type Actor } from "../developer/service.js";

const UPLOAD_URL_TTL = 6 * 3600; // subidas grandes pueden tardar
const DOWNLOAD_URL_TTL = 6 * 3600;

export function createReleaseService(db: Database, storage: ObjectStorage | null, log: FastifyBaseLogger) {
  const dev = createDeveloperService(db);
  const need = () => {
    if (!storage) throw new DevError(503, "storage_not_configured");
    return storage;
  };

  const cols = {
    id: releases.id, version: releases.version, platform: releases.platform, status: releases.status, sizeBytes: releases.sizeBytes,
    fileName: releases.fileName, sha256: releases.sha256, launchPath: releases.launchPath, changelog: releases.changelog,
    publishedAt: releases.publishedAt, storageKey: releases.storageKey,
  };
  const toDto = ({ storageKey: _k, publishedAt, ...r }: { storageKey: string | null; publishedAt: Date } & Omit<DevRelease, "publishedAt">): DevRelease =>
    ({ ...r, publishedAt: publishedAt.toISOString() });

  async function ownedRelease(a: Actor, slug: string, id: string) {
    const p = await dev.owned(a, slug);
    const [r] = await db.select(cols).from(releases).where(and(eq(releases.id, id), eq(releases.productId, p.id))).limit(1);
    if (!r) throw new DevError(404, "not_found");
    return r;
  }

  /** Calcula el SHA-256 en segundo plano y deja la versión lista (o fallida). */
  async function verify(id: string, key: string) {
    try {
      const hash = await need().sha256(key);
      await db.update(releases).set({ sha256: hash, status: "ready", publishedAt: new Date() }).where(eq(releases.id, id));
    } catch (err) {
      log.error({ err, id }, "falló la verificación del archivo");
      await db.update(releases).set({ status: "failed" }).where(eq(releases.id, id));
    }
  }

  return {
    async list(a: Actor, slug: string): Promise<DevRelease[]> {
      const p = await dev.owned(a, slug);
      const rows = await db.select(cols).from(releases).where(eq(releases.productId, p.id)).orderBy(desc(releases.publishedAt));
      return rows.map(toDto);
    },

    /** Crea la versión y devuelve la URL firmada para subir el .zip directo a R2. */
    async create(a: Actor, slug: string, input: Required<ReleaseCreateInput>) {
      const s = need();
      const p = await dev.owned(a, slug);
      const [prod] = await db.select({ platforms: products.platforms }).from(products).where(eq(products.id, p.id));
      if (!prod!.platforms.includes(input.platform)) throw new DevError(400, "platform_not_in_product");
      const id = crypto.randomUUID();
      const key = `releases/${p.id}/${id}/${input.fileName.replace(/[^\w.-]/g, "_")}`;
      try {
        await db.insert(releases).values({
          id, productId: p.id, version: input.version, platform: input.platform, sizeBytes: input.sizeBytes,
          changelog: input.changelog || null, status: "uploading", storageKey: key, fileName: input.fileName, launchPath: input.launchPath.replace(/\\/g, "/"),
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DevError(409, "version_exists");
        throw e;
      }
      return { id, uploadUrl: await s.presignPut(key, "application/zip", UPLOAD_URL_TTL), contentType: "application/zip" };
    },

    /** El navegador terminó de subir: comprueba tamaño y verifica en segundo plano. */
    async complete(a: Actor, slug: string, id: string) {
      const s = need();
      const r = await ownedRelease(a, slug, id);
      if (r.status === "ready") return;
      if (!r.storageKey) throw new DevError(409, "invalid_status");
      const obj = await s.head(r.storageKey);
      if (!obj) throw new DevError(409, "file_missing");
      if (obj.size !== r.sizeBytes) {
        await db.update(releases).set({ status: "failed" }).where(eq(releases.id, id));
        throw new DevError(409, "size_mismatch");
      }
      await db.update(releases).set({ status: "verifying" }).where(eq(releases.id, id));
      void verify(id, r.storageKey);
    },

    async remove(a: Actor, slug: string, id: string) {
      const r = await ownedRelease(a, slug, id);
      if (r.storageKey) await need().delete(r.storageKey);
      await db.delete(releases).where(eq(releases.id, id));
    },

    /** Ticket de descarga de la última versión lista. Requiere el producto en la biblioteca. */
    async download(userId: string, slug: string, platform: DesktopPlatform): Promise<DownloadTicket> {
      const s = need();
      const [p] = await db.select({ id: products.id, name: products.name }).from(products)
        .innerJoin(libraryEntries, and(eq(libraryEntries.productId, products.id), eq(libraryEntries.userId, userId)))
        .where(eq(products.slug, slug)).limit(1);
      if (!p) throw new DevError(403, "not_owned");
      const [r] = await db.select(cols).from(releases)
        .where(and(eq(releases.productId, p.id), eq(releases.platform, platform), eq(releases.status, "ready"), isNotNull(releases.storageKey)))
        .orderBy(desc(releases.publishedAt)).limit(1);
      if (!r) throw new DevError(404, "no_release");
      return {
        slug, name: p.name, version: r.version, platform, sizeBytes: r.sizeBytes, sha256: r.sha256!, fileName: r.fileName!, launchPath: r.launchPath!,
        url: await s.presignGet(r.storageKey!, DOWNLOAD_URL_TTL, r.fileName!),
        expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL * 1000).toISOString(),
      };
    },
  };
}
