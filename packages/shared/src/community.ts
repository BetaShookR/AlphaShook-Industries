import { z } from "zod";

const text = (min: number, max: number) =>
  z.string().trim().min(min, `Mínimo ${min} caracteres`).max(max, `Máximo ${max} caracteres`);

export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: text(10, 4000),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const profileInputSchema = z.object({
  displayName: z.string().trim().max(40).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(["public", "friends", "private"]).optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const threadInputSchema = z.object({
  /** slug del producto; ausente o null = foro general. */
  product: z.string().regex(/^[a-z0-9-]{1,80}$/).nullable().optional(),
  title: text(4, 120),
  body: text(2, 8000),
});
export type ThreadInput = z.infer<typeof threadInputSchema>;

export const postInputSchema = z.object({ body: text(2, 8000) });
export const moderateSchema = z.object({ hidden: z.boolean().optional(), locked: z.boolean().optional() });

export interface UserRef {
  username: string;
  displayName: string | null;
}

export interface Review {
  id: string;
  user: UserRef;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  /** índice 0 = 1 estrella … índice 4 = 5 estrellas */
  distribution: [number, number, number, number, number];
}

export interface ReviewPage {
  summary: ReviewSummary;
  items: Review[];
  total: number;
  /** Reseña propia del usuario autenticado (null si no hay o no hay sesión). */
  mine: Review | null;
  /** true si hay sesión y el producto está en su biblioteca. */
  canReview: boolean;
}

export type FriendState = "self" | "none" | "friends" | "request_sent" | "request_received";

export interface PublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  role: "user" | "developer" | "moderator" | "admin";
  memberSince: string;
  visibility: "public" | "friends" | "private";
  friendState: FriendState | null;
  friendCount: number;
  /** null = oculto por la privacidad del perfil */
  library: { slug: string; name: string; coverUrl: string | null }[] | null;
  reviews: { productSlug: string; productName: string; rating: number; body: string; createdAt: string }[];
}

export interface MyProfile {
  displayName: string | null;
  bio: string | null;
  visibility: "public" | "friends" | "private";
}

export interface FriendEntry extends UserRef {
  since: string;
}

export interface FriendsOverview {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  author: UserRef;
  product: { slug: string; name: string } | null;
  postCount: number;
  locked: boolean;
  hidden: boolean;
  createdAt: string;
  lastPostAt: string;
}

export interface ForumBoard {
  product: { slug: string; name: string } | null;
  threadCount: number;
  lastPostAt: string | null;
}

export interface ForumPost {
  id: string;
  author: UserRef;
  body: string;
  hidden: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ThreadPage {
  thread: ThreadSummary;
  posts: ForumPost[];
  total: number;
}
