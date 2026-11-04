import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { LibraryItem, OwnershipStatus, ProductSummary, WishlistItem } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import { categories, libraryEntries, productCategories, products, releases, wishlistItems } from "../../db/schema.js";
import { dev, summaryCols } from "../catalog/service.js";

export class LibraryError extends Error {
  constructor(public statusCode: number, public code: string) {
    super(code);
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createLibraryService(db: Database) {
  /** Producto publicado por slug, o error 404. */
  async function findPublished(slug: string) {
    const [p] = await db
      .select({ id: products.id, priceCents: products.priceCents })
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.status, "published")))
      .limit(1);
    if (!p) throw new LibraryError(404, "not_found");
    return p;
  }

  return {
    async list(userId: string, f: { q?: string | undefined; category?: string | undefined }): Promise<LibraryItem[]> {
      const conds: SQL[] = [eq(libraryEntries.userId, userId)];
      if (f.q) conds.push(ilike(products.name, `%${escapeLike(f.q)}%`));
      if (f.category) {
        conds.push(sql`exists (select 1 from ${productCategories} pc join ${categories} c on c.id = pc.category_id
                               where pc.product_id = ${products.id} and c.slug = ${f.category})`);
      }
      // La biblioteca muestra lo adquirido aunque el producto deje de estar publicado.
      const rows = await db
        .select({ ...summaryCols, id: products.id, source: libraryEntries.source, acquiredAt: libraryEntries.acquiredAt })
        .from(libraryEntries)
        .innerJoin(products, eq(products.id, libraryEntries.productId))
        .innerJoin(dev, eq(dev.id, products.developerId))
        .where(and(...conds))
        .orderBy(desc(libraryEntries.acquiredAt));
      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);
      const [cats, rels] = await Promise.all([
        db.select({ productId: productCategories.productId, slug: categories.slug, name: categories.name })
          .from(productCategories).innerJoin(categories, eq(categories.id, productCategories.categoryId))
          .where(inArray(productCategories.productId, ids)),
        // Última versión por producto y plataforma.
        db.selectDistinctOn([releases.productId, releases.platform], {
          productId: releases.productId, version: releases.version, platform: releases.platform, sizeBytes: releases.sizeBytes,
        }).from(releases).where(and(inArray(releases.productId, ids), eq(releases.status, "ready")))
          .orderBy(releases.productId, releases.platform, desc(releases.publishedAt)),
      ]);

      return rows.map(({ id, source, acquiredAt, ...product }) => ({
        product: product as ProductSummary,
        source,
        acquiredAt: acquiredAt.toISOString(),
        categories: cats.filter((c) => c.productId === id).map(({ slug, name }) => ({ slug, name })),
        latestReleases: rels.filter((r) => r.productId === id).map(({ version, platform, sizeBytes }) => ({ version, platform, sizeBytes })),
      }));
    },

    /** Agrega un producto gratuito. Los pagos se implementan en la etapa de pagos. */
    async addFree(userId: string, slug: string) {
      const p = await findPublished(slug);
      if (p.priceCents > 0) throw new LibraryError(402, "payment_required");
      const inserted = await db
        .insert(libraryEntries)
        .values({ userId, productId: p.id, source: "free" })
        .onConflictDoNothing()
        .returning({ productId: libraryEntries.productId });
      if (!inserted.length) throw new LibraryError(409, "already_owned");
      // Al adquirirlo deja de tener sentido en la lista de deseos.
      await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, p.id)));
    },

    async status(userId: string, slug: string): Promise<OwnershipStatus> {
      const [r] = await db
        .select({
          owned: sql<boolean>`exists (select 1 from ${libraryEntries} where ${libraryEntries.userId} = ${userId} and ${libraryEntries.productId} = ${products.id})`,
          wishlisted: sql<boolean>`exists (select 1 from ${wishlistItems} where ${wishlistItems.userId} = ${userId} and ${wishlistItems.productId} = ${products.id})`,
        })
        .from(products)
        .where(eq(products.slug, slug))
        .limit(1);
      if (!r) throw new LibraryError(404, "not_found");
      return r;
    },

    async wishlist(userId: string): Promise<WishlistItem[]> {
      const rows = await db
        .select({ ...summaryCols, addedAt: wishlistItems.addedAt })
        .from(wishlistItems)
        .innerJoin(products, eq(products.id, wishlistItems.productId))
        .innerJoin(dev, eq(dev.id, products.developerId))
        .where(and(eq(wishlistItems.userId, userId), eq(products.status, "published")))
        .orderBy(desc(wishlistItems.addedAt));
      return rows.map(({ addedAt, ...product }) => ({ product: product as ProductSummary, addedAt: addedAt.toISOString() }));
    },

    async addWish(userId: string, slug: string) {
      const p = await findPublished(slug);
      const [owned] = await db.select({ x: libraryEntries.productId }).from(libraryEntries)
        .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.productId, p.id))).limit(1);
      if (owned) throw new LibraryError(409, "already_owned");
      await db.insert(wishlistItems).values({ userId, productId: p.id }).onConflictDoNothing();
    },

    async removeWish(userId: string, slug: string) {
      await db.delete(wishlistItems).where(
        and(eq(wishlistItems.userId, userId), sql`${wishlistItems.productId} = (select id from ${products} where slug = ${slug})`),
      );
    },
  };
}
