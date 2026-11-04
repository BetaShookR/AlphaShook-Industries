import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import type { ForumPost, MyProfile, Review, ReviewPage, UserRef } from "@alphashook/shared";
import { api, ApiError, errorMessage } from "../api";
import { useAsync, useSession } from "../hooks";
import { Cover, ErrorBox, fieldErrors } from "../components/ui";

const date = (s: string) => new Date(s).toLocaleDateString("es-AR");
const dateTime = (s: string) => new Date(s).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const useIsMod = () => {
  const { user } = useSession();
  return user?.role === "moderator" || user?.role === "admin";
};

export function UserLink({ u }: { u: UserRef }) {
  return <Link to={`/u/${u.username}`}>{u.displayName ? `${u.displayName} (@${u.username})` : u.username}</Link>;
}

export function Stars({ n }: { n: number }) {
  return <span className="stars" aria-label={`${n} de 5 estrellas`}>{"★".repeat(Math.round(n))}{"☆".repeat(5 - Math.round(n))}</span>;
}

/** Pequeño formulario de texto reutilizado por reseñas, hilos y respuestas. */
function useForm() {
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

// ───────────── Reseñas (en la página del producto) ─────────────
export function ReviewsSection({ slug }: { slug: string }) {
  const { user } = useSession();
  const isMod = useIsMod();
  const [tick, setTick] = useState(0);
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAsync(() => api.reviews(slug, offset), [slug, offset, tick, user?.id]);
  const reload = () => setTick((t) => t + 1);

  return (
    <section className="section" id="reviews">
      <div className="section-head"><h2>Reseñas</h2></div>
      {loading && !data ? <div className="skeleton" /> : error || !data ? <ErrorBox error={error} /> : (
        <div className="stack">
          <Summary page={data} />
          {user ? (
            data.canReview ? <ReviewForm slug={slug} mine={data.mine} onSaved={reload} />
              : <div className="alert info">Solo podés reseñar productos que estén en tu biblioteca.</div>
          ) : (
            <div className="muted"><Link to="/login" style={{ color: "var(--accent-2)" }}>Iniciá sesión</Link> para escribir una reseña.</div>
          )}
          {data.items.length === 0 ? <div className="empty">Todavía no hay reseñas.</div> : data.items.map((r) => (
            <ReviewCard key={r.id} r={r} isMod={isMod} onChange={reload} />
          ))}
          {data.total > 20 && (
            <div className="pager">
              <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Anteriores</button>
              <button className="btn small" disabled={offset + 20 >= data.total} onClick={() => setOffset(offset + 20)}>Siguientes</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Summary({ page }: { page: ReviewPage }) {
  const { count, average, distribution } = page.summary;
  if (!count) return null;
  const max = Math.max(...distribution, 1);
  return (
    <div className="card rating-summary">
      <div>
        <div className="avg">{average?.toFixed(1)}</div>
        <Stars n={average ?? 0} />
        <div className="muted" style={{ fontSize: "0.85rem", textAlign: "center" }}>{count} {count === 1 ? "reseña" : "reseñas"}</div>
      </div>
      <div className="bars">
        {[5, 4, 3, 2, 1].map((s) => (
          <div className="row" key={s}>
            <span>{s}★</span>
            <div className="bar"><span style={{ width: `${(distribution[s - 1]! / max) * 100}%` }} /></div>
            <span>{distribution[s - 1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewForm({ slug, mine, onSaved }: { slug: string; mine: Review | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(!mine);
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const f = useForm();

  if (mine && !editing) {
    return (
      <div className="card post">
        <div className="post-head"><strong>Tu reseña</strong><Stars n={mine.rating} /></div>
        <div className="post-body">{mine.body}</div>
        <div className="row-actions">
          <button className="btn small" onClick={() => setEditing(true)}>Editar</button>
          <button className="btn small danger" disabled={f.busy}
            onClick={() => void f.run(() => api.deleteReview(slug)).then((ok) => ok && onSaved())}>Borrar</button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return;
    if (await f.run(() => api.saveReview(slug, rating, body))) {
      setEditing(false);
      onSaved();
    }
  };
  return (
    <form className="card post" onSubmit={(e) => void submit(e)}>
      <strong>{mine ? "Editar tu reseña" : "Escribí tu reseña"}</strong>
      <div className="star-input" role="radiogroup" aria-label="Valoración">
        {[1, 2, 3, 4, 5].map((s) => (
          <button type="button" key={s} className={s <= rating ? "on" : ""} aria-label={`${s} estrellas`} aria-checked={s === rating} role="radio"
            onClick={() => setRating(s)}>★</button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="¿Qué te pareció? (mínimo 10 caracteres)" aria-label="Reseña" required />
      {f.fe.body && <span className="err" style={{ color: "var(--danger)" }}>{f.fe.body}</span>}
      {f.error !== undefined && !f.fe.body ? <ErrorBox error={f.error} /> : null}
      <div className="row-actions">
        <button className="btn primary small" disabled={f.busy || !rating}>Publicar</button>
        {mine && <button type="button" className="btn small" onClick={() => setEditing(false)}>Cancelar</button>}
      </div>
    </form>
  );
}

function ReviewCard({ r, isMod, onChange }: { r: Review; isMod: boolean; onChange: () => void }) {
  return (
    <article className="card post">
      <div className="post-head">
        <span><UserLink u={r.user} /> · {date(r.updatedAt)}</span>
        <Stars n={r.rating} />
      </div>
      <div className="post-body">{r.body}</div>
      {isMod && (
        <div className="row-actions">
          <button className="btn small danger" onClick={() => void api.moderate("reviews", r.id, { hidden: true }).then(onChange)}>Ocultar (moderación)</button>
        </div>
      )}
    </article>
  );
}

// ───────────── Foros ─────────────
export function ForumsPage() {
  const { data, error, loading } = useAsync(() => api.boards(), []);
  if (loading) return <div className="skeleton" />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div>
      <h1>Comunidad</h1>
      <p className="muted">Foros de discusión generales y de cada juego.</p>
      <div className="stack">
        {data.map((b) => (
          <Link key={b.product?.slug ?? "general"} to={`/community/${b.product?.slug ?? "general"}`} className="card list-row">
            <span className="title">{b.product ? b.product.name : "General"}</span>
            <span className="muted">{b.threadCount} {b.threadCount === 1 ? "tema" : "temas"}{b.lastPostAt && ` · último ${date(b.lastPostAt)}`}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BoardPage() {
  const { board = "general" } = useParams();
  const { user } = useSession();
  const nav = useNavigate();
  const [offset, setOffset] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const f = useForm();
  const list = useAsync(() => api.threads(board, offset), [board, offset, user?.id]);
  const boards = useAsync(() => api.boards(), []);
  const boardName = board === "general" ? "General" : boards.data?.find((b) => b.product?.slug === board)?.product?.name ?? board;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let id = "";
    if (await f.run(async () => (id = (await api.createThread({ product: board === "general" ? null : board, title, body })).id))) nav(`/community/t/${id}`);
  };

  if (list.error) return <div className="empty">{errorMessage(list.error)} <Link to="/community" className="muted">Volver a la comunidad</Link></div>;
  return (
    <div>
      <p className="muted"><Link to="/community">Comunidad</Link> › {boardName}</p>
      <div className="section-head">
        <h1 style={{ margin: 0 }}>{boardName}</h1>
        {user ? <button className="btn primary small" onClick={() => setShowNew((v) => !v)}>Nuevo tema</button>
          : <Link to="/login" className="btn small">Iniciá sesión para participar</Link>}
      </div>
      {showNew && (
        <form className="card post" onSubmit={(e) => void submit(e)} style={{ marginBottom: 16 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" maxLength={120} aria-label="Título" required />
          {f.fe.title && <span style={{ color: "var(--danger)" }}>{f.fe.title}</span>}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensaje" maxLength={8000} aria-label="Mensaje" required />
          {f.fe.body && <span style={{ color: "var(--danger)" }}>{f.fe.body}</span>}
          {f.error !== undefined && !f.fe.title && !f.fe.body ? <ErrorBox error={f.error} /> : null}
          <div className="row-actions"><button className="btn primary small" disabled={f.busy}>Publicar tema</button></div>
        </form>
      )}
      {list.loading && !list.data ? <div className="skeleton" /> : !list.data?.items.length ? <div className="empty">Todavía no hay temas.</div> : (
        <div className="stack">
          {list.data.items.map((t) => (
            <Link key={t.id} to={`/community/t/${t.id}`} className="card list-row">
              <span>
                <span className="title">{t.locked && "🔒 "}{t.title}</span>
                {t.hidden && <span className="badge warn">Oculto</span>}
                <div className="muted" style={{ fontSize: "0.85rem" }}>por {t.author.displayName ?? t.author.username} · {date(t.createdAt)}</div>
              </span>
              <span className="muted">{t.postCount} {t.postCount === 1 ? "mensaje" : "mensajes"} · {dateTime(t.lastPostAt)}</span>
            </Link>
          ))}
        </div>
      )}
      {list.data && list.data.total > 30 && (
        <div className="pager">
          <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Anteriores</button>
          <button className="btn small" disabled={offset + 30 >= list.data.total} onClick={() => setOffset(offset + 30)}>Siguientes</button>
        </div>
      )}
    </div>
  );
}

export function ThreadPage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const isMod = useIsMod();
  const [tick, setTick] = useState(0);
  const [offset, setOffset] = useState(0);
  const [body, setBody] = useState("");
  const f = useForm();
  const { data, error, loading } = useAsync(() => api.thread(id, offset), [id, offset, tick, user?.id]);
  const reload = () => setTick((t) => t + 1);

  if (loading && !data) return <div className="skeleton" />;
  if (error || !data) return <div className="empty">Este tema no existe. <Link to="/community" className="muted">Volver a la comunidad</Link></div>;
  const t = data.thread;
  const boardSlug = t.product?.slug ?? "general";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await f.run(() => api.reply(id, body))) {
      setBody("");
      // Ir a la última página para ver la respuesta.
      setOffset(Math.floor(data.total / 50) * 50);
      reload();
    }
  };
  const mod = (patch: { hidden?: boolean; locked?: boolean }) => void api.moderate("threads", id, patch).then(reload);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <p className="muted"><Link to="/community">Comunidad</Link> › <Link to={`/community/${boardSlug}`}>{t.product?.name ?? "General"}</Link></p>
      <h1>{t.locked && "🔒 "}{t.title}</h1>
      {isMod && (
        <div className="row-actions" style={{ marginBottom: 16 }}>
          <button className="btn small" onClick={() => mod({ locked: !t.locked })}>{t.locked ? "Abrir tema" : "Cerrar tema"}</button>
          <button className="btn small danger" onClick={() => mod({ hidden: !t.hidden })}>{t.hidden ? "Mostrar tema" : "Ocultar tema"}</button>
        </div>
      )}
      <div className="stack">
        {data.posts.map((p) => <PostCard key={p.id} p={p} mine={p.author.username === user?.username} isMod={isMod} locked={t.locked} onChange={reload} />)}
      </div>
      {data.total > 50 && (
        <div className="pager">
          <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anteriores</button>
          <button className="btn small" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Siguientes</button>
        </div>
      )}
      <div className="section" style={{ marginTop: 24 }}>
        {!user ? <div className="muted"><Link to="/login" style={{ color: "var(--accent-2)" }}>Iniciá sesión</Link> para responder.</div>
          : t.locked && !isMod ? <div className="alert info">Este tema está cerrado.</div> : (
            <form className="card post" onSubmit={(e) => void submit(e)}>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribí una respuesta" maxLength={8000} aria-label="Respuesta" required />
              {f.error !== undefined ? <ErrorBox error={f.error} /> : null}
              <div className="row-actions"><button className="btn primary small" disabled={f.busy}>Responder</button></div>
            </form>
          )}
      </div>
    </div>
  );
}

function PostCard({ p, mine, isMod, locked, onChange }: { p: ForumPost; mine: boolean; isMod: boolean; locked: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(p.body);
  const f = useForm();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await f.run(() => api.editPost(p.id, body))) {
      setEditing(false);
      onChange();
    }
  };
  return (
    <article className="card post">
      <div className="post-head">
        <span><UserLink u={p.author} /> · {dateTime(p.createdAt)}{p.editedAt && " · editado"}</span>
        {p.hidden && <span className="badge warn">Oculto por moderación</span>}
      </div>
      {editing ? (
        <form className="stack" onSubmit={(e) => void save(e)}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} aria-label="Editar mensaje" />
          {f.error !== undefined ? <ErrorBox error={f.error} /> : null}
          <div className="row-actions">
            <button className="btn primary small" disabled={f.busy}>Guardar</button>
            <button type="button" className="btn small" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="post-body">{p.hidden && !isMod ? <span className="muted">Este mensaje fue ocultado por moderación.</span> : p.body}</div>
      )}
      {!editing && ((mine && !p.hidden && !locked) || isMod) && (
        <div className="row-actions">
          {mine && !p.hidden && !locked && <button className="btn small" onClick={() => setEditing(true)}>Editar</button>}
          {isMod && <button className="btn small danger" onClick={() => void api.moderate("posts", p.id, { hidden: !p.hidden }).then(onChange)}>{p.hidden ? "Mostrar" : "Ocultar"}</button>}
        </div>
      )}
    </article>
  );
}

// ───────────── Perfiles ─────────────
const ROLE_LABEL = { user: null, developer: "Desarrollador", moderator: "Moderador", admin: "Administrador" } as const;

export function ProfilePage() {
  const { username = "" } = useParams();
  const { user } = useSession();
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<unknown>();
  const { data: p, error, loading } = useAsync(() => api.profile(username), [username, tick, user?.id]);
  if (loading && !p) return <div className="skeleton" />;
  if (error || !p) return <div className="empty">{error instanceof ApiError && error.status === 404 ? "Ese usuario no existe." : errorMessage(error)}</div>;

  const act = (fn: () => Promise<unknown>) => {
    setActionError(undefined);
    fn().then(() => setTick((t) => t + 1), setActionError);
  };
  const role = ROLE_LABEL[p.role];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="card profile-head">
        <div className="avatar">{(p.displayName ?? p.username)[0]!.toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0 }}>{p.displayName ?? p.username}{role && <span className="badge mod">{role}</span>}</h1>
          <div className="muted">@{p.username} · miembro desde {date(p.memberSince)} · {p.friendCount} {p.friendCount === 1 ? "amigo" : "amigos"}</div>
          {p.bio && <p className="post-body" style={{ marginBottom: 0 }}>{p.bio}</p>}
        </div>
        <div className="row-actions">
          {p.friendState === "self" && <Link to="/account" className="btn small">Editar perfil</Link>}
          {p.friendState === "none" && <button className="btn primary small" onClick={() => act(() => api.addFriend(p.username))}>Agregar amigo</button>}
          {p.friendState === "request_sent" && <button className="btn small" onClick={() => act(() => api.removeFriend(p.username))}>Cancelar solicitud</button>}
          {p.friendState === "request_received" && <>
            <button className="btn primary small" onClick={() => act(() => api.acceptFriend(p.username))}>Aceptar solicitud</button>
            <button className="btn small" onClick={() => act(() => api.removeFriend(p.username))}>Rechazar</button>
          </>}
          {p.friendState === "friends" && <button className="btn small danger" onClick={() => act(() => api.removeFriend(p.username))}>Eliminar amigo</button>}
        </div>
      </div>
      {actionError !== undefined && <div style={{ marginTop: 12 }}><ErrorBox error={actionError} /></div>}

      <section className="section">
        <div className="section-head"><h2>Biblioteca</h2></div>
        {p.library === null ? <div className="empty">{p.visibility === "friends" ? "Solo sus amigos pueden ver su biblioteca." : "Este perfil es privado."}</div>
          : p.library.length === 0 ? <div className="empty">Sin productos todavía.</div> : (
            <div className="mini-grid">
              {p.library.map((g) => <Link key={g.slug} to={`/p/${g.slug}`}><Cover url={g.coverUrl} name={g.name} />{g.name}</Link>)}
            </div>
          )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Reseñas recientes</h2></div>
        {p.reviews.length === 0 ? <div className="empty">Sin reseñas.</div> : (
          <div className="stack">
            {p.reviews.map((r) => (
              <article key={r.productSlug} className="card post">
                <div className="post-head"><Link to={`/p/${r.productSlug}`}>{r.productName}</Link><Stars n={r.rating} /></div>
                <div className="post-body">{r.body}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Edición del perfil público, usada en Mi cuenta. */
export function ProfileEditor() {
  const { user } = useSession();
  const { data } = useAsync(() => api.myProfile(), [user?.id]);
  if (!data) return <div className="skeleton" />;
  return <ProfileForm initial={data} username={user!.username} />;
}

function ProfileForm({ initial, username }: { initial: MyProfile; username: string }) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [visibility, setVisibility] = useState(initial.visibility);
  const [saved, setSaved] = useState(false);
  const f = useForm();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(await f.run(() => api.updateProfile({ displayName: displayName || null, bio: bio || null, visibility })));
  };
  return (
    <form className="form" style={{ marginTop: 0 }} onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="p-name">Nombre visible (opcional)</label>
        <input id="p-name" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-bio">Biografía (opcional)</label>
        <textarea id="p-bio" value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-vis">¿Quién puede ver tu biblioteca y biografía?</label>
        <select id="p-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as MyProfile["visibility"])}>
          <option value="public">Todos</option>
          <option value="friends">Solo amigos</option>
          <option value="private">Solo yo</option>
        </select>
      </div>
      {f.error !== undefined ? <ErrorBox error={f.error} /> : null}
      {saved && <div className="alert ok">Perfil guardado.</div>}
      <div className="row-actions">
        <button className="btn primary small" disabled={f.busy}>Guardar perfil</button>
        <Link to={`/u/${username}`} className="btn small">Ver mi perfil público</Link>
      </div>
    </form>
  );
}

// ───────────── Amigos ─────────────
export function FriendsPage() {
  const { user, ready } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [find, setFind] = useState(params.get("u") ?? "");
  const [actionError, setActionError] = useState<unknown>();
  const { data, error } = useAsync(() => (user ? api.friends() : Promise.resolve(null)), [user?.id, tick]);
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;

  const act = (fn: () => Promise<unknown>) => {
    setActionError(undefined);
    fn().then(() => setTick((t) => t + 1), setActionError);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    if (find.trim()) nav(`/u/${encodeURIComponent(find.trim())}`);
  };
  const row = (u: UserRef & { since: string }, actions: ReactNode) => (
    <div key={u.username} className="card list-row">
      <span><UserLink u={u} /> <span className="muted" style={{ fontSize: "0.85rem" }}>· {date(u.since)}</span></span>
      <span className="row-actions">{actions}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Amigos</h1>
      <form className="toolbar" onSubmit={search}>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Buscar usuario por nombre exacto" aria-label="Buscar usuario" />
        <button className="btn small">Ver perfil</button>
      </form>
      {actionError !== undefined && <ErrorBox error={actionError} />}
      {error ? <ErrorBox error={error} /> : !data ? <div className="skeleton" /> : (
        <>
          {data.incoming.length > 0 && (
            <section className="section" style={{ marginTop: 16 }}>
              <h2>Solicitudes recibidas</h2>
              <div className="stack">{data.incoming.map((u) => row(u, <>
                <button className="btn primary small" onClick={() => act(() => api.acceptFriend(u.username))}>Aceptar</button>
                <button className="btn small" onClick={() => act(() => api.removeFriend(u.username))}>Rechazar</button>
              </>))}</div>
            </section>
          )}
          <section className="section" style={{ marginTop: 16 }}>
            <h2>Mis amigos ({data.friends.length})</h2>
            {data.friends.length === 0 ? <div className="empty">Todavía no agregaste amigos.</div>
              : <div className="stack">{data.friends.map((u) => row(u,
                <button className="btn small danger" onClick={() => act(() => api.removeFriend(u.username))}>Eliminar</button>))}</div>}
          </section>
          {data.outgoing.length > 0 && (
            <section className="section" style={{ marginTop: 16 }}>
              <h2>Solicitudes enviadas</h2>
              <div className="stack">{data.outgoing.map((u) => row(u,
                <button className="btn small" onClick={() => act(() => api.removeFriend(u.username))}>Cancelar</button>))}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
