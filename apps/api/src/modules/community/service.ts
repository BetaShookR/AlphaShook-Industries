import { and, count, desc, eq, or, sql } from "drizzle-orm";
import type {
  FriendEntry,
  FriendsOverview,
  FriendState,
  ForumBoard,
  ForumPost,
  MyProfile,
  ProfileInput,
  PublicProfile,
  Review,
  ReviewInput,
  ReviewPage,
  ThreadInput,
  ThreadPage,
  ThreadSummary,
} from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import {
  forumPosts,
  forumThreads,
  friendships,
  libraryEntries,
  products,
  profiles,
  reviews,
  users,
} from "../../db/schema.js";

export class CommunityError extends Error {
  constructor(public statusCode: number, public code: string) {
    super(code);
  }
}

const userRef = { username: users.username, displayName: profiles.displayName };
const iso = (d: Date) => d.toISOString();
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

export function createCommunityService(db: Database) {
  async function publishedProduct(slug: string) {
    const [p] = await db
      .select({ id: products.id, slug: products.slug, name: products.name })
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.status, "published")))
      .limit(1);
    if (!p) throw new CommunityError(404, "not_found");
    return p;
  }

  async function activeUser(username: string) {
    const [u] = await db
      .select({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.status, "active")))
      .limit(1);
    if (!u) throw new CommunityError(404, "user_not_found");
    return u;
  }

  async function owns(userId: string, productId: string) {
    const [r] = await db.select({ x: libraryEntries.productId }).from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.productId, productId))).limit(1);
    return !!r;
  }

  const pairCond = (a: string, b: string) =>
    or(
      and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
      and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
    );

  async function friendState(viewerId: string, targetId: string): Promise<FriendState> {
    if (viewerId === targetId) return "self";
    const [f] = await db.select().from(friendships).where(pairCond(viewerId, targetId)).limit(1);
    if (!f) return "none";
    if (f.status === "accepted") return "friends";
    return f.requesterId === viewerId ? "request_sent" : "request_received";
  }

  const reviewCols = {
    id: reviews.id, rating: reviews.rating, body: reviews.body, createdAt: reviews.createdAt, updatedAt: reviews.updatedAt, ...userRef,
  };
  type ReviewRow = { id: string; rating: number; body: string; createdAt: Date; updatedAt: Date; username: string; displayName: string | null };
  const toReview = (r: ReviewRow): Review => ({
    id: r.id, rating: r.rating, body: r.body, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    user: { username: r.username, displayName: r.displayName },
  });
  const reviewBase = () =>
    db.select(reviewCols).from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .leftJoin(profiles, eq(profiles.userId, reviews.userId));
  // Solo cuentan reseñas visibles de cuentas activas.
  const visibleReview = and(eq(reviews.hidden, false), eq(users.status, "active"));

  // ───── Hilos ─────
  const threadCols = {
    id: forumThreads.id, title: forumThreads.title, postCount: forumThreads.postCount, locked: forumThreads.locked,
    hidden: forumThreads.hidden, createdAt: forumThreads.createdAt, lastPostAt: forumThreads.lastPostAt,
    productSlug: products.slug, productName: products.name, ...userRef,
  };
  const threadBase = () =>
    db.select(threadCols).from(forumThreads)
      .innerJoin(users, eq(users.id, forumThreads.authorId))
      .leftJoin(profiles, eq(profiles.userId, forumThreads.authorId))
      .leftJoin(products, eq(products.id, forumThreads.productId));
  type ThreadRow = Awaited<ReturnType<ReturnType<typeof threadBase>["execute"]>>[number];
  const toThread = (t: ThreadRow): ThreadSummary => ({
    id: t.id, title: t.title, postCount: t.postCount, locked: t.locked, hidden: t.hidden,
    createdAt: iso(t.createdAt), lastPostAt: iso(t.lastPostAt),
    author: { username: t.username, displayName: t.displayName },
    product: t.productSlug ? { slug: t.productSlug, name: t.productName! } : null,
  });

  async function threadRow(id: string, isMod: boolean) {
    const [t] = await threadBase().where(eq(forumThreads.id, id)).limit(1);
    // Hilos de productos no publicados o ocultos: solo moderación.
    if (!t || (!isMod && t.hidden)) throw new CommunityError(404, "not_found");
    return t;
  }

  return {
    // ───── Reseñas y valoraciones ─────
    async listReviews(slug: string, viewerId: string | null, offset: number, limit: number): Promise<ReviewPage> {
      const p = await publishedProduct(slug);
      const where = and(eq(reviews.productId, p.id), visibleReview);
      const [dist, items, [tot], mineRows, canReview] = await Promise.all([
        db.select({ rating: reviews.rating, n: count() }).from(reviews).innerJoin(users, eq(users.id, reviews.userId))
          .where(where).groupBy(reviews.rating),
        reviewBase().where(where).orderBy(desc(reviews.updatedAt)).limit(limit).offset(offset),
        db.select({ n: count() }).from(reviews).innerJoin(users, eq(users.id, reviews.userId)).where(where),
        viewerId ? reviewBase().where(and(eq(reviews.productId, p.id), eq(reviews.userId, viewerId))).limit(1) : [],
        viewerId ? owns(viewerId, p.id) : false,
      ]);
      const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      let sum = 0;
      for (const d of dist) {
        distribution[d.rating - 1] = d.n;
        sum += d.rating * d.n;
      }
      const n = distribution.reduce((a, b) => a + b, 0);
      return {
        summary: { count: n, average: n ? Math.round((sum / n) * 10) / 10 : null, distribution },
        items: items.map(toReview),
        total: tot!.n,
        mine: mineRows[0] ? toReview(mineRows[0]) : null,
        canReview,
      };
    },

    async upsertReview(userId: string, slug: string, input: ReviewInput) {
      const p = await publishedProduct(slug);
      if (!(await owns(userId, p.id))) throw new CommunityError(403, "not_owned");
      const [r] = await db.insert(reviews).values({ userId, productId: p.id, ...input })
        .onConflictDoUpdate({
          target: [reviews.userId, reviews.productId],
          set: { rating: input.rating, body: input.body, updatedAt: sql`now()` },
        })
        .returning({ id: reviews.id, created: sql<boolean>`(xmax = 0)` });
      return { id: r!.id, created: r!.created };
    },

    async deleteReview(userId: string, slug: string) {
      await db.delete(reviews).where(
        and(eq(reviews.userId, userId), sql`${reviews.productId} = (select id from ${products} where slug = ${slug})`),
      );
    },

    async moderateReview(id: string, hidden: boolean) {
      const r = await db.update(reviews).set({ hidden }).where(eq(reviews.id, id)).returning({ id: reviews.id });
      if (!r.length) throw new CommunityError(404, "not_found");
    },

    // ───── Perfiles ─────
    async getProfile(username: string, viewerId: string | null): Promise<PublicProfile> {
      const u = await activeUser(username);
      const [[prof], [fc], state] = await Promise.all([
        db.select().from(profiles).where(eq(profiles.userId, u.id)).limit(1),
        db.select({ n: count() }).from(friendships)
          .where(and(eq(friendships.status, "accepted"), or(eq(friendships.requesterId, u.id), eq(friendships.addresseeId, u.id)))),
        viewerId ? friendState(viewerId, u.id) : Promise.resolve(null),
      ]);
      const visibility = prof?.visibility ?? "public";
      const canSee = state === "self" || visibility === "public" || (visibility === "friends" && state === "friends");

      const [library, revs] = await Promise.all([
        canSee
          ? db.select({ slug: products.slug, name: products.name, coverUrl: products.coverUrl })
              .from(libraryEntries).innerJoin(products, eq(products.id, libraryEntries.productId))
              .where(and(eq(libraryEntries.userId, u.id), eq(products.status, "published")))
              .orderBy(desc(libraryEntries.acquiredAt)).limit(60)
          : null,
        // Las reseñas ya son públicas en cada producto: se muestran siempre.
        db.select({ productSlug: products.slug, productName: products.name, rating: reviews.rating, body: reviews.body, createdAt: reviews.createdAt })
          .from(reviews).innerJoin(products, eq(products.id, reviews.productId))
          .where(and(eq(reviews.userId, u.id), eq(reviews.hidden, false), eq(products.status, "published")))
          .orderBy(desc(reviews.updatedAt)).limit(10),
      ]);

      return {
        username: u.username,
        displayName: prof?.displayName ?? null,
        bio: canSee ? (prof?.bio ?? null) : null,
        role: u.role,
        memberSince: iso(u.createdAt),
        visibility,
        friendState: state,
        friendCount: fc!.n,
        library,
        reviews: revs.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
      };
    },

    async getMyProfile(userId: string): Promise<MyProfile> {
      const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
      return { displayName: p?.displayName ?? null, bio: p?.bio ?? null, visibility: p?.visibility ?? "public" };
    },

    async updateProfile(userId: string, input: ProfileInput): Promise<MyProfile> {
      const set: Partial<typeof profiles.$inferInsert> = {};
      if (input.displayName !== undefined) set.displayName = input.displayName || null;
      if (input.bio !== undefined) set.bio = input.bio || null;
      if (input.visibility) set.visibility = input.visibility;
      await db.insert(profiles).values({ userId, ...set })
        .onConflictDoUpdate({ target: profiles.userId, set: { ...set, updatedAt: sql`now()` } });
      return this.getMyProfile(userId);
    },

    // ───── Amigos ─────
    async friends(userId: string): Promise<FriendsOverview> {
      const other = sql<string>`case when ${friendships.requesterId} = ${userId} then ${friendships.addresseeId} else ${friendships.requesterId} end`;
      const rows = await db
        .select({ requesterId: friendships.requesterId, status: friendships.status, createdAt: friendships.createdAt,
          acceptedAt: friendships.acceptedAt, ...userRef })
        .from(friendships)
        .innerJoin(users, eq(users.id, other))
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(and(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)), eq(users.status, "active")))
        .orderBy(users.username);
      const out: FriendsOverview = { friends: [], incoming: [], outgoing: [] };
      for (const r of rows) {
        const e: FriendEntry = { username: r.username, displayName: r.displayName, since: iso(r.acceptedAt ?? r.createdAt) };
        if (r.status === "accepted") out.friends.push(e);
        else (r.requesterId === userId ? out.outgoing : out.incoming).push(e);
      }
      return out;
    },

    /** Envía solicitud; si el otro ya la había enviado, la acepta. */
    async requestFriend(userId: string, username: string): Promise<"requested" | "accepted"> {
      const t = await activeUser(username);
      if (t.id === userId) throw new CommunityError(400, "cannot_friend_self");
      const state = await friendState(userId, t.id);
      if (state === "friends") throw new CommunityError(409, "already_friends");
      if (state === "request_sent") throw new CommunityError(409, "request_already_sent");
      if (state === "request_received") {
        await this.acceptFriend(userId, username);
        return "accepted";
      }
      const [pending] = await db.select({ n: count() }).from(friendships)
        .where(and(eq(friendships.requesterId, userId), eq(friendships.status, "pending")));
      if (pending!.n >= 100) throw new CommunityError(429, "too_many_pending");
      try {
        await db.insert(friendships).values({ requesterId: userId, addresseeId: t.id });
      } catch (e) {
        if (uniqueViolation(e)) throw new CommunityError(409, "request_already_sent");
        throw e;
      }
      return "requested";
    },

    async acceptFriend(userId: string, username: string) {
      const t = await activeUser(username);
      const r = await db.update(friendships).set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(friendships.requesterId, t.id), eq(friendships.addresseeId, userId), eq(friendships.status, "pending")))
        .returning({ x: friendships.requesterId });
      if (!r.length) throw new CommunityError(404, "request_not_found");
    },

    /** Elimina amistad, cancela solicitud enviada o rechaza una recibida. */
    async removeFriend(userId: string, username: string) {
      const t = await activeUser(username);
      await db.delete(friendships).where(pairCond(userId, t.id));
    },

    // ───── Foros ─────
    async boards(): Promise<ForumBoard[]> {
      const stats = db.$with("stats").as(
        db.select({ productId: forumThreads.productId, n: count().as("n"), last: sql<Date>`max(${forumThreads.lastPostAt})`.as("last") })
          .from(forumThreads).where(eq(forumThreads.hidden, false)).groupBy(forumThreads.productId),
      );
      const [general, perProduct] = await Promise.all([
        db.with(stats).select({ n: stats.n, last: stats.last }).from(stats).where(sql`${stats.productId} is null`),
        db.with(stats).select({ slug: products.slug, name: products.name, n: stats.n, last: stats.last })
          .from(products).leftJoin(stats, eq(stats.productId, products.id))
          .where(eq(products.status, "published")).orderBy(products.name),
      ]);
      const toIso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
      return [
        { product: null, threadCount: Number(general[0]?.n ?? 0), lastPostAt: toIso(general[0]?.last) },
        ...perProduct.map((p) => ({ product: { slug: p.slug, name: p.name }, threadCount: Number(p.n ?? 0), lastPostAt: toIso(p.last) })),
      ];
    },

    async listThreads(board: string, isMod: boolean, offset: number, limit: number) {
      const boardCond = board === "general" ? sql`${forumThreads.productId} is null` : eq(forumThreads.productId, (await publishedProduct(board)).id);
      const where = isMod ? boardCond : and(boardCond, eq(forumThreads.hidden, false));
      const [rows, [tot]] = await Promise.all([
        threadBase().where(where).orderBy(desc(forumThreads.lastPostAt)).limit(limit).offset(offset),
        db.select({ n: count() }).from(forumThreads).where(where),
      ]);
      return { items: rows.map(toThread), total: tot!.n };
    },

    async createThread(userId: string, input: ThreadInput) {
      const productId = input.product ? (await publishedProduct(input.product)).id : null;
      return db.transaction(async (tx) => {
        const [t] = await tx.insert(forumThreads).values({ productId, authorId: userId, title: input.title, postCount: 1 })
          .returning({ id: forumThreads.id });
        await tx.insert(forumPosts).values({ threadId: t!.id, authorId: userId, body: input.body });
        return { id: t!.id };
      });
    },

    async getThread(id: string, isMod: boolean, offset: number, limit: number): Promise<ThreadPage> {
      const t = await threadRow(id, isMod);
      const where = eq(forumPosts.threadId, id);
      const [rows, [tot]] = await Promise.all([
        db.select({ id: forumPosts.id, body: forumPosts.body, hidden: forumPosts.hidden, createdAt: forumPosts.createdAt,
          editedAt: forumPosts.editedAt, ...userRef })
          .from(forumPosts).innerJoin(users, eq(users.id, forumPosts.authorId))
          .leftJoin(profiles, eq(profiles.userId, forumPosts.authorId))
          .where(where).orderBy(forumPosts.createdAt).limit(limit).offset(offset),
        db.select({ n: count() }).from(forumPosts).where(where),
      ]);
      const posts: ForumPost[] = rows.map((p) => ({
        id: p.id,
        author: { username: p.username, displayName: p.displayName },
        // Mensajes ocultos: se conserva el lugar pero no el contenido (salvo moderación).
        body: p.hidden && !isMod ? "" : p.body,
        hidden: p.hidden,
        createdAt: iso(p.createdAt),
        editedAt: p.editedAt ? iso(p.editedAt) : null,
      }));
      return { thread: toThread(t), posts, total: tot!.n };
    },

    async reply(userId: string, threadId: string, body: string, isMod: boolean) {
      const t = await threadRow(threadId, isMod);
      if (t.locked && !isMod) throw new CommunityError(403, "thread_locked");
      return db.transaction(async (tx) => {
        const [p] = await tx.insert(forumPosts).values({ threadId, authorId: userId, body }).returning({ id: forumPosts.id });
        await tx.update(forumThreads)
          .set({ postCount: sql`${forumThreads.postCount} + 1`, lastPostAt: sql`now()` })
          .where(eq(forumThreads.id, threadId));
        return { id: p!.id };
      });
    },

    async editPost(userId: string, postId: string, body: string) {
      const [p] = await db.select({ authorId: forumPosts.authorId, hidden: forumPosts.hidden, locked: forumThreads.locked })
        .from(forumPosts).innerJoin(forumThreads, eq(forumThreads.id, forumPosts.threadId))
        .where(eq(forumPosts.id, postId)).limit(1);
      if (!p) throw new CommunityError(404, "not_found");
      if (p.authorId !== userId || p.hidden || p.locked) throw new CommunityError(403, "forbidden");
      await db.update(forumPosts).set({ body, editedAt: sql`now()` }).where(eq(forumPosts.id, postId));
    },

    async moderateThread(id: string, patch: { hidden?: boolean | undefined; locked?: boolean | undefined }) {
      const set: { hidden?: boolean; locked?: boolean } = {};
      if (patch.hidden !== undefined) set.hidden = patch.hidden;
      if (patch.locked !== undefined) set.locked = patch.locked;
      if (!Object.keys(set).length) throw new CommunityError(400, "validation_error");
      const r = await db.update(forumThreads).set(set).where(eq(forumThreads.id, id)).returning({ id: forumThreads.id });
      if (!r.length) throw new CommunityError(404, "not_found");
    },

    async moderatePost(id: string, hidden: boolean) {
      const r = await db.update(forumPosts).set({ hidden }).where(eq(forumPosts.id, id)).returning({ id: forumPosts.id });
      if (!r.length) throw new CommunityError(404, "not_found");
    },
  };
}

export type CommunityService = ReturnType<typeof createCommunityService>;
