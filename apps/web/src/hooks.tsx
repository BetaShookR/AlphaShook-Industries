import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser, StoreIdentity } from "@alphashook/shared";
import { api, ApiError } from "./api";

/** Carga asíncrona simple con estado de carga/error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

interface Session {
  user: PublicUser | null;
  ready: boolean;
  identity: StoreIdentity | null;
  refresh: () => Promise<void>;
  setUser: (u: PublicUser | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<StoreIdentity | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.identity().then((i) => {
      setIdentity(i);
      document.title = i.name;
    }, console.error);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, identity, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession fuera de SessionProvider");
  return s;
}
