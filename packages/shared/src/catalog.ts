import { z } from "zod";

export const platformSchema = z.enum(["windows", "linux", "android"]);
export type Platform = z.infer<typeof platformSchema>;

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(64).optional(),
  type: z.enum(["game", "app"]).optional(),
  sort: z.enum(["recent", "name", "price_asc", "price_desc"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export interface OrgRef {
  slug: string;
  name: string;
}

export interface ProductSummary {
  slug: string;
  type: "game" | "app";
  name: string;
  shortDescription: string;
  coverUrl: string | null;
  priceCents: number;
  currency: string;
  platforms: Platform[];
  releaseDate: string | null;
  developer: OrgRef;
}

export interface CatalogPage {
  items: ProductSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface Category {
  slug: string;
  name: string;
}

export interface RequirementSpecs {
  os?: string;
  cpu?: string;
  ram?: string;
  gpu?: string;
  storage?: string;
  notes?: string;
}

export interface ReleaseInfo {
  version: string;
  platform: Platform;
  sizeBytes: number;
  changelog: string | null;
  publishedAt: string;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  publisher: OrgRef;
  categories: Category[];
  tags: Category[];
  media: { kind: "image" | "video"; url: string }[];
  requirements: { platform: Platform; level: "minimum" | "recommended"; specs: RequirementSpecs }[];
  /** Versión más reciente por plataforma. */
  latestReleases: ReleaseInfo[];
  releases: ReleaseInfo[];
}

export interface HomeData {
  featured: ProductSummary[];
  recent: ProductSummary[];
  categories: Category[];
}

export interface LibraryItem {
  product: ProductSummary;
  source: "free" | "purchase" | "gift" | "grant";
  acquiredAt: string;
  categories: Category[];
  latestReleases: Pick<ReleaseInfo, "version" | "platform" | "sizeBytes">[];
}

export interface WishlistItem {
  product: ProductSummary;
  addedAt: string;
}

export interface OwnershipStatus {
  owned: boolean;
  wishlisted: boolean;
}
