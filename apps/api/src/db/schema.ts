import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  check,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Configuración global clave/valor (identidad de la tienda, flags, etc.). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRole = pgEnum("user_role", ["user", "developer", "moderator", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const deviceType = pgEnum("device_type", ["web", "launcher", "android"]);
export const emailTokenType = pgEnum("email_token_type", ["verify_email", "reset_password"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    email: text("email").notNull(), // siempre en minúsculas
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

/** Sesiones por dispositivo. Se guarda solo el hash SHA-256 del token. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceType: deviceType("device_type").notNull(),
    deviceName: text("device_name"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Tokens de un solo uso enviados por correo (verificación y recuperación). */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: emailTokenType("type").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_tokens_hash_idx").on(t.tokenHash), index("email_tokens_user_idx").on(t.userId, t.type)],
);

// ───────────── Catálogo ─────────────
export const orgKind = pgEnum("org_kind", ["internal", "external"]);
export const productType = pgEnum("product_type", ["game", "app"]);
export const productStatus = pgEnum("product_status", ["draft", "in_review", "published", "hidden"]);
export const platform = pgEnum("platform", ["windows", "linux", "android"]);
export const reqLevel = pgEnum("requirement_level", ["minimum", "recommended"]);
export const mediaKind = pgEnum("media_kind", ["image", "video"]);

/** Desarrolladores y editores (incluye las divisiones internas de AlphaShook). */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: orgKind("kind").notNull().default("external"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    type: productType("type").notNull().default("game"),
    name: text("name").notNull(),
    shortDescription: text("short_description").notNull(),
    description: text("description").notNull(),
    developerId: uuid("developer_id").notNull().references(() => organizations.id),
    publisherId: uuid("publisher_id").notNull().references(() => organizations.id),
    coverUrl: text("cover_url"),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    status: productStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    releaseDate: date("release_date"),
    platforms: platform("platforms").array().notNull().default(sql`'{}'`),
    /** Motivo del último rechazo en revisión (portal de desarrolladores). */
    reviewNote: text("review_note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    search: tsvector("search").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${products.name}, '') || ' ' || coalesce(${products.shortDescription}, ''))`,
    ),
  },
  (t) => [
    index("products_status_release_idx").on(t.status, t.releaseDate),
    index("products_search_idx").using("gin", t.search),
  ],
);

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] }), index("product_categories_cat_idx").on(t.categoryId)],
);

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] })],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull().default("image"),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_media_product_idx").on(t.productId, t.position)],
);

export const productRequirements = pgTable(
  "product_requirements",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    platform: platform("platform").notNull(),
    level: reqLevel("level").notNull(),
    specs: jsonb("specs").notNull(), // { os, cpu, ram, gpu, storage, notes }
  },
  (t) => [primaryKey({ columns: [t.productId, t.platform, t.level] })],
);

/** Versiones publicadas. Los archivos binarios se agregan en la etapa del portal de desarrolladores. */
/** uploading → (archivo subido) verifying → ready | failed. Las versiones antiguas sin archivo quedan 'ready' sin storage_key. */
export const releaseStatus = pgEnum("release_status", ["uploading", "verifying", "ready", "failed"]);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    platform: platform("platform").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    changelog: text("changelog"),
    // clock_timestamp(): distinto por fila aun dentro de una transacción (ordena versiones importadas juntas).
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    status: releaseStatus("status").notNull().default("ready"),
    /** Clave del archivo .zip en el almacenamiento (R2). null = versión sin archivo descargable. */
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    sha256: text("sha256"),
    /** Ejecutable relativo a la carpeta de instalación (ej. "bin/Juego.exe"). */
    launchPath: text("launch_path"),
  },
  (t) => [
    uniqueIndex("releases_product_platform_version_idx").on(t.productId, t.platform, t.version),
    index("releases_latest_idx").on(t.productId, t.platform, t.publishedAt),
  ],
);

// ───────────── Biblioteca ─────────────
export const acquisitionSource = pgEnum("acquisition_source", ["free", "purchase", "gift", "grant"]);

/** Adquisiciones del usuario. Nunca se borran al desinstalar. */
export const libraryEntries = pgTable(
  "library_entries",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    source: acquisitionSource("source").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] }), index("library_entries_product_idx").on(t.productId)],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

// ───────────── Comunidad (Etapa 4b) ─────────────
export const profileVisibility = pgEnum("profile_visibility", ["public", "friends", "private"]);
export const friendshipStatus = pgEnum("friendship_status", ["pending", "accepted"]);

/** Perfil público (1:1 con users). Se crea al primer uso; sin fila = valores por defecto. */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  bio: text("bio"),
  visibility: profileVisibility("visibility").notNull().default("public"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Reseña + valoración (1–5). Solo de productos en la biblioteca del autor; una por usuario y producto. */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reviews_user_product_idx").on(t.userId, t.productId),
    index("reviews_product_idx").on(t.productId, t.createdAt),
    check("reviews_rating_chk", sql`${t.rating} between 1 and 5`),
  ],
);

/** Amistad dirigida: requester → addressee. Un solo vínculo por par sin importar el sentido. */
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    uniqueIndex("friendships_pair_idx").on(sql`least(${t.requesterId}, ${t.addresseeId})`, sql`greatest(${t.requesterId}, ${t.addresseeId})`),
    index("friendships_addressee_idx").on(t.addresseeId, t.status),
    check("friendships_not_self_chk", sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

/** Hilos del foro. product_id null = foro general. */
export const forumThreads = pgTable(
  "forum_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    locked: boolean("locked").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    postCount: integer("post_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastPostAt: timestamp("last_post_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("forum_threads_board_idx").on(t.productId, t.lastPostAt)],
);

export const forumPosts = pgTable(
  "forum_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => forumThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("forum_posts_thread_idx").on(t.threadId, t.createdAt)],
);

// ───────────── Portal de desarrolladores (Etapa 5) ─────────────
export const orgMemberRole = pgEnum("org_member_role", ["owner", "member"]);
export const applicationStatus = pgEnum("application_status", ["pending", "approved", "rejected"]);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: orgMemberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

/** Solicitudes para publicar como desarrollador. Una sola pendiente por usuario. */
export const developerApplications = pgTable(
  "developer_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studioName: text("studio_name").notNull(),
    website: text("website"),
    about: text("about").notNull(),
    status: applicationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("developer_applications_pending_idx").on(t.userId).where(sql`${t.status} = 'pending'`),
    index("developer_applications_status_idx").on(t.status, t.createdAt),
  ],
);
