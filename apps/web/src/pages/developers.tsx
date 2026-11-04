import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import type { DevProductDetail, DevProductInput, DevProductRow, Platform, ProductStatus } from "@alphashook/shared";
import { api, errorMessage, formatPrice, PLATFORM_LABEL } from "../api";
import { useAsync, useSession } from "../hooks";
import { ErrorBox, fieldErrors } from "../components/ui";

const STATUS: Record<ProductStatus, { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "warn" },
  in_review: { label: "En revisión", cls: "warn" },
  published: { label: "Publicado", cls: "" },
  hidden: { label: "Oculto", cls: "warn" },
};
const StatusBadge = ({ s }: { s: ProductStatus }) => <span className={`badge ${STATUS[s].cls}`}>{STATUS[s].label}</span>;
const date = (s: string) => new Date(s).toLocaleDateString("es-AR");
const Err = ({ m }: { m?: string | undefined }) => (m ? <span className="err">{m}</span> : null);

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, fe: fieldErrors(error) };
}

function RequireLogin({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ───────────── /developers: solicitud ─────────────
export function DevelopersPage() {
  return <RequireLogin><DevelopersInner /></RequireLogin>;
}

function DevelopersInner() {
  const [tick, setTick] = useState(0);
  const { data, error } = useAsync(() => api.devStatus(), [tick]);
  const [v, setV] = useState({ studioName: "", website: "", about: "" });
  const f = useRun();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="skeleton" />;
  if (data.orgs.length) return <Navigate to="/dev" replace />;

  const app = data.application;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await f.run(() => api.devApply(v))) setTick((t) => t + 1);
  };
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>Publicá en la tienda</h1>
      <p className="muted">Solicitá una cuenta de desarrollador. Cuando el equipo la apruebe vas a tener tu estudio y podrás cargar productos y enviarlos a revisión.</p>
      {app?.status === "pending" ? (
        <div className="alert info">Tu solicitud para <strong>{app.studioName}</strong> está en revisión (enviada el {date(app.createdAt)}).</div>
      ) : (
        <>
          {app?.status === "rejected" && (
            <div className="alert error" style={{ marginBottom: 16 }}>
              Tu solicitud anterior fue rechazada{app.reviewNote ? `: ${app.reviewNote}` : "."} Podés enviar una nueva.
            </div>
          )}
          <form className="card form" style={{ padding: 20 }} onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="d-studio">Nombre del estudio o desarrollador</label>
              <input id="d-studio" value={v.studioName} maxLength={60} onChange={(e) => setV({ ...v, studioName: e.target.value })} required />
              <Err m={f.fe.studioName} />
            </div>
            <div className="field">
              <label htmlFor="d-web">Sitio web o red social (opcional)</label>
              <input id="d-web" type="url" placeholder="https://" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
              <Err m={f.fe.website} />
            </div>
            <div className="field">
              <label htmlFor="d-about">¿Qué hacés y qué querés publicar?</label>
              <textarea id="d-about" value={v.about} maxLength={2000} onChange={(e) => setV({ ...v, about: e.target.value })} required />
              <Err m={f.fe.about} />
            </div>
            {f.error !== undefined && !Object.keys(f.fe).length ? <ErrorBox error={f.error} /> : null}
            <button className="btn primary" disabled={f.busy}>Enviar solicitud</button>
          </form>
        </>
      )}
    </div>
  );
}

// ───────────── /dev: panel del desarrollador ─────────────
export function DevDashboardPage() {
  return <RequireLogin><DevDashboard /></RequireLogin>;
}

