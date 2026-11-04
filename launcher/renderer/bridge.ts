import type { CatalogPage, DownloadTicket, HomeData, LibraryItem, ProductDetail, PublicUser, StoreIdentity } from "../../packages/shared/src/index";

export type { CatalogPage, HomeData, LibraryItem, ProductDetail, PublicUser, StoreIdentity, DownloadTicket };
type Res<T> = Promise<{ ok: true; data: T } | { ok: false; error: string }>;

export interface Install { slug: string; name: string; version: string; platform: "windows" | "linux"; dir: string; launchPath: string; installedAt: string }
export interface Job {
  slug: string; name: string; version: string; sizeBytes: number; kind: "install" | "update";
  status: "queued" | "downloading" | "paused" | "verifying" | "installing" | "error";
  received: number; speed: number; etaSec: number | null; error: string | null; installPct: number;
}
export interface GamesState { installs: Record<string, Install>; jobs: Job[]; platform: "windows" | "linux"; libraryDir: string }
export interface Settings { apiUrl: string; libraryDir: string; platform: "windows" | "linux"; version: string }

interface Alpha {
  api<T>(method: string, path: string, body?: unknown): Res<T>;
  login(identifier: string, password: string): Res<PublicUser>;
  me(): Res<PublicUser | null>;
  logout(): Res<void>;
  settings(): Res<Settings>;
  setSettings(s: Partial<Pick<Settings, "apiUrl" | "libraryDir">>): Res<void>;
  pickDir(): Res<string | null>;
  state(): Res<GamesState>;
  install(slug: string): Res<{ version: string; sizeBytes: number }>;
  update(slug: string): Res<{ version: string; sizeBytes: number }>;
  pause(slug: string): Res<void>;
  resume(slug: string): Res<void>;
  cancel(slug: string): Res<void>;
  checkUpdates(): Res<Record<string, { version: string; sizeBytes: number } | null>>;
  uninstall(slug: string): Res<{ kept: number; dir?: string }>;
  openDir(slug: string): Res<void>;
  launch(slug: string): Res<void>;
  onState(fn: (s: GamesState) => void): () => void;
  onAuthExpired(fn: () => void): () => void;
  updateReady(): Res<string | null>;
  restartToUpdate(): Res<void>;
  onUpdate(fn: (version: string) => void): () => void;
}
declare global {
  interface Window { alpha: Alpha }
}

export class BridgeError extends Error {}
/** Desenvuelve la respuesta del proceso principal; lanza BridgeError con el código. */
export async function call<T>(p: Res<T>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new BridgeError(r.error);
  return r.data;
}
export const alpha = () => window.alpha;

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Usuario o contraseña incorrectos.",
  rate_limited: "Demasiados intentos. Esperá un minuto.",
  network_error: "No se pudo conectar con el servidor. Revisá tu internet (el servidor gratuito puede tardar ~1 minuto en despertar).",
  validation_error: "Revisá los datos ingresados.",
  unauthorized: "Tu sesión venció. Iniciá sesión de nuevo.",
  already_owned: "Ya está en tu biblioteca.",
  payment_required: "Este producto es pago. Las compras llegan en una próxima etapa.",
  not_found: "No encontrado.",
  not_owned: "Primero agregalo a tu biblioteca.",
  no_release: "El desarrollador todavía no subió una versión para tu sistema.",
  storage_not_configured: "Las descargas todavía no están habilitadas en el servidor.",
  no_space: "No hay espacio suficiente en el disco. Liberá espacio o cambiá la carpeta en Ajustes.",
  dir_not_empty: "La carpeta de instalación ya tiene archivos que no son de este juego. Cambiá la carpeta en Ajustes.",
  account_suspended: "La cuenta está suspendida.",
};
export const msg = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  if (code.startsWith("network_error:")) return `${MESSAGES.network_error} (detalle: ${code.slice(14)})`;
  return MESSAGES[code] ?? code;
};

export const bytes = (n: number) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const price = (cents: number, currency: string) =>
  cents === 0 ? "Gratis" : new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(cents / 100);
export const eta = (s: number | null) => (s === null ? "—" : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
