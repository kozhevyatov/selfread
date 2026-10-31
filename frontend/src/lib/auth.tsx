import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, onAuthChange, refreshSession, setSession, type User } from "./api";
import { clearCache } from "./query";
import { flushOutbox } from "./sync";
import { syncReaderPrefsFromUser } from "./readerPrefs";
import { syncThemeFromUser } from "./theme";

type AuthState = { user: User | null; ready: boolean; logout: () => Promise<void> };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = onAuthChange((u) => {
      setUser(u);
      syncThemeFromUser(u);
      syncReaderPrefsFromUser(u);
    });
    refreshSession()
      .then((data) => {
        if (data) void flushOutbox(); // накопленное без связи — на сервер
      })
      .finally(() => setReady(true));
    return off;
  }, []);

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setSession(null);
      clearCache();
    }
  };

  return <AuthContext.Provider value={{ user, ready, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}
