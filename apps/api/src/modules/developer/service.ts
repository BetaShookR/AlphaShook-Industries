import { and, avg, count, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  DeveloperApplication,
  DeveloperApplicationInput,
  DevOrg,
  DevPortalStatus,
  DevProductCreate,
  DevProductDetail,
  DevProductInput,
  DevProductRow,
  ProductStatus,
} from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import {
  categories,
  developerApplications,
  libraryEntries,
  orgMembers,
  organizations,
  productCategories,
  productMedia,
  productRequirements,
  products,
  productTags,
  reviews,
  tags,
  users,
  wishlistItems,
} from "../../db/schema.js";
import { importProducts } from "../catalog/import.js";

/** Postgres 23505; drizzle envuelve el error original en `cause`. */
export const isUniqueViolation = (e: unknown): boolean =>
  (e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

export class DevError extends Error {
  constructor(public statusCode: number, public code: string) {
    super(code);
  }
}

export interface Actor {
  id: string;
  role: "user" | "developer" | "moderator" | "admin";
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const isAdmin = (a: Actor) => a.role === "admin";
export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "estudio";

export function createDeveloperService(db: Database) {
  /** Organizaciones que el actor puede administrar (admin: todas). */
  async function orgsOf(a: Actor): Promise<(DevOrg & { id: string })[]> {
    if (isAdmin(a)) {
      const rows = await db.select({ id: organizations.id, slug: organizations.slug, name: organizations.name }).from(organizations).orderBy(organizations.name);
      return rows.map((r) => ({ ...r, role: "admin" as const }));
    }
    return db.select({ id: organizations.id, slug: organizations.slug, name: organizations.name, role: orgMembers.role })
      .from(orgMembers).innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, a.id)).orderBy(organizations.name);
  }

  /** Producto editable por el actor, o error. */
  async function ownedProduct(a: Actor, slug: string) {
    const [p] = await db
      .select({ id: products.id, status: products.status, featured: products.featured, developerId: products.developerId,
        orgSlug: organizations.slug, orgName: organizations.name })
      .from(products).innerJoin(organizations, eq(organizations.id, products.developerId))
      .where(eq(products.slug, slug)).limit(1);
    if (!p) throw new DevError(404, "not_found");
    if (!isAdmin(a)) {
      const [m] = await db.select({ x: orgMembers.userId }).from(orgMembers)
        .where(and(eq(orgMembers.orgId, p.developerId), eq(orgMembers.userId, a.id))).limit(1);
      if (!m) throw new DevError(404, "not_found"); // no revelar productos ajenos
    }
    return p;
  }

  /** Convierte el formulario al formato del importador (fuente única de escritura de productos). */
  function toImport(slug: string, org: { slug: string; name: string }, d: DevProductInput, status: ProductStatus, featured: boolean) {
    return {
      slug, type: d.type, name: d.name, shortDescription: d.shortDescription, description: d.description,
      developer: org, publisher: org,
      coverUrl: d.coverUrl || null, priceCents: d.priceCents, currency: d.currency, status, featured,
      releaseDate: d.releaseDate || null, platforms: d.platforms, categories: d.categories,
      tags: d.tags.filter((t, i) => d.tags.findIndex((x) => slugify(x) === slugify(t)) === i).map((t) => ({ slug: slugify(t), name: t })),
      media: d.media.map((url) => ({ kind: "image" as const, url })),
      requirements: d.requirements.filter((r) => d.platforms.includes(r.platform) && Object.values(r.specs).some((v) => v)),
      releases: [],
    };
  }

  async function write(input: unknown) {
    try {
      await importProducts(db, { products: [input] });
    } catch (e) {
      if (e instanceof Error && e.message.includes("categorías inexistentes")) throw new DevError(400, "invalid_category");
      throw e;
    }
  }

  const appCols = {
    id: developerApplications.id, studioName: developerApplications.studioName, website: developerApplications.website,
    about: developerApplications.about, status: developerApplications.status, reviewNote: developerApplications.reviewNote,
    createdAt: developerApplications.createdAt, reviewedAt: developerApplications.reviewedAt,
  };
  type AppRow = Omit<DeveloperApplication, "createdAt" | "reviewedAt" | "user"> & { createdAt: Date; reviewedAt: Date | null };
  const toApp = (r: AppRow): DeveloperApplication => ({ ...r, createdAt: r.createdAt.toISOString(), reviewedAt: iso(r.reviewedAt) });

  return {
    // ───── Solicitudes ─────
    async portalStatus(a: Actor): Promise<DevPortalStatus> {
      const [orgs, [app]] = await Promise.all([
        orgsOf(a),
        db.select(appCols).from(developerApplications).where(eq(developerApplications.userId, a.id))
          .orderBy(desc(developerApplications.createdAt)).limit(1),
      ]);
      return { orgs: orgs.map(({ id: _id, ...o }) => o), application: app ? toApp(app) : null };
    },

    async apply(a: Actor, input: DeveloperApplicationInput) {
      if ((await orgsOf(a)).length) throw new DevError(409, "already_developer");
      try {
        const [r] = await db.insert(developerApplications)
          .values({ userId: a.id, studioName: input.studioName, website: input.website || null, about: input.about })
          .returning({ id: developerApplications.id });
        return r!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new DevError(409, "application_pending");
        throw e;
      }
    },

    async listApplications(status: "pending" | "approved" | "rejected"): Promise<DeveloperApplication[]> {
      const rows = await db.select({ ...appCols, username: users.username, email: users.email })
        .from(developerApplications).innerJoin(users, eq(users.id, developerApplications.userId))
        .where(eq(developerApplications.status, status)).orderBy(developerApplications.createdAt).limit(200);
      return rows.map(({ username, email, ...r }) => ({ ...toApp(r), user: { username, email } }));
    },

    /** Aprueba: crea el estudio (organización externa), agrega al usuario como dueño y le da rol developer. */
    async approveApplication(reviewer: Actor, id: string, note?: string) {
      return db.transaction(async (tx) => {
        const [app] = await tx.select().from(developerApplications)
          .where(and(eq(developerApplications.id, id), eq(developerApplications.status, "pending"))).for("update").limit(1);
        if (!app) throw new DevError(404, "not_found");
        const base = slugify(app.studioName);
        const taken = new Set((await tx.select({ s: organizations.slug }).from(organizations)
          .where(sql`${organizations.slug} = ${base} or ${organizations.slug} like ${base + "-%"}`)).map((r) => r.s));
        let orgSlug = base;
        for (let i = 2; taken.has(orgSlug); i++) orgSlug = `${base}-${i}`;
        const [org] = await tx.insert(organizations).values({ slug: orgSlug, name: app.studioName, kind: "external" }).returning({ id: organizations.id });
        await tx.insert(orgMembers).values({ orgId: org!.id, userId: app.userId, role: "owner" });
        await tx.update(users).set({ role: "developer", updatedAt: new Date() }).where(and(eq(users.id, app.userId), eq(users.role, "user")));
        await tx.update(developerApplications)
          .set({ status: "approved", orgId: org!.id, reviewNote: note || null, reviewedBy: reviewer.id, reviewedAt: new Date() })
          .where(eq(developerApplications.id, id));
        return { org: orgSlug };
      });
    },

    async rejectApplication(reviewer: Actor, id: string, note?: string) {
      const r = await db.update(developerApplications)
        .set({ status: "rejected", reviewNote: note || null, reviewedBy: reviewer.id, reviewedAt: new Date() })
        .where(and(eq(developerApplications.id, id), eq(developerApplications.status, "pending"))).returning({ id: developerApplications.id });
      if (!r.length) throw new DevError(404, "not_found");
    },

    // ───── Productos del desarrollador ─────
    async orgs(a: Actor) {
      return (await orgsOf(a)).map(({ id: _id, ...o }) => o);
    },

    async listProducts(a: Actor, onlyStatus?: ProductStatus): Promise<DevProductRow[]> {
      const orgs = await orgsOf(a);
      if (!orgs.length) return [];
      const conds = [inArray(products.developerId, orgs.map((o) => o.id))];
      if (onlyStatus) conds.push(eq(products.status, onlyStatus));
      const rows = await db.select({
        id: products.id, slug: products.slug, name: products.name, status: products.status, reviewNote: products.reviewNote,
        priceCents: products.priceCents, currency: products.currency, updatedAt: products.updatedAt, submittedAt: products.submittedAt,
        orgSlug: organizations.slug, orgName: organizations.name,
      }).from(products).innerJoin(organizations, eq(organizations.id, products.developerId))
        .where(and(...conds)).orderBy(desc(products.updatedAt));
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      // Estadísticas básicas por producto (adquisiciones, deseados, reseñas visibles).
      const [own, wish, rev] = await Promise.all([
        db.select({ id: libraryEntries.productId, n: count() }).from(libraryEntries).where(inArray(libraryEntries.productId, ids)).groupBy(libraryEntries.productId),
        db.select({ id: wishlistItems.productId, n: count() }).from(wishlistItems).where(inArray(wishlistItems.productId, ids)).groupBy(wishlistItems.productId),
        db.select({ id: reviews.productId, n: count(), avg: avg(reviews.rating) }).from(reviews)
          .where(and(inArray(reviews.productId, ids), eq(reviews.hidden, false))).groupBy(reviews.productId),
      ]);
      const get = <T extends { id: string }>(arr: T[], id: string) => arr.find((x) => x.id === id);
      return rows.map((r) => {
        const rv = get(rev, r.id);
        return {
          slug: r.slug, name: r.name, status: r.status, reviewNote: r.reviewNote, priceCents: r.priceCents, currency: r.currency,
          updatedAt: r.updatedAt.toISOString(), submittedAt: iso(r.submittedAt), org: { slug: r.orgSlug, name: r.orgName },
          stats: {
            owners: get(own, r.id)?.n ?? 0, wishlists: get(wish, r.id)?.n ?? 0, reviews: rv?.n ?? 0,
            avgRating: rv?.avg ? Math.round(Number(rv.avg) * 10) / 10 : null,
          },
        };
      });
    },

    async getProduct(a: Actor, slug: string): Promise<DevProductDetail> {
      const p = await ownedProduct(a, slug);
      const [[row], cats, tg, media, reqs] = await Promise.all([
        db.select().from(products).where(eq(products.id, p.id)),
        db.select({ slug: categories.slug }).from(productCategories).innerJoin(categories, eq(categories.id, productCategories.categoryId)).where(eq(productCategories.productId, p.id)),
        db.select({ name: tags.name }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(productTags.productId, p.id)),
        db.select({ url: productMedia.url }).from(productMedia).where(eq(productMedia.productId, p.id)).orderBy(productMedia.position),
        db.select().from(productRequirements).where(eq(productRequirements.productId, p.id)),
      ]);
      return {
        slug, org: { slug: p.orgSlug, name: p.orgName }, status: row!.status, reviewNote: row!.reviewNote,
        type: row!.type, name: row!.name, shortDescription: row!.shortDescription, description: row!.description,
        coverUrl: row!.coverUrl, priceCents: row!.priceCents, currency: row!.currency, releaseDate: row!.releaseDate,
        platforms: row!.platforms, categories: cats.map((c) => c.slug), tags: tg.map((t) => t.name), media: media.map((m) => m.url),
        requirements: reqs.map((r) => ({ platform: r.platform, level: r.level, specs: r.specs as Record<string, string> })),
      };
    },

    async createProduct(a: Actor, input: DevProductCreate) {
      const org = (await orgsOf(a)).find((o) => o.slug === input.org);
      if (!org) throw new DevError(403, "not_org_member");
      const [exists] = await db.select({ x: products.id }).from(products).where(eq(products.slug, input.slug)).limit(1);
      if (exists) throw new DevError(409, "slug_taken");
      const { slug, org: _o, ...data } = input;
      await write(toImport(slug, { slug: org.slug, name: org.name }, data, "draft", false));
      return { slug };
    },

    /** Edita. Publicados siguen publicados; en revisión no se puede editar (retirar primero). */
    async updateProduct(a: Actor, slug: string, data: DevProductInput) {
      const p = await ownedProduct(a, slug);
      if (p.status === "in_review") throw new DevError(409, "in_review_locked");
      await write(toImport(slug, { slug: p.orgSlug, name: p.orgName }, data, p.status, p.featured));
    },

    async submit(a: Actor, slug: string) {
      const p = await ownedProduct(a, slug);
      if (p.status !== "draft") throw new DevError(409, "invalid_status");
      await db.update(products).set({ status: "in_review", submittedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, p.id));
    },

    async withdraw(a: Actor, slug: string) {
      const p = await ownedProduct(a, slug);
      if (p.status !== "in_review") throw new DevError(409, "invalid_status");
      await db.update(products).set({ status: "draft", updatedAt: new Date() }).where(eq(products.id, p.id));
    },

    /** Publicado ↔ oculto (lo decide el desarrollador; volver a publicar no requiere nueva revisión). */
    async setVisibility(a: Actor, slug: string, visible: boolean) {
      const p = await ownedProduct(a, slug);
      const from = visible ? "hidden" : "published";
      if (p.status !== from) throw new DevError(409, "invalid_status");
      await db.update(products).set({ status: visible ? "published" : "hidden", updatedAt: new Date() }).where(eq(products.id, p.id));
    },

    // ───── Revisión (admin) ─────
    async reviewQueue(a: Actor) {
      return this.listProducts(a, "in_review");
    },

    async decide(slug: string, approve: boolean, note?: string) {
      const r = await db.update(products)
        .set(approve
          ? { status: "published", reviewNote: null, updatedAt: new Date() }
          : { status: "draft", reviewNote: note || "Rechazado sin comentario", updatedAt: new Date() })
        .where(and(eq(products.slug, slug), eq(products.status, "in_review"))).returning({ id: products.id });
      if (!r.length) throw new DevError(404, "not_found");
    },
  };
}
