import { Fragment, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, formatBytes, PLATFORM_LABEL } from "../api";
import { useAsync, useSession } from "../hooks";
import { ErrorBox, Price, ProductGrid } from "../components/ui";
import { ProductActions } from "./library";

export function HomePage() {
  const { identity } = useSession();
  const { data, error, loading } = useAsync(() => api.home(), []);
  if (loading) return <div className="skeleton" />;
  if (error || !data) return <ErrorBox error={error} />;
  const hero = data.featured[0];

  return (
    <>
      {hero ? (
        <Link to={`/p/${hero.slug}`} className="card hero">
          <div className="art">{hero.coverUrl ? <img src={hero.coverUrl} alt="" /> : null}</div>
          <div className="info">
            <span className="kicker">Destacado</span>
            <h1>{hero.name}</h1>
            <p className="muted">{hero.shortDescription}</p>
            <div><Price cents={hero.priceCents} currency={hero.currency} /></div>
          </div>
        </Link>
      ) : (
        <div className="card welcome">
          <h1>{identity?.name}</h1>
          <p className="muted">Juegos y aplicaciones, en una sola cuenta para la web, el launcher y Android.</p>
          <div><Link to="/catalog" className="btn primary">Explorar catálogo</Link></div>
        </div>
      )}

      {data.featured.length > 1 && (
        <section className="section">
          <div className="section-head"><h2>Destacados</h2></div>
          <ProductGrid items={data.featured.slice(1)} empty={null} />
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Lanzamientos recientes</h2>
          <Link to="/catalog">Ver todo</Link>
        </div>
        <ProductGrid items={data.recent} empty="Todavía no hay productos publicados." />
      </section>

      <section className="section">
        <div className="section-head"><h2>Categorías</h2></div>
        <div className="chips">
          {data.categories.map((c) => (
            <Link key={c.slug} className="chip" to={`/catalog?category=${c.slug}`}>{c.name}</Link>
          ))}
        </div>
      </section>
    </>
  );
}

const PAGE = 24;

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const offset = Number(params.get("offset") ?? 0);
  const key = params.toString();
  const cats = useAsync(() => api.categories(), []);
  const page = useAsync(() => {
    const p = new URLSearchParams(params);
    p.set("limit", String(PAGE));
    return api.products(p);
  }, [key]);

  const update = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? p.set(k, v) : p.delete(k);
    if (!("offset" in changes)) p.delete("offset");
    setParams(p);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update({ q: q.trim() || null });
  };

  return (
    <>
      <h1>Catálogo</h1>
      <form className="toolbar" onSubmit={submit}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar" />
        <select value={params.get("type") ?? ""} onChange={(e) => update({ type: e.target.value || null })} aria-label="Tipo">
          <option value="">Juegos y apps</option>
          <option value="game">Juegos</option>
          <option value="app">Aplicaciones</option>
        </select>
        <select value={params.get("sort") ?? "recent"} onChange={(e) => update({ sort: e.target.value })} aria-label="Orden">
          <option value="recent">Más recientes</option>
          <option value="name">Nombre (A–Z)</option>
          <option value="price_asc">Precio: menor a mayor</option>
          <option value="price_desc">Precio: mayor a menor</option>
        </select>
        <button className="btn primary">Buscar</button>
      </form>
      <div className="chips" style={{ marginBottom: 20 }}>
        <button className={`chip${!params.get("category") ? " active" : ""}`} onClick={() => update({ category: null })}>Todas</button>
        {cats.data?.map((c) => (
          <button key={c.slug} className={`chip${params.get("category") === c.slug ? " active" : ""}`} onClick={() => update({ category: c.slug })}>
            {c.name}
          </button>
        ))}
      </div>

      {page.loading ? (
        <div className="skeleton" />
      ) : page.error || !page.data ? (
        <ErrorBox error={page.error} />
      ) : (
        <>
          <p className="muted">{page.data.total} resultado{page.data.total === 1 ? "" : "s"}</p>
          <ProductGrid items={page.data.items} empty="No se encontraron productos con esos filtros." />
          {page.data.total > PAGE && (
            <div className="pager">
              <button className="btn small" disabled={offset === 0} onClick={() => update({ offset: String(Math.max(0, offset - PAGE)) })}>Anterior</button>
              <span className="muted">{Math.floor(offset / PAGE) + 1} / {Math.ceil(page.data.total / PAGE)}</span>
              <button className="btn small" disabled={offset + PAGE >= page.data.total} onClick={() => update({ offset: String(offset + PAGE) })}>Siguiente</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

const LEVEL = { minimum: "Mínimos", recommended: "Recomendados" } as const;
const SPEC_LABEL = { os: "Sistema", cpu: "Procesador", ram: "Memoria", gpu: "Gráficos", storage: "Almacenamiento", notes: "Notas" } as const;

export function ProductPage() {
  const { slug = "" } = useParams();
  const { data: p, error, loading } = useAsync(() => api.product(slug), [slug]);
  const [active, setActive] = useState(0);
  if (loading) return <div className="skeleton" />;
  if (error || !p) return <div className="empty">Este producto no existe o no está disponible. <Link to="/catalog" className="muted">Volver al catálogo</Link></div>;

  const media = p.media.length ? p.media : p.coverUrl ? [{ kind: "image" as const, url: p.coverUrl }] : [];
  const current = media[active];
  const latestSize = p.latestReleases[0]?.sizeBytes;

  return (
    <div className="product">
      <div>
        <h1>{p.name}</h1>
        <p className="muted">{p.shortDescription}</p>
        {current ? (
          <>
            <div className="gallery-main">
              {current.kind === "video" ? <video src={current.url} controls /> : <img src={current.url} alt={`Imagen de ${p.name}`} />}
            </div>
            {media.length > 1 && (
              <div className="thumbs">
                {media.map((m, i) => (
                  <button key={m.url} className={i === active ? "active" : ""} onClick={() => setActive(i)} aria-label={`Imagen ${i + 1}`}>
                    {m.kind === "image" ? <img src={m.url} alt="" /> : <span className="muted">▶</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        <section className="section">
          <h2>Acerca de</h2>
          <div className="desc">{p.description}</div>
          {p.tags.length > 0 && <div className="chips" style={{ marginTop: 14 }}>{p.tags.map((t) => <span key={t.slug} className="chip">{t.name}</span>)}</div>}
        </section>

        {p.requirements.length > 0 && (
          <section className="section">
            <h2>Requisitos del sistema</h2>
            <div className="reqs">
              {p.requirements.map((r) => (
                <div key={r.platform + r.level} className="card">
                  <h4>{PLATFORM_LABEL[r.platform]} · {LEVEL[r.level]}</h4>
                  <dl className="kv">
                    {(Object.keys(SPEC_LABEL) as (keyof typeof SPEC_LABEL)[]).filter((k) => r.specs[k]).map((k) => (
                      <Fragment key={k}><dt>{SPEC_LABEL[k]}</dt><dd>{r.specs[k]}</dd></Fragment>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )}

        {p.releases.length > 0 && (
          <section className="section">
            <h2>Versiones</h2>
            <table className="versions">
              <thead><tr><th>Versión</th><th>Plataforma</th><th>Tamaño</th><th>Fecha</th></tr></thead>
              <tbody>
                {p.releases.map((r) => (
                  <tr key={r.platform + r.version}>
                    <td>{r.version}</td><td>{PLATFORM_LABEL[r.platform]}</td><td>{formatBytes(r.sizeBytes)}</td>
                    <td>{new Date(r.publishedAt).toLocaleDateString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <aside className="card side">
        <div className="big-price"><Price cents={p.priceCents} currency={p.currency} /></div>
        <ProductActions slug={p.slug} free={p.priceCents === 0} />
        <dl className="kv">
          <dt>Desarrollador</dt><dd>{p.developer.name}</dd>
          <dt>Editor</dt><dd>{p.publisher.name}</dd>
          {p.releaseDate && <><dt>Lanzamiento</dt><dd>{new Date(p.releaseDate + "T00:00:00").toLocaleDateString("es-AR")}</dd></>}
          {p.latestReleases.map((r) => <Fragment key={r.platform}><dt>Versión ({PLATFORM_LABEL[r.platform]})</dt><dd>{r.version}</dd></Fragment>)}
          {latestSize !== undefined && <><dt>Tamaño</dt><dd>{formatBytes(latestSize)}</dd></>}
          {p.platforms.length > 0 && <><dt>Plataformas</dt><dd>{p.platforms.map((x) => PLATFORM_LABEL[x]).join(", ")}</dd></>}
          {p.categories.length > 0 && <><dt>Categorías</dt><dd>{p.categories.map((c) => c.name).join(", ")}</dd></>}
        </dl>
      </aside>
    </div>
  );
}
