import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  alpha, bytes, call, eta, msg, price,
  type CatalogPage, type GamesState, type HomeData, type Job, type LibraryItem, type ProductDetail, type PublicUser, type Settings, type StoreIdentity,
} from "./bridge";

type Page = { name: "store" } | { name: "product"; slug: string } | { name: "library" } | { name: "downloads" } | { name: "settings" };

/** Ejecuta una acción mostrando errores en un aviso. */
function useAction() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(msg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, busy, run, setError };
}

export function App() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string>();
  const [update, setUpdate] = useState<string | null>(null);
  const [identity, setIdentity] = useState<StoreIdentity>({ name: "AlphaShook", logoUrl: null });
  const [page, setPage] = useState<Page>({ name: "store" });
  const [games, setGames] = useState<GamesState>({ installs: {}, jobs: [], platform: "windows", libraryDir: "" });

  useEffect(() => {
    call(alpha().me()).then((u) => setUser(u ?? null), (e) => { setBootError(msg(e)); setUser(null); });
    call(alpha().api<StoreIdentity>("GET", "/store/identity")).then(setIdentity, () => undefined);
    call(alpha().state()).then(setGames, () => undefined);
    const off1 = alpha().onState(setGames);
    const off2 = alpha().onAuthExpired(() => setUser(null));
    const off3 = alpha().onUpdate(setUpdate);
    call(alpha().updateReady()).then(setUpdate, () => undefined);
    return () => { off1(); off2(); off3(); };
  }, []);

  if (user === undefined) return <Splash name={identity.name} />;
  if (!user) return <Login identity={identity} onLogin={setUser} initialError={bootError} />;

  const active = games.jobs.filter((j) => j.status !== "error" && j.status !== "paused").length;
  const nav = (p: Page, label: string, badge?: number) => (
    <button className={`nav-item ${page.name === p.name ? "active" : ""}`} onClick={() => setPage(p)}>
      {label} {badge ? <span className="pill">{badge}</span> : null}
    </button>
  );
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          {identity.logoUrl ? <img src={identity.logoUrl} alt="" /> : <div className="brand-mark">{identity.name[0]}</div>}
          <span>{identity.name}</span>
        </div>
        <nav>
          {nav({ name: "store" }, "Tienda")}
          {nav({ name: "library" }, "Biblioteca")}
          {nav({ name: "downloads" }, "Descargas", active || games.jobs.length)}
          {nav({ name: "settings" }, "Ajustes")}
        </nav>
        <div className="side-user">
          <div className="avatar">{user.username[0]?.toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ellipsis"><b>{user.username}</b></div>
            <button className="link" onClick={() => void call(alpha().logout()).finally(() => setUser(null))}>Cerrar sesión</button>
          </div>
        </div>
      </aside>
      <main className="main">
        {update && (
          <div className="alert ok row between">
            <span>Hay una versión nueva del launcher (v{update}). Se instala sola al cerrarlo, o ahora:</span>
            <button className="btn primary" onClick={() => void call(alpha().restartToUpdate())}>Reiniciar y actualizar</button>
          </div>
        )}
        {page.name === "store" && <Store open={(slug) => setPage({ name: "product", slug })} />}
        {page.name === "product" && <Product slug={page.slug} games={games} back={() => setPage({ name: "store" })} goLibrary={() => setPage({ name: "library" })} />}
        {page.name === "library" && <Library games={games} open={(slug) => setPage({ name: "product", slug })} goDownloads={() => setPage({ name: "downloads" })} />}
        {page.name === "downloads" && <Downloads jobs={games.jobs} />}
        {page.name === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function Splash({ name }: { name: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="splash">
      <div style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center" }}>
        <div className="brand-mark big">{name[0]}</div>
        {slow && <p className="muted">Conectando con el servidor…<br />Si estuvo inactivo, puede tardar hasta 1 minuto en despertar.</p>}
      </div>
    </div>
  );
}

// ───────────── Inicio de sesión ─────────────
function Login({ identity, onLogin, initialError }: { identity: StoreIdentity; onLogin: (u: PublicUser) => void; initialError?: string | undefined }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const u = await a.run(() => call(alpha().login(id, pw)));
    if (u) onLogin(u);
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={(e) => void submit(e)}>
        <div className="brand center"><div className="brand-mark big">{identity.name[0]}</div></div>
        <h1>Iniciar sesión</h1>
        <p className="muted">Usá tu cuenta de {identity.name}. Es la misma de la tienda web.</p>
        {(a.error ?? initialError) && <div className="alert error">{a.error ?? initialError}</div>}
        <label>Correo o usuario<input name="identifier" value={id} onChange={(e) => setId(e.target.value)} required autoFocus /></label>
        <label>Contraseña<input name="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <button className="btn primary" disabled={a.busy}>{a.busy ? "Entrando…" : "Entrar"}</button>
        <p className="muted small">¿No tenés cuenta? Creala en la tienda web y volvé.</p>
      </form>
    </div>
  );
}

// ───────────── Tienda ─────────────
function Cover({ url, name }: { url: string | null; name: string }) {
  return url ? <img className="cover" src={url} alt="" loading="lazy" /> : <div className="cover placeholder">{name[0]}</div>;
}

function Store({ open }: { open: (slug: string) => void }) {
  const [home, setHome] = useState<HomeData>();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogPage>();
  const a = useAction();
  useEffect(() => { void a.run(() => call(alpha().api<HomeData>("GET", "/home")).then(setHome)); }, [a.run]);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return setResults(undefined);
    await a.run(() => call(alpha().api<CatalogPage>("GET", `/products?q=${encodeURIComponent(q.trim())}&limit=48`)).then(setResults));
  };
  const grid = (items: HomeData["recent"]) => (
    <div className="grid">
      {items.map((p) => (
        <button key={p.slug} className="card product" onClick={() => open(p.slug)}>
          <Cover url={p.coverUrl} name={p.name} />
          <div className="product-body">
            <b className="ellipsis">{p.name}</b>
            <span className="muted small ellipsis">{p.developer.name}</span>
            <span className="price">{price(p.priceCents, p.currency)}</span>
          </div>
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div className="page-head">
        <h1>Tienda</h1>
        <form onSubmit={(e) => void search(e)} className="search"><input placeholder="Buscar juegos y apps…" value={q} onChange={(e) => setQ(e.target.value)} /></form>
      </div>
      {a.error && <div className="alert error">{a.error}</div>}
      {results ? (
        <>
          <h2>Resultados ({results.total}) <button className="link" onClick={() => { setResults(undefined); setQ(""); }}>limpiar</button></h2>
          {results.items.length ? grid(results.items) : <p className="muted">No hay resultados.</p>}
        </>
      ) : !home ? <div className="skeleton" /> : (
        <>
          {home.featured.length > 0 && <><h2>Destacados</h2>{grid(home.featured)}</>}
          <h2>Lanzamientos recientes</h2>
          {home.recent.length ? grid(home.recent) : <p className="muted">Todavía no hay productos publicados.</p>}
        </>
      )}
    </>
  );
}

function Product({ slug, games, back, goLibrary }: { slug: string; games: GamesState; back: () => void; goLibrary: () => void }) {
  const [p, setP] = useState<ProductDetail>();
  const [owned, setOwned] = useState<boolean>();
  const a = useAction();
  useEffect(() => {
    void a.run(async () => {
      setP(await call(alpha().api<ProductDetail>("GET", `/products/${slug}`)));
      setOwned((await call(alpha().api<{ owned: boolean }>("GET", `/me/products/${slug}`))).owned);
    });
  }, [slug, a.run]);
  if (!p) return a.error ? <div className="alert error">{a.error}</div> : <div className="skeleton" />;
  const rel = p.latestReleases.find((r) => r.platform === games.platform);
  const add = () => a.run(async () => {
    await call(alpha().api("POST", `/library/${slug}`));
    setOwned(true);
  });
  return (
    <>
      <button className="link" onClick={back}>← Tienda</button>
      <div className="detail">
        <Cover url={p.coverUrl} name={p.name} />
        <div>
          <h1>{p.name}</h1>
          <p className="muted">{p.developer.name} · {p.platforms.map((x) => x[0]!.toUpperCase() + x.slice(1)).join(", ")}</p>
          <p>{p.shortDescription}</p>
          {a.error && <div className="alert error">{a.error}</div>}
          <div className="row">
            <span className="price big">{price(p.priceCents, p.currency)}</span>
            {owned ? (
              <button className="btn primary" onClick={goLibrary}>En tu biblioteca → Ir</button>
            ) : p.priceCents === 0 ? (
              <button className="btn primary" disabled={a.busy} onClick={() => void add()}>Agregar a la biblioteca</button>
            ) : (
              <button className="btn" disabled>Compras: próximamente</button>
            )}
          </div>
          <p className="muted small">{rel ? `Versión ${rel.version} para tu sistema · ${bytes(rel.sizeBytes)}` : "Sin versión para tu sistema todavía."}</p>
        </div>
      </div>
      <h2>Descripción</h2>
      <p className="pre">{p.description}</p>
      {p.requirements.filter((r) => r.platform === games.platform).map((r) => (
        <div key={r.level} className="card pad">
          <b>Requisitos {r.level === "minimum" ? "mínimos" : "recomendados"}</b>
          <ul>{Object.entries(r.specs).filter(([, v]) => v).map(([k, v]) => <li key={k}><span className="muted">{k.toUpperCase()}:</span> {v}</li>)}</ul>
        </div>
      ))}
    </>
  );
}

// ───────────── Biblioteca ─────────────
function Library({ games, open, goDownloads }: { games: GamesState; open: (slug: string) => void; goDownloads: () => void }) {
  const [items, setItems] = useState<LibraryItem[]>();
  const [updates, setUpdates] = useState<Record<string, { version: string; sizeBytes: number } | null>>({});
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string>();
  const a = useAction();
  const installedCount = Object.keys(games.installs).length;
  useEffect(() => { void a.run(() => call(alpha().api<LibraryItem[]>("GET", "/library")).then(setItems)); }, [a.run]);
  useEffect(() => { void call(alpha().checkUpdates()).then(setUpdates, () => undefined); }, [installedCount]);

  const act = (fn: () => Promise<unknown>, after?: () => void) => a.run(async () => { await fn(); after?.(); });
  const card = (it: LibraryItem) => {
    const p = it.product;
    const inst = games.installs[p.slug];
    const job = games.jobs.find((j) => j.slug === p.slug);
    const up = inst && updates[p.slug] && updates[p.slug]!.version !== inst.version ? updates[p.slug] : null;
    const supported = p.platforms.includes(games.platform);
    return (
      <div key={p.slug} className="card lib-row">
        <button className="lib-cover" onClick={() => open(p.slug)}><Cover url={p.coverUrl} name={p.name} /></button>
        <div className="lib-info">
          <b className="ellipsis">{p.name}</b>
          <span className="muted small">
            {inst ? `Instalado · v${inst.version}` : job ? statusLabel(job) : supported ? "No instalado" : "No disponible para tu sistema"}
            {up && <> · <span className="accent">Actualización v{up.version} ({bytes(up.sizeBytes)})</span></>}
          </span>
          {job && <Progress job={job} />}
        </div>
        <div className="lib-actions">
          {job ? (
            <button className="btn" onClick={goDownloads}>Ver descarga</button>
          ) : inst ? (
            <>
              {up && <button className="btn" disabled={a.busy} onClick={() => void act(() => call(alpha().update(p.slug)))}>Actualizar</button>}
              <button className="btn primary" disabled={a.busy} onClick={() => void act(() => call(alpha().launch(p.slug)), () => setNotice(`Abriendo ${p.name}…`))}>Jugar</button>
              <Menu>
                <button onClick={() => void call(alpha().openDir(p.slug))}>Abrir carpeta</button>
                <button className="danger" onClick={() => {
                  if (!window.confirm(`¿Desinstalar ${p.name}? Sigue en tu biblioteca y podés reinstalarlo cuando quieras.`)) return;
                  void act(async () => {
                    const r = await call(alpha().uninstall(p.slug));
                    setNotice(r.kept ? `Desinstalado. Se conservaron ${r.kept} archivo(s) creados por el juego (partidas/config) en ${r.dir}.` : "Desinstalado.");
                  });
                }}>Desinstalar</button>
              </Menu>
            </>
          ) : supported ? (
            <button className="btn primary" disabled={a.busy} onClick={() => void act(() => call(alpha().install(p.slug)), goDownloads)}>Instalar</button>
          ) : null}
        </div>
      </div>
    );
  };
  const list = items?.filter((i) => i.product.name.toLowerCase().includes(q.toLowerCase())) ?? [];
  return (
    <>
      <div className="page-head">
        <h1>Biblioteca</h1>
        <div className="search"><input placeholder="Buscar en tu biblioteca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      {a.error && <div className="alert error">{a.error}</div>}
      {!items ? <div className="skeleton" /> : list.length ? <div className="stack">{list.map(card)}</div> : <p className="muted">{items.length ? "Sin resultados." : "Tu biblioteca está vacía. Agregá juegos gratis desde la Tienda."}</p>}
    </>
  );
}

function Menu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn icon" aria-label="Más opciones" onClick={() => setOpen(!open)}>⋯</button>
      {open && <div className="menu-list" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

// ───────────── Descargas ─────────────
const statusLabel = (j: Job) => ({
  queued: "En cola",
  downloading: `Descargando ${Math.floor((j.received / j.sizeBytes) * 100)}%`,
  paused: "En pausa",
  verifying: "Verificando integridad…",
  installing: `Instalando ${j.installPct}%`,
  error: "Error",
})[j.status];

function Progress({ job }: { job: Job }) {
  const pct = job.status === "installing" ? job.installPct : Math.floor((job.received / Math.max(job.sizeBytes, 1)) * 100);
  return <div className={`bar ${job.status}`}><div style={{ width: `${pct}%` }} /></div>;
}

function Downloads({ jobs }: { jobs: Job[] }) {
  const a = useAction();
  return (
    <>
      <div className="page-head"><h1>Descargas</h1></div>
      {a.error && <div className="alert error">{a.error}</div>}
      {!jobs.length && <p className="muted">No hay descargas. Instalá algo desde tu Biblioteca.</p>}
      <div className="stack">
        {jobs.map((j) => (
          <div key={j.slug} className="card pad dl">
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <b>{j.name}</b> <span className="muted small">v{j.version} · {j.kind === "update" ? "actualización" : "instalación"}</span>
                <div className="muted small">
                  {statusLabel(j)} · {bytes(j.received)} de {bytes(j.sizeBytes)}
                  {j.status === "downloading" && <> · {bytes(j.speed)}/s · faltan {eta(j.etaSec)}</>}
                </div>
              </div>
              <div className="row">
                {(j.status === "downloading" || j.status === "queued") && <button className="btn" onClick={() => void a.run(() => call(alpha().pause(j.slug)))}>Pausar</button>}
                {j.status === "paused" && <button className="btn primary" onClick={() => void a.run(() => call(alpha().resume(j.slug)))}>Reanudar</button>}
                {j.status === "error" && <button className="btn primary" onClick={() => void a.run(() => call(alpha().resume(j.slug)))}>Reintentar</button>}
                {j.status !== "verifying" && j.status !== "installing" && (
                  <button className="btn danger" onClick={() => window.confirm("¿Cancelar la descarga? Se borra lo descargado.") && void a.run(() => call(alpha().cancel(j.slug)))}>Cancelar</button>
                )}
              </div>
            </div>
            <Progress job={j} />
            {j.error && <div className="alert error small">{j.error}</div>}
          </div>
        ))}
      </div>
      <p className="muted small">Si cerrás el launcher, las descargas quedan en pausa y continúan desde donde quedaron.</p>
    </>
  );
}

// ───────────── Ajustes ─────────────
function SettingsPage() {
  const [s, setS] = useState<Settings>();
  const [api, setApi] = useState("");
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const load = useCallback(() => call(alpha().settings()).then((x) => { setS(x); setApi(x.apiUrl); }), []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return <div className="skeleton" />;
  const save = (patch: Parameters<typeof window.alpha.setSettings>[0]) =>
    a.run(async () => { await call(alpha().setSettings(patch)); await load(); setSaved(true); });
  return (
    <>
      <div className="page-head"><h1>Ajustes</h1></div>
      {a.error && <div className="alert error">{a.error}</div>}
      {saved && <div className="alert ok">Guardado.</div>}
      <div className="card pad stack">
        <div>
          <b>Carpeta de instalación</b>
          <p className="muted small">Los juegos nuevos se instalan acá (cada uno en su propia subcarpeta). Los ya instalados no se mueven.</p>
          <div className="row"><code className="ellipsis">{s.libraryDir}</code>
            <button className="btn" onClick={() => void a.run(async () => { const d = await call(alpha().pickDir()); if (d) await save({ libraryDir: d }); })}>Cambiar…</button>
          </div>
        </div>
        <div>
          <b>Servidor</b>
          <p className="muted small">Dejalo como está salvo que estés probando una tienda local (ej. http://localhost:3000).</p>
          <div className="row"><input value={api} onChange={(e) => setApi(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" onClick={() => void save({ apiUrl: api })}>Guardar</button></div>
        </div>
        <p className="muted small">AlphaShook Launcher v{s.version} · {s.platform === "windows" ? "Windows" : "Linux"}</p>
      </div>
    </>
  );
}