function DevDashboard() {
  const status = useAsync(() => api.devStatus(), []);
  const list = useAsync(() => api.devProducts(), []);
  if (status.error) return <ErrorBox error={status.error} />;
  if (!status.data) return <div className="skeleton" />;
  if (!status.data.orgs.length) return <Navigate to="/developers" replace />;
  const orgs = status.data.orgs;

  return (
    <div>
      <div className="section-head">
        <h1 style={{ margin: 0 }}>Portal de desarrolladores</h1>
        <Link to="/dev/new" className="btn primary small">Nuevo producto</Link>
      </div>
      <p className="muted">Estudio{orgs.length > 1 ? "s" : ""}: {orgs.map((o) => o.name).join(", ")}</p>
      <div className="alert info" style={{ marginBottom: 16 }}>
        La subida de archivos de instalación (versiones) se habilita junto con el launcher. Por ahora cargás la ficha del producto.
      </div>
      {list.error ? <ErrorBox error={list.error} /> : !list.data ? <div className="skeleton" /> : list.data.length === 0 ? (
        <div className="empty">Todavía no tenés productos. <Link to="/dev/new" style={{ color: "var(--accent-2)" }}>Crear el primero</Link></div>
      ) : (
        <div className="stack">{list.data.map((p) => <DevRow key={p.slug} p={p} />)}</div>
      )}
    </div>
  );
}

function DevRow({ p, actions }: { p: DevProductRow; actions?: ReactNode }) {
  const s = p.stats;
  return (
    <div className="card list-row">
      <span>
        <Link to={`/dev/p/${p.slug}`} className="title">{p.name}</Link> <StatusBadge s={p.status} />
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          {p.org.name} · {formatPrice(p.priceCents, p.currency)} · actualizado {date(p.updatedAt)}
        </div>
        {p.reviewNote && p.status === "draft" && <div className="err" style={{ color: "var(--danger)", fontSize: "0.88rem" }}>Rechazado: {p.reviewNote}</div>}
      </span>
      {actions ?? (
        <span className="muted" style={{ fontSize: "0.88rem" }}>
          {s.owners} en bibliotecas · {s.wishlists} deseados · {s.reviews} reseñas{s.avgRating !== null && ` (${s.avgRating}★)`}
        </span>
      )}
    </div>
  );
}

// ───────────── /dev/new y /dev/p/:slug: formulario ─────────────
type Specs = Record<"os" | "cpu" | "ram" | "gpu" | "storage", string>;
const SPEC_FIELDS: [keyof Specs, string][] = [["os", "Sistema"], ["cpu", "Procesador"], ["ram", "Memoria"], ["gpu", "Gráficos"], ["storage", "Almacenamiento"]];
const LEVELS = [["minimum", "Mínimos"], ["recommended", "Recomendados"]] as const;
const emptySpecs = (): Specs => ({ os: "", cpu: "", ram: "", gpu: "", storage: "" });

interface FormState {
  slug: string;
  org: string;
  type: "game" | "app";
  name: string;
  shortDescription: string;
  description: string;
  coverUrl: string;
  price: string;
  releaseDate: string;
  platforms: Platform[];
  categories: string[];
  tags: string;
  media: string;
  reqs: Record<string, Specs>; // clave "plataforma:nivel"
}

const fromDetail = (d: DevProductDetail): FormState => ({
  slug: d.slug, org: d.org.slug, type: d.type, name: d.name, shortDescription: d.shortDescription, description: d.description,
  coverUrl: d.coverUrl ?? "", price: (d.priceCents / 100).toString(), releaseDate: d.releaseDate ?? "",
  platforms: d.platforms, categories: d.categories, tags: d.tags.join(", "), media: d.media.join("\n"),
  reqs: Object.fromEntries(d.requirements.map((r) => [`${r.platform}:${r.level}`, { ...emptySpecs(), ...r.specs }])),
});

const toInput = (s: FormState): DevProductInput => ({
  type: s.type, name: s.name, shortDescription: s.shortDescription, description: s.description,
  coverUrl: s.coverUrl.trim() || null, priceCents: Math.round((Number(s.price.replace(",", ".")) || 0) * 100), currency: "USD",
  releaseDate: s.releaseDate || null, platforms: s.platforms, categories: s.categories,
  tags: s.tags.split(",").map((t) => t.trim()).filter(Boolean),
  media: s.media.split("\n").map((m) => m.trim()).filter(Boolean),
  requirements: Object.entries(s.reqs).map(([k, specs]) => {
    const [platform, level] = k.split(":") as [Platform, "minimum" | "recommended"];
    return { platform, level, specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim())) };
  }).filter((r) => Object.keys(r.specs).length),
});

const slugFrom = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export function DevProductPage() {
  return <RequireLogin><DevProductInner /></RequireLogin>;
}

