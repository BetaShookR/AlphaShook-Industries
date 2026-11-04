import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { platformSchema } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import {
  categories,
  organizations,
  productCategories,
  productMedia,
  productRequirements,
  products,
  productTags,
  releases,
  tags,
} from "../../db/schema.js";

const slug = z.string().regex(/^[a-z0-9-]{1,80}$/, "slug: minúsculas, números y guiones");
const specs = z.object({
  os: z.string().optional(), cpu: z.string().optional(), ram: z.string().optional(),
  gpu: z.string().optional(), storage: z.string().optional(), notes: z.string().optional(),
}).strict();

export const productImportSchema = z.object({
  slug,
  type: z.enum(["game", "app"]).default("game"),
  name: z.string().min(1).max(120),
  shortDescription: z.string().min(1).max(300),
  description: z.string().min(1).max(20_000),
  developer: z.object({ slug, name: z.string().min(1).max(120) }),
  publisher: z.object({ slug, name: z.string().min(1).max(120) }).optional(),
  coverUrl: z.string().url().nullable().optional(),
  priceCents: z.number().int().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  status: z.enum(["draft", "in_review", "published", "hidden"]).default("draft"),
  featured: z.boolean().default(false),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  platforms: z.array(platformSchema).default([]),
  categories: z.array(slug).default([]),
  tags: z.array(z.object({ slug, name: z.string().min(1).max(60) })).default([]),
  media: z.array(z.object({ kind: z.enum(["image", "video"]).default("image"), url: z.string().url() })).default([]),
  requirements: z
    .array(z.object({ platform: platformSchema, level: z.enum(["minimum", "recommended"]), specs }))
    .default([]),
  releases: z
    .array(z.object({ version: z.string().min(1).max(40), platform: platformSchema, sizeBytes: z.number().int().positive(), changelog: z.string().optional() }))
    .default([]),
});
export const catalogImportSchema = z.object({ products: z.array(productImportSchema).min(1) });
export type ProductImport = z.infer<typeof productImportSchema>;

/** Crea o actualiza (por slug) productos con todas sus relaciones, en una transacción por producto. */
export async function importProducts(db: Database, input: unknown) {
  const { products: list } = catalogImportSchema.parse(input);
  const results: { slug: string; action: "created" | "updated" }[] = [];

  for (const item of list) {
    await db.transaction(async (tx) => {
      const upsertOrg = async (o: { slug: string; name: string }) => {
        const [row] = await tx.insert(organizations).values(o)
          .onConflictDoUpdate({ target: organizations.slug, set: { name: o.name } }).returning({ id: organizations.id });
        return row!.id;
      };
      const developerId = await upsertOrg(item.developer);
      const publisherId = item.publisher ? await upsertOrg(item.publisher) : developerId;

      const cats = item.categories.length
        ? await tx.select({ id: categories.id, slug: categories.slug }).from(categories).where(inArray(categories.slug, item.categories))
        : [];
      const missing = item.categories.filter((c) => !cats.some((x) => x.slug === c));
      if (missing.length) throw new Error(`${item.slug}: categorías inexistentes: ${missing.join(", ")}`);

      const values = {
        slug: item.slug, type: item.type, name: item.name, shortDescription: item.shortDescription,
        description: item.description, developerId, publisherId, coverUrl: item.coverUrl ?? null,
        priceCents: item.priceCents, currency: item.currency.toUpperCase(), status: item.status,
        featured: item.featured, releaseDate: item.releaseDate ?? null, platforms: item.platforms, updatedAt: new Date(),
      };
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, item.slug));
      const [p] = existing
        ? await tx.update(products).set(values).where(eq(products.id, existing.id)).returning({ id: products.id })
        : await tx.insert(products).values(values).returning({ id: products.id });
      const productId = p!.id;

      // Relaciones: se reemplazan completas para que el JSON sea la fuente de verdad.
      await tx.delete(productCategories).where(eq(productCategories.productId, productId));
      if (cats.length) await tx.insert(productCategories).values(cats.map((c) => ({ productId, categoryId: c.id })));

      await tx.delete(productTags).where(eq(productTags.productId, productId));
      for (const t of item.tags) {
        const [tag] = await tx.insert(tags).values(t).onConflictDoUpdate({ target: tags.slug, set: { name: t.name } }).returning({ id: tags.id });
        await tx.insert(productTags).values({ productId, tagId: tag!.id });
      }

      await tx.delete(productMedia).where(eq(productMedia.productId, productId));
      if (item.media.length) await tx.insert(productMedia).values(item.media.map((m, i) => ({ productId, ...m, position: i })));

      await tx.delete(productRequirements).where(eq(productRequirements.productId, productId));
      if (item.requirements.length) await tx.insert(productRequirements).values(item.requirements.map((r) => ({ productId, ...r })));

      // Las versiones no se borran (historial); se agregan las nuevas.
      for (const r of item.releases) {
        await tx.insert(releases).values({ productId, ...r, changelog: r.changelog ?? null }).onConflictDoNothing();
      }
      results.push({ slug: item.slug, action: existing ? "updated" : "created" });
    });
  }
  return results;
}
