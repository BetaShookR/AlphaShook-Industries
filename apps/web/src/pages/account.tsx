import { ProfileEditor } from "./community";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { useAsync, useSession } from "../hooks";
import { ErrorBox, Field, fieldErrors } from "../components/ui";

/** Maneja envío, carga y error de un formulario. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, onSubmit, errs: fieldErrors(error) };
}

export function LoginPage() {
  const { setUser } = useSession();
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const f = useSubmit(async () => {
    const { user: u } = await api.login(identifier, password);
    setUser(u);
    nav("/");
  });
  return (
    <div className="card auth-card">
      <h1>Iniciar sesión</h1>
      <p className="muted">Usá la misma cuenta en la web, el launcher y Android.</p>
      <form className="form" onSubmit={f.onSubmit}>
        {f.error ? <ErrorBox error={f.error} /> : null}
        <Field label="Correo o nombre de usuario" name="identifier" autoComplete="username" value={identifier} onChange={setIdentifier} />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        <button className="btn primary" disabled={f.busy}>{f.busy ? "Ingresando…" : "Ingresar"}</button>
      </form>
      <div className="links">
        <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        <Link to="/register">Crear cuenta</Link>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { setUser } = useSession();
  const nav = useNavigate();
  const [v, setV] = useState({ username: "", email: "", password: "", passwordConfirm: "" });
  const [acceptTerms, setAccept] = useState(false);
  const set = (k: keyof typeof v) => (val: string) => setV((s) => ({ ...s, [k]: val }));
  const f = useSubmit(async () => {
    const { user: u } = await api.register({ ...v, acceptTerms });
    setUser(u);
    nav("/account?welcome=1");
  });
  return (
    <div className="card auth-card">
      <h1>Crear cuenta</h1>
      <form className="form" onSubmit={f.onSubmit}>
        {f.error && !Object.keys(f.errs).length ? <ErrorBox error={f.error} /> : null}
        <Field label="Nombre de usuario" name="username" autoComplete="username" value={v.username} onChange={set("username")} error={f.errs.username} />
        <Field label="Correo electrónico" name="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} error={f.errs.email} />
        <Field label="Contraseña (mínimo 8 caracteres)" name="password" type="password" autoComplete="new-password" value={v.password} onChange={set("password")} error={f.errs.password} />
        <Field label="Confirmar contraseña" name="passwordConfirm" type="password" autoComplete="new-password" value={v.passwordConfirm} onChange={set("passwordConfirm")} error={f.errs.passwordConfirm} />
        <label className="check">
          <input type="checkbox" checked={acceptTerms} onChange={(e) => setAccept(e.target.checked)} required />
          <span>Acepto los términos y condiciones y la política de privacidad.</span>
        </label>
        {f.errs.acceptTerms && <span className="err" style={{ color: "var(--danger)" }}>{f.errs.acceptTerms}</span>}
        <button className="btn primary" disabled={f.busy}>{f.busy ? "Creando…" : "Crear cuenta"}</button>
      </form>
      <div className="links"><span className="muted">¿Ya tenés cuenta?</span><Link to="/login">Iniciar sesión</Link></div>
    </div>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { refresh } = useSession();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    api.verifyEmail(token).then(
      () => (setState("ok"), void refresh()),
      (e) => (setError(e), setState("error")),
    );
  }, [token, refresh]);
  return (
    <div className="card auth-card">
      <h1>Verificación de correo</h1>
      <div style={{ marginTop: 16 }}>
        {state === "loading" && <p className="muted">Verificando…</p>}
        {state === "ok" && <div className="alert ok">¡Listo! Tu correo quedó verificado.</div>}
        {state === "error" && <ErrorBox error={error} />}
      </div>
      <div className="links"><Link to="/">Ir a la tienda</Link></div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const f = useSubmit(async () => {
    await api.forgotPassword(email);
    setSent(true);
  });
  return (
    <div className="card auth-card">
      <h1>Recuperar contraseña</h1>
      {sent ? (
        <div className="alert ok" style={{ marginTop: 16 }}>Si el correo está registrado, te enviamos un enlace para elegir una nueva contraseña. Vence en 1 hora.</div>
      ) : (
        <form className="form" onSubmit={f.onSubmit}>
          {f.error ? <ErrorBox error={f.error} /> : null}
          <Field label="Correo electrónico" name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
          <button className="btn primary" disabled={f.busy}>Enviar enlace</button>
        </form>
      )}
      <div className="links"><Link to="/login">Volver a iniciar sesión</Link></div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const f = useSubmit(async () => {
    await api.resetPassword(params.get("token") ?? "", password, confirm);
    setDone(true);
  });
  return (
    <div className="card auth-card">
      <h1>Nueva contraseña</h1>
      {done ? (
        <div className="alert ok" style={{ marginTop: 16 }}>Contraseña actualizada. Por seguridad cerramos todas tus sesiones.</div>
      ) : (
        <form className="form" onSubmit={f.onSubmit}>
          {f.error && !Object.keys(f.errs).length ? <ErrorBox error={f.error} /> : null}
          <Field label="Nueva contraseña" name="password" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={f.errs.password} />
          <Field label="Confirmar contraseña" name="passwordConfirm" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={f.errs.passwordConfirm} />
          <button className="btn primary" disabled={f.busy}>Guardar</button>
        </form>
      )}
      <div className="links"><Link to="/login">Iniciar sesión</Link></div>
    </div>
  );
}

const DEVICE = { web: "Navegador", launcher: "Launcher", android: "Android" } as const;

export function AccountPage() {
  const { user, ready, logout } = useSession();
  const [params] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string>();
  const sessions = useAsync(() => (user ? api.sessions() : Promise.resolve([])), [user?.id, tick]);
  if (!ready) return <div className="skeleton" />;
  if (!user) return <Navigate to="/login" replace />;

  const resend = async () => {
    try {
      await api.resendVerification();
      setMsg("Te enviamos un nuevo enlace de verificación.");
    } catch {
      setMsg("No se pudo reenviar. Probá en un minuto.");
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Mi cuenta</h1>
      {params.get("welcome") && <div className="alert ok">¡Cuenta creada! Revisá tu correo para verificarla.</div>}

      <section className="card section" style={{ padding: 20 }}>
        <dl className="kv">
          <dt>Usuario</dt><dd>{user.username}</dd>
          <dt>Correo</dt>
          <dd>
            {user.email}
            {user.emailVerified ? <span className="badge">Verificado</span> : <span className="badge warn">Sin verificar</span>}
          </dd>
          <dt>Miembro desde</dt><dd>{new Date(user.createdAt).toLocaleDateString("es-AR")}</dd>
        </dl>
        {!user.emailVerified && (
          <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => void resend()}>Reenviar verificación</button>
            {msg && <span className="muted">{msg}</span>}
          </div>
        )}
      </section>

      <section className="card section" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Perfil público</h2>
        <ProfileEditor />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Sesiones activas</h2>
          <button className="btn small" onClick={() => void api.revokeOthers().then(() => setTick((t) => t + 1))}>Cerrar las demás</button>
        </div>
        {sessions.error ? <ErrorBox error={sessions.error} /> : null}
        <div className="sessions">
          {sessions.data?.map((s) => (
            <div key={s.id} className="card session">
              <div>
                <strong>{DEVICE[s.deviceType]}</strong>
                {s.current && <span className="badge">Esta sesión</span>}
                <div className="muted" style={{ fontSize: "0.88rem" }}>
                  Último uso: {new Date(s.lastUsedAt).toLocaleString("es-AR")}
                </div>
              </div>
              {s.current ? (
                <button className="btn small danger" onClick={() => void logout()}>Cerrar sesión</button>
              ) : (
                <button className="btn small danger" onClick={() => void api.revokeSession(s.id).then(() => setTick((t) => t + 1))}>Cerrar</button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
