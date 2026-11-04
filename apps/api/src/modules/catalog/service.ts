import { aliasedTable, and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { CatalogPage, CatalogQuery, HomeData, ProductDetail, ProductSummary, RequirementSpecs } from "@alphashook/shared";
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

export const dev = aliasedTable(organizations, "dev");
const pub = aliasedTable(organizations, "pub");

export const summaryCols = {
  slug: products.slug,
  type: products.type,
  name: products.name,
  shortDescription: products.shortDescription,
  coverUrl: products.coverUrl,
  priceCents: products.priceCents,
  currency: products.currency,
  platforms: products.platforms,
  releaseDate: products.releaseDate,
  developer: { slug: dev.slug, name: dev.name },
};

const isPublished = eq(products.status, "published");
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createCatalogService(db: Database) {
  const baseList = () => db.select(summaryCols).from(products).innerJoin(dev, eq(dev.id, products.developerId));

  return {
    async list(q: CatalogQuery): Promise<CatalogPage> {
      const conds: SQL[] = [isPublished];
      if (q.type) conds.push(eq(products.type, q.type));
      if (q.q) {
        conds.push(
          or(
            sql`${products.search} @@ websearch_to_tsquery('simple', ${q.q})`,
            ilike(products.name, `%${escapeLike(q.q)}%`),
          )!,
        );
      }
      if (q.category) {
        conds.push(
          sql`exists (select 1 from ${productCategories} pc join ${categories} c on c.id = pc.category_id
                      where pc.product_id = ${products.id} and c.slug = ${q.category})`,
        );
      }
      const where = and(...conds);
      const order =
        q.sort === "name"
          ? [asc(products.name)]
          : q.sort === "price_asc"
            ? [asc(products.priceCents), asc(products.name)]
            : q.sort === "price_desc"
              ? [desc(products.priceCents), asc(products.name)]
              : [sql`${products.releaseDate} desc nulls last`, desc(products.createdAt)];

      const [items, [totalRow]] = await Promise.all([
        baseList().where(where).orderBy(...order).limit(q.limit).offset(q.offset),
        db.select({ n: count() }).from(products).where(where),
      ]);
      return { items: items as ProductSummary[], total: totalRow?.n ?? 0, limit: q.limit, offset: q.offset };
    },

    async home(): Promise<HomeData> {
      const [featured, recent, cats] = await Promise.all([
        baseList().where(and(isPublished, eq(products.featured, true))).orderBy(desc(products.updatedAt)).limit(8),
        baseList().where(isPublished).orderBy(sql`${products.releaseDate} desc nulls last`, desc(products.createdAt)).limit(12),
        db.select({ slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.name)),
      ]);
      return { featured: featured as ProductSummary[], recent: recent as ProductSummary[], categories: cats };
    },

    async categories() {
      return db.select({ slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.name));
    },

    async detail(slug: string): Promise<ProductDetail | null> {
      const [p] = await db
        .select({ ...summaryCols, id: products.id, description: products.description, publisher: { slug: pub.slug, name: pub.name } })
        .from(products)
        .innerJoin(dev, eq(dev.id, products.developerId))
        .innerJoin(pub, eq(pub.id, products.publisherId))
        .where(and(eq(products.slug, slug), isPublished))
        .limit(1);
      if (!p) return null;

      const [cats, tgs, media, reqs, rels] = await Promise.all([
        db.select({ slug: categories.slug, name: categories.name }).from(productCategories)
          .innerJoin(categories, eq(categories.id, productCategories.categoryId)).where(eq(productCategories.productId, p.id)),
        db.select({ slug: tags.slug, name: tags.name }).from(productTags)
          .innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(productTags.productId, p.id)),
        db.select({ kind: productMedia.kind, url: productMedia.url }).from(productMedia)
          .where(eq(productMedia.productId, p.id)).orderBy(asc(productMedia.position)),
        db.select({ platform: productRequirements.platform, level: productRequirements.level, specs: productRequirements.specs })
          .from(productRequirements).where(eq(productRequirements.productId, p.id)),
        db.select({
          version: releases.version, platform: releases.platform, sizeBytes: releases.sizeBytes,
          changelog: releases.changelog, publishedAt: releases.publishedAt,
        }).from(releases).where(and(eq(releases.productId, p.id), eq(releases.status, "ready"))).orderBy(desc(releases.publishedAt)),
      ]);

      const releaseList = rels.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() }));
      const seen = new Set<string>();
      const latestReleases = releaseList.filter((r) => !seen.has(r.platform) && seen.add(r.platform));
      const { id: _id, ...rest } = p;
      return {
        ...(rest as Omit<ProductDetail, "categories" | "tags" | "media" | "requirements" | "latestReleases" | "releases">),
        categories: cats,
        tags: tgs,
        media,
        requirements: reqs.map((r) => ({ ...r, specs: r.specs as RequirementSpecs })),
        latestReleases,
        releases: releaseList,
      };
    },
  };
}
