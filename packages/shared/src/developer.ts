import { z } from "zod";
import { platformSchema, type Platform } from "./catalog.js";

const slug = z.string().regex(/^[a-z0-9-]{1,80}$/, "Solo minúsculas, números y guiones");
const opt = (max: number) => z.string().trim().max(max).optional();

export const developerApplicationSchema = z.object({
  studioName: z.string().trim().min(2, "Mínimo 2 caracteres").max(60),
  website: z.union([z.string().trim().url("URL inválida").max(200), z.literal("")]).optional(),
  about: z.string().trim().min(20, "Contanos un poco más (mínimo 20 caracteres)").max(2000),
});
export type DeveloperApplicationInput = z.infer<typeof developerApplicationSchema>;

export const reqSpecsSchema = z.object({
  os: opt(120), cpu: opt(120), ram: opt(60), gpu: opt(120), storage: opt(60), notes: opt(300),
}).strict();

/** Datos que un desarrollador puede editar de su producto (sin estado, destacado ni versiones). */
export const devProductSchema = z.object({
  type: z.enum(["game", "app"]).default("game"),
  name: z.string().trim().min(1, "Obligatorio").max(120),
  shortDescription: z.string().trim().min(10, "Mínimo 10 caracteres").max(300),
  description: z.string().trim().min(30, "Mínimo 30 caracteres").max(20_000),
  coverUrl: z.union([z.string().trim().url("URL inválida"), z.literal("")]).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_00).default(0),
  currency: z.string().length(3).default("USD"),
  releaseDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).nullable().optional(),
  platforms: z.array(platformSchema).max(3).default([]),
  categories: z.array(slug).max(5, "Máximo 5 categorías").default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(10, "Máximo 10 etiquetas").default([]),
  media: z.array(z.string().trim().url("URL inválida")).max(12).default([]),
  requirements: z.array(z.object({ platform: platformSchema, level: z.enum(["minimum", "recommended"]), specs: reqSpecsSchema })).max(6).default([]),
});
export type DevProductInput = z.infer<typeof devProductSchema>;

export const devProductCreateSchema = devProductSchema.extend({ slug, org: slug });
export type DevProductCreate = z.infer<typeof devProductCreateSchema>;

export const reviewDecisionSchema = z.object({ note: z.string().trim().max(1000).optional() });

export type ProductStatus = "draft" | "in_review" | "published" | "hidden";

export interface DevOrg {
  slug: string;
  name: string;
  role: "owner" | "member" | "admin";
}

export interface DeveloperApplication {
  id: string;
  studioName: string;
  website: string | null;
  about: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Solo en la vista de administración */
  user?: { username: string; email: string };
}

export interface DevPortalStatus {
  orgs: DevOrg[];
  application: DeveloperApplication | null;
}

export interface DevProductStats {
  owners: number;
  wishlists: number;
  reviews: number;
  avgRating: number | null;
}

export interface DevProductRow {
  slug: string;
  name: string;
  status: ProductStatus;
  reviewNote: string | null;
  org: { slug: string; name: string };
  priceCents: number;
  currency: string;
  updatedAt: string;
  submittedAt: string | null;
  stats: DevProductStats;
}

export interface DevProductDetail extends Omit<DevProductInput, "media"> {
  slug: string;
  org: { slug: string; name: string };
  status: ProductStatus;
  reviewNote: string | null;
  media: string[];
  platforms: Platform[];
}
