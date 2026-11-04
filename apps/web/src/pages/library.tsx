import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { api, errorMessage, formatBytes, PLATFORM_LABEL } from "../api";
import { useAsync, useSession } from "../hooks";
import { Cover, ErrorBox, ProductGrid } from "../components/ui";

/** Botones de la página de producto: agregar a la biblioteca y lista de deseos. */
export function ProductActions({ slug, free }: { slug: string; free: boolean }) {
  const { user, ready } = useSession();
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const st = useAsync(() => (user ? api.ownership(slug) : Promise.resolve(null)), [user?.id, slug, tick]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setTick((t) => t + 1);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return null;
  if (!user) {
    return (
      <button className="btn primary" onClick={() => nav("/login")}>
        Iniciá sesión para {free ? "agregarlo" : "guardarlo"}
      </button>
    );
  }
  const s = st.data;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {s?.owned ? (
        <Link to="/library" className="btn primary">✓ En tu biblioteca</Link>
      ) : free ? (
        <button className="btn primary" disabled={busy || !s} onClick={() => void run(() => api.addToLibrary(slug), "Agregado a tu biblioteca.")}>
          Agregar a la biblioteca
        </button>
      ) : (
        <div className="alert info">Producto pago: las compras se habilitan en la etapa de pagos.</div>
      )}
      {s && !s.owned && (
        <button className="btn" disabled={busy} onClick={() => void run(() => api.wish(slug, !s.wishlisted), s.wishlisted ? "Quitado de deseados." : "Agregado a deseados.")}>
          {s.wishlisted ? "♥ En deseados (quitar)" : "♡ Agregar a deseados"}
        </button>
      )}
      {s?.owned && <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>Para descargarlo, instalarlo y jugar, abrí el launcher de AlphaShook (Windows y Linux) e iniciá sesión con esta cuenta.</p>}
      {msg && <div className={`alert ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}

const SOURCE = { free: "Gratis", purchase: "Compra", gift: "Regalo", grant: "Otorgado" } as const;

export function LibraryPage() {
  const { user, ready } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const cats = useAsync(() => api.categories(), []);
  const lib = useAsync(() => (user ? api.library(params) : Promise.resolve([])), [user?.id, params.toString()]);
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set("q", q.trim() || null);
  };
  const filtering = params.has("q") || params.has("category");

  return (
    <>
      <h1>Mi biblioteca</h1>
      <form className="toolbar" onSubmit={submit}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tu biblioteca" aria-label="Buscar" />
        <select value={params.get("category") ?? ""} onChange={(e) => set("category", e.target.value || null)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <button className="btn primary">Buscar</button>
      </form>

      {lib.loading ? (
        <div className="skeleton" />
      ) : lib.error ? (
        <ErrorBox error={lib.error} />
      ) : !lib.data?.length ? (
        <div className="empty">
          {filtering ? "No hay productos que coincidan." : <>Tu biblioteca está vacía. <Link to="/catalog" className="muted">Explorá el catálogo</Link></>}
        </div>
      ) : (
        <div className="lib-list">
          {lib.data.map((it) => (
            <Link key={it.product.slug} to={`/p/${it.product.slug}`} className="card lib-item">
              <div className="lib-cover"><Cover url={it.product.coverUrl} name={it.product.name} /></div>
              <div className="lib-info">
                <strong>{it.product.name}</strong>
                <span className="muted">{it.product.developer.name}{it.categories.length ? ` · ${it.categories.map((c) => c.name).join(", ")}` : ""}</span>
                <span className="muted" style={{ fontSize: "0.88rem" }}>
                  {SOURCE[it.source]} · {new Date(it.acquiredAt).toLocaleDateString("es-AR")}
                </span>
              </div>
              <div className="lib-versions">
                {it.latestReleases.length ? (
                  it.latestReleases.map((r) => (
                    <span key={r.platform} className="chip">{PLATFORM_LABEL[r.platform]} {r.version} · {formatBytes(r.sizeBytes)}</span>
                  ))
                ) : (
                  <span className="muted">Sin versiones publicadas</span>
                )}
                <span className="muted" style={{ fontSize: "0.85rem" }}>Instalación: desde el launcher</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function WishlistPage() {
  const { user, ready } = useSession();
  const list = useAsync(() => (user ? api.wishlist() : Promise.resolve([])), [user?.id]);
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <h1>Deseados</h1>
      {list.loading ? (
        <div className="skeleton" />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : (
        <ProductGrid items={(list.data ?? []).map((w) => w.product)} empty="Todavía no guardaste productos en deseados." />
      )}
    </>
  );
}
