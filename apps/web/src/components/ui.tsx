import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import type { ProductSummary } from "@alphashook/shared";
import { errorMessage, formatPrice, ApiError } from "../api";
import { useSession } from "../hooks";

export function Header() {
  const { user, ready, identity, logout } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    nav(q.trim() ? `/catalog?q=${encodeURIComponent(q.trim())}` : "/catalog");
  };
  return (
    <header className="header">
      <div className="container">
        <Link to="/" className="brand" aria-label="Inicio">
          {identity?.logoUrl ? <img src={identity.logoUrl} alt="" /> : <span className="brand-mark">{identity?.name[0] ?? "·"}</span>}
          <span>{identity?.name ?? ""}</span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/catalog">Catálogo</NavLink>
          {user && <NavLink to="/library">Biblioteca</NavLink>}
          {user && <NavLink to="/wishlist">Deseados</NavLink>}
          <NavLink to="/community">Comunidad</NavLink>
          {user && <NavLink to="/friends">Amigos</NavLink>}
        </nav>
        <form className="search" onSubmit={submit} role="search">
          <input type="search" placeholder="Buscar juegos y aplicaciones" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        </form>
        <div className="account">
          {!ready ? null : user ? (
            <>
              <Link to="/account" className="btn small">{user.username}</Link>
              <button className="btn small" onClick={() => void logout().then(() => nav("/"))}>Salir</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn small">Iniciar sesión</Link>
              <Link to="/register" className="btn small primary">Crear cuenta</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Price({ cents, currency }: { cents: number; currency: string }) {
  return <span className={`price${cents === 0 ? " free" : ""}`}>{formatPrice(cents, currency)}</span>;
}

export function Cover({ url, name }: { url: string | null; name: string }) {
  return <div className="cover">{url ? <img src={url} alt="" loading="lazy" /> : name.slice(0, 1).toUpperCase()}</div>;
}

export function ProductCard({ p }: { p: ProductSummary }) {
  return (
    <Link to={`/p/${p.slug}`} className="card pcard">
      <Cover url={p.coverUrl} name={p.name} />
      <div className="body">
        <div className="name">{p.name}</div>
        <div className="meta">
          <span>{p.developer.name}</span>
          <Price cents={p.priceCents} currency={p.currency} />
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ items, empty }: { items: ProductSummary[]; empty: ReactNode }) {
  if (!items.length) return <div className="empty">{empty}</div>;
  return <div className="grid">{items.map((p) => <ProductCard key={p.slug} p={p} />)}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="alert error">{errorMessage(error)}</div>;
}

/** Errores por campo devueltos por la API (validation_error). */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.details) return {};
  return Object.fromEntries(e.details.map((d) => [d.path, d.message]));
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  error?: string | undefined;
  autoComplete?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `f-${props.name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={!!props.error}
        required
      />
      {props.error && <span className="err">{props.error}</span>}
    </div>
  );
}