function DevProductInner() {
  const { slug } = useParams();
  const isNew = !slug;
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  const cats = useAsync(() => api.categories(), []);
  const orgs = useAsync(() => api.devOrgs(), []);
  const detail = useAsync(() => (slug ? api.devProduct(slug) : Promise.resolve(null)), [slug, tick]);
  const [s, setS] = useState<FormState | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [msg, setMsg] = useState<string>();
  const f = useRun();

  useEffect(() => {
    if (detail.data) setS(fromDetail(detail.data));
    else if (isNew && orgs.data && !s) {
      setS({ slug: "", org: orgs.data[0]?.slug ?? "", type: "game", name: "", shortDescription: "", description: "", coverUrl: "",
        price: "0", releaseDate: "", platforms: [], categories: [], tags: "", media: "", reqs: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, orgs.data]);

  if (detail.error) return <div className="empty">{errorMessage(detail.error)} <Link to="/dev" className="muted">Volver al portal</Link></div>;
  if (!s || !cats.data || !orgs.data) return <div className="skeleton" />;
  if (isNew && !orgs.data.length) return <Navigate to="/developers" replace />;

  const status = detail.data?.status;
  const locked = status === "in_review";
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS({ ...s, [k]: v });
  const toggle = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  const setSpec = (key: string, field: keyof Specs, v: string) =>
    set("reqs", { ...s.reqs, [key]: { ...(s.reqs[key] ?? emptySpecs()), [field]: v } });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setMsg(undefined);
    const ok = await f.run(() => (isNew ? api.devCreate({ ...toInput(s), slug: s.slug, org: s.org }) : api.devUpdate(slug!, toInput(s))));
    if (ok && isNew) nav(`/dev/p/${s.slug}`, { replace: true });
    else if (ok) {
      setMsg(status === "published" ? "Guardado. Los cambios ya se ven en la tienda." : "Guardado.");
      setTick((t) => t + 1);
    }
    return ok;
  };
  const action = async (a: "submit" | "withdraw" | "hide" | "show") => {
    if (a === "submit" && !(await save())) return;
    if (await f.run(() => api.devAction(slug!, a))) {
      setMsg(a === "submit" ? "Enviado a revisión. Te avisamos con el resultado en este portal." : undefined);
      setTick((t) => t + 1);
    }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <p className="muted"><Link to="/dev">Portal de desarrolladores</Link> › {isNew ? "Nuevo producto" : s.name}</p>
      <div className="section-head">
        <h1 style={{ margin: 0 }}>{isNew ? "Nuevo producto" : s.name} {status && <StatusBadge s={status} />}</h1>
        {status === "published" && <Link to={`/p/${slug}`} className="btn small">Ver en la tienda</Link>}
      </div>
      {detail.data?.reviewNote && status === "draft" && <div className="alert error">Revisión rechazada: {detail.data.reviewNote}</div>}
      {locked && <div className="alert info">En revisión: no se puede editar. Retiralo de la revisión si necesitás cambiar algo.</div>}
      {msg && <div className="alert ok">{msg}</div>}

      <form className="card form" style={{ padding: 20 }} onSubmit={(e) => void save(e)}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
          {isNew && (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="pf-org">Estudio</label>
                <select id="pf-org" value={s.org} onChange={(e) => set("org", e.target.value)}>
                  {orgs.data.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-slug">Dirección en la tienda (no se puede cambiar)</label>
                <input id="pf-slug" value={s.slug} maxLength={80} onChange={(e) => { setSlugTouched(true); set("slug", slugFrom(e.target.value)); }} required />
                <span className="muted" style={{ fontSize: "0.82rem" }}>/p/{s.slug || "mi-juego"}</span>
                <Err m={f.fe.slug} />
              </div>
            </div>
          )}
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pf-name">Nombre</label>
              <input id="pf-name" value={s.name} maxLength={120} required
                onChange={(e) => setS({ ...s, name: e.target.value, ...(isNew && !slugTouched ? { slug: slugFrom(e.target.value) } : {}) })} />
              <Err m={f.fe.name} />
            </div>
            <div className="field">
              <label htmlFor="pf-type">Tipo</label>
              <select id="pf-type" value={s.type} onChange={(e) => set("type", e.target.value as "game" | "app")}>
                <option value="game">Juego</option><option value="app">Aplicación</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="pf-short">Descripción breve</label>
            <input id="pf-short" value={s.shortDescription} maxLength={300} onChange={(e) => set("shortDescription", e.target.value)} required />
            <Err m={f.fe.shortDescription} />
          </div>
          <div className="field">
            <label htmlFor="pf-desc">Descripción completa</label>
            <textarea id="pf-desc" style={{ minHeight: 180 }} value={s.description} maxLength={20000} onChange={(e) => set("description", e.target.value)} required />
            <Err m={f.fe.description} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pf-price">Precio en USD (0 = gratis)</label>
              <input id="pf-price" inputMode="decimal" value={s.price} onChange={(e) => set("price", e.target.value)} />
              {Number(s.price.replace(",", ".")) > 0 && <span className="muted" style={{ fontSize: "0.82rem" }}>Las compras se habilitan en la etapa de pagos.</span>}
              <Err m={f.fe.priceCents} />
            </div>
            <div className="field">
              <label htmlFor="pf-date">Fecha de lanzamiento (opcional)</label>
              <input id="pf-date" type="date" value={s.releaseDate} onChange={(e) => set("releaseDate", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Plataformas</label>
            <div className="chips">
              {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                <label key={p} className="chip check-chip">
                  <input type="checkbox" checked={s.platforms.includes(p)} onChange={() => set("platforms", toggle(s.platforms, p))} /> {PLATFORM_LABEL[p]}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Categorías (hasta 5)</label>
            <div className="chips">
              {cats.data.map((c) => (
                <label key={c.slug} className="chip check-chip">
                  <input type="checkbox" checked={s.categories.includes(c.slug)}
                    disabled={!s.categories.includes(c.slug) && s.categories.length >= 5}
                    onChange={() => set("categories", toggle(s.categories, c.slug))} /> {c.name}
                </label>
              ))}
            </div>
            <Err m={f.fe.categories} />
          </div>
          <div className="field">
            <label htmlFor="pf-tags">Etiquetas (separadas por coma)</label>
            <input id="pf-tags" value={s.tags} placeholder="pixel art, cooperativo" onChange={(e) => set("tags", e.target.value)} />
            <Err m={f.fe.tags} />
          </div>
          <div className="field">
            <label htmlFor="pf-cover">Portada (URL de imagen, formato vertical 3:4)</label>
            <input id="pf-cover" type="url" placeholder="https://" value={s.coverUrl} onChange={(e) => set("coverUrl", e.target.value)} />
            <Err m={f.fe.coverUrl} />
          </div>
          <div className="field">
            <label htmlFor="pf-media">Galería: URLs de imágenes (una por línea)</label>
            <textarea id="pf-media" value={s.media} onChange={(e) => set("media", e.target.value)} placeholder="https://..." />
            {Object.entries(f.fe).filter(([k]) => k.startsWith("media")).map(([k, m]) => <Err key={k} m={`Imagen ${Number(k.split(".")[1]) + 1}: ${m}`} />)}
          </div>
          {s.platforms.filter((p) => p !== "android").map((p) => (
            <div key={p} className="field">
              <label>Requisitos — {PLATFORM_LABEL[p]}</label>
              <div className="grid-2">
                {LEVELS.map(([lvl, label]) => (
                  <div key={lvl} className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
                    <strong style={{ fontSize: "0.9rem" }}>{label}</strong>
                    {SPEC_FIELDS.map(([k, l]) => (
                      <input key={k} placeholder={l} aria-label={`${l} ${label} ${PLATFORM_LABEL[p]}`} value={s.reqs[`${p}:${lvl}`]?.[k] ?? ""}
                        maxLength={120} onChange={(e) => setSpec(`${p}:${lvl}`, k, e.target.value)} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        {f.error !== undefined && !Object.keys(f.fe).length ? <ErrorBox error={f.error} /> : null}
        {Object.keys(f.fe).length > 0 && <div className="alert error">Revisá los campos marcados.</div>}
        <div className="row-actions">
          {!locked && <button className="btn primary" disabled={f.busy}>{isNew ? "Crear borrador" : "Guardar"}</button>}
          {status === "draft" && <button type="button" className="btn" disabled={f.busy} onClick={() => void action("submit")}>Guardar y enviar a revisión</button>}
          {status === "in_review" && <button type="button" className="btn" disabled={f.busy} onClick={() => void action("withdraw")}>Retirar de revisión</button>}
          {status === "published" && <button type="button" className="btn danger" disabled={f.busy} onClick={() => void action("hide")}>Ocultar de la tienda</button>}
          {status === "hidden" && <button type="button" className="btn" disabled={f.busy} onClick={() => void action("show")}>Volver a publicar</button>}
        </div>
      </form>
    </div>
  );
}

// ───────────── /admin: solicitudes y revisión ─────────────
export function AdminPage() {
  const { user, ready } = useSession();
  const [tick, setTick] = useState(0);
  const apps = useAsync(() => (user?.role === "admin" ? api.adminApplications() : Promise.resolve([])), [user?.id, tick]);
  const queue = useAsync(() => (user?.role === "admin" ? api.adminReview() : Promise.resolve([])), [user?.id, tick]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const f = useRun();
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <div className="empty">Solo administradores.</div>;

  const decide = async (fn: () => Promise<unknown>) => {
    if (await f.run(fn)) setTick((t) => t + 1);
  };
  const noteInput = (id: string) => (
    <input placeholder="Motivo (se le muestra al desarrollador)" value={notes[id] ?? ""} maxLength={1000}
      onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <h1>Administración</h1>
      <p className="muted">Por ahora: solicitudes de desarrolladores y revisión de productos. El panel completo llega en la Etapa 9.</p>
      {f.error !== undefined ? <ErrorBox error={f.error} /> : null}

      <section className="section" style={{ marginTop: 20 }}>
        <h2>Solicitudes de desarrollador {apps.data && `(${apps.data.length})`}</h2>
        {!apps.data ? <div className="skeleton" /> : apps.data.length === 0 ? <div className="empty">No hay solicitudes pendientes.</div> : (
          <div className="stack">
            {apps.data.map((a) => (
              <div key={a.id} className="card post">
                <div className="post-head">
                  <strong style={{ color: "var(--text)" }}>{a.studioName}</strong>
                  <span><Link to={`/u/${a.user!.username}`}>{a.user!.username}</Link> · {a.user!.email} · {date(a.createdAt)}</span>
                </div>
                {a.website && <a href={a.website} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "var(--accent-2)" }}>{a.website}</a>}
                <div className="post-body">{a.about}</div>
                <div className="row-actions">
                  <button className="btn primary small" disabled={f.busy} onClick={() => void decide(() => api.adminDecideApplication(a.id, true, notes[a.id] ?? ""))}>Aprobar</button>
                  {noteInput(a.id)}
                  <button className="btn small danger" disabled={f.busy} onClick={() => void decide(() => api.adminDecideApplication(a.id, false, notes[a.id] ?? ""))}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section" style={{ marginTop: 28 }}>
        <h2>Productos para revisar {queue.data && `(${queue.data.length})`}</h2>
        {!queue.data ? <div className="skeleton" /> : queue.data.length === 0 ? <div className="empty">No hay productos esperando revisión.</div> : (
          <div className="stack">
            {queue.data.map((p) => (
              <DevRow key={p.slug} p={p} actions={
                <span className="row-actions" style={{ flex: 1, justifyContent: "flex-end" }}>
                  <Link to={`/dev/p/${p.slug}`} className="btn small">Ver ficha</Link>
                  <button className="btn primary small" disabled={f.busy} onClick={() => void decide(() => api.adminDecideProduct(p.slug, true, ""))}>Publicar</button>
                  {noteInput(p.slug)}
                  <button className="btn small danger" disabled={f.busy || !(notes[p.slug] ?? "").trim()} title="Escribí el motivo"
                    onClick={() => void decide(() => api.adminDecideProduct(p.slug, false, notes[p.slug] ?? ""))}>Rechazar</button>
                </span>
              } />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
