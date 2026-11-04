import type {
  ForumBoard,
  FriendsOverview,
  MyProfile,
  ProfileInput,
  PublicProfile,
  ReviewPage,
  ThreadInput,
  ThreadPage,
  ThreadSummary,
  LibraryItem,
  OwnershipStatus,
  WishlistItem,
  CatalogPage,
  Category,
  HomeData,
  ProductDetail,
  PublicUser,
  SessionInfo,
  StoreIdentity,
} from "@alphashook/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: { path: string; message: string }[],
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (res.status === 204 || res.status === 202) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "network_error", body.details);
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  identity: () => request<StoreIdentity>("/store/identity"),
  home: () => request<HomeData>("/home"),
  categories: () => request<Category[]>("/categories"),
  products: (params: URLSearchParams) => request<CatalogPage>(`/products?${params}`),
  product: (slug: string) => request<ProductDetail>(`/products/${encodeURIComponent(slug)}`),

  me: () => request<PublicUser>("/me"),
  register: (d: Record<string, unknown>) => post<{ user: PublicUser }>("/auth/register", { ...d, deviceType: "web" }),
  login: (identifier: string, password: string) =>
    post<{ user: PublicUser }>("/auth/login", { identifier, password, deviceType: "web", deviceName: navigator.userAgent.slice(0, 100) }),
  logout: () => post<void>("/auth/logout"),
  sessions: () => request<SessionInfo[]>("/auth/sessions"),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
  revokeOthers: () => post<void>("/auth/sessions/revoke-others"),
  library: (params: URLSearchParams) => request<LibraryItem[]>(`/library?${params}`),
  addToLibrary: (slug: string) => post<void>(`/library/${encodeURIComponent(slug)}`),
  ownership: (slug: string) => request<OwnershipStatus>(`/me/products/${encodeURIComponent(slug)}`),
  wishlist: () => request<WishlistItem[]>("/wishlist"),
  wish: (slug: string, on: boolean) => request<void>(`/wishlist/${encodeURIComponent(slug)}`, { method: on ? "PUT" : "DELETE" }),
  // Comunidad
  reviews: (slug: string, offset = 0) => request<ReviewPage>(`/products/${encodeURIComponent(slug)}/reviews?offset=${offset}`),
  saveReview: (slug: string, rating: number, body: string) =>
    request<{ id: string }>(`/products/${encodeURIComponent(slug)}/review`, { method: "PUT", body: JSON.stringify({ rating, body }) }),
  deleteReview: (slug: string) => request<void>(`/products/${encodeURIComponent(slug)}/review`, { method: "DELETE" }),
  profile: (username: string) => request<PublicProfile>(`/users/${encodeURIComponent(username)}`),
  myProfile: () => request<MyProfile>("/me/profile"),
  updateProfile: (d: ProfileInput) => request<MyProfile>("/me/profile", { method: "PATCH", body: JSON.stringify(d) }),
  friends: () => request<FriendsOverview>("/friends"),
  addFriend: (u: string) => post<{ status: "requested" | "accepted" }>(`/friends/${encodeURIComponent(u)}`),
  acceptFriend: (u: string) => post<void>(`/friends/${encodeURIComponent(u)}/accept`),
  removeFriend: (u: string) => request<void>(`/friends/${encodeURIComponent(u)}`, { method: "DELETE" }),
  boards: () => request<ForumBoard[]>("/forums"),
  threads: (board: string, offset = 0) => request<{ items: ThreadSummary[]; total: number }>(`/forums/${encodeURIComponent(board)}/threads?offset=${offset}`),
  thread: (id: string, offset = 0) => request<ThreadPage>(`/forums/threads/${encodeURIComponent(id)}?offset=${offset}`),
  createThread: (d: ThreadInput) => post<{ id: string }>("/forums/threads", d),
  reply: (id: string, body: string) => post<{ id: string }>(`/forums/threads/${encodeURIComponent(id)}/posts`, { body }),
  editPost: (id: string, body: string) => request<void>(`/forums/posts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  moderate: (kind: "reviews" | "threads" | "posts", id: string, patch: { hidden?: boolean; locked?: boolean }) =>
    request<void>(`/mod/${kind}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  verifyEmail: (token: string) => post<void>("/auth/verify-email", { token }),
  resendVerification: () => post<void>("/auth/verify-email/resend"),
  forgotPassword: (email: string) => post<void>("/auth/password/forgot", { email }),
  resetPassword: (token: string, password: string, passwordConfirm: string) =>
    post<void>("/auth/password/reset", { token, password, passwordConfirm }),
};

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Usuario o contraseña incorrectos.",
  username_taken: "Ese nombre de usuario ya está en uso.",
  email_taken: "Ya existe una cuenta con ese correo.",
  rate_limited: "Demasiados intentos. Esperá un minuto y probá de nuevo.",
  invalid_or_expired_token: "El enlace no es válido o ya venció.",
  account_suspended: "La cuenta está suspendida.",
  already_verified: "Tu correo ya está verificado.",
  validation_error: "Revisá los datos ingresados.",
  unauthorized: "Tenés que iniciar sesión.",
  network_error: "No se pudo conectar con el servidor.",
  already_owned: "Ya tenés este producto en tu biblioteca.",
  payment_required: "Este producto es pago. Las compras se habilitan en una próxima etapa.",
  not_found: "El producto no existe o no está disponible.",
  not_owned: "Solo podés reseñar productos que estén en tu biblioteca.",
  user_not_found: "Ese usuario no existe.",
  cannot_friend_self: "No podés agregarte a vos mismo.",
  already_friends: "Ya son amigos.",
  request_already_sent: "Ya le enviaste una solicitud.",
  request_not_found: "La solicitud ya no existe.",
  too_many_pending: "Tenés demasiadas solicitudes pendientes.",
  thread_locked: "Este tema está cerrado.",
  forbidden: "No tenés permiso para hacer eso.",
};

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ?? "Ocurrió un error inesperado.") : MESSAGES.network_error!;

export const formatPrice = (cents: number, currency: string) =>
  cents === 0 ? "Gratis" : new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(cents / 100);

export const formatBytes = (n: number) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export const PLATFORM_LABEL = { windows: "Windows", linux: "Linux", android: "Android" } as const;
