import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import authService from "../services/authService";
import { clearSession, getStoredTokens, refreshAccessToken, saveStoredSessionIdentity, saveStoredTokens } from "../services/api";

export const AuthContext = createContext(null);

function getUserStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStoredUser() {
  const sessionStorageRef = getUserStorage();
  try {
    // L'utilisateur auth ne doit jamais être restauré depuis localStorage :
    // localStorage est partagé entre onglets et mélange les comptes.
    localStorage.removeItem("mapgeo_user");
    const raw = sessionStorageRef?.getItem("mapgeo_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    sessionStorageRef?.removeItem("mapgeo_user");
    localStorage.removeItem("mapgeo_user");
    return null;
  }
}

function saveStoredUser(profile) {
  getUserStorage()?.setItem("mapgeo_user", JSON.stringify(profile));
  saveStoredSessionIdentity(profile);
  localStorage.removeItem("mapgeo_user");
}

async function persistAuthPayload(data, { setTokens, setUser }) {
  setTokens(data);
  saveStoredTokens(data);

  const profile = data.user || (await authService.getProfile());
  setUser(profile);
  saveStoredUser(profile);
  window.dispatchEvent(new Event("mapgeo:login"));

  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [tokens, setTokens] = useState(() => getStoredTokens());
  const [loading, setLoading] = useState(true);
  const manualLogoutRef = useRef(false);
  const bootstrapSeqRef = useRef(0);

  const applyLogout = useCallback(() => {
    setTokens(null);
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const handleForcedLogout = () => {
      applyLogout();
    };

    window.addEventListener("mapgeo:logout", handleForcedLogout);
    return () => window.removeEventListener("mapgeo:logout", handleForcedLogout);
  }, [applyLogout]);

  useEffect(() => {
    const bootstrapSeq = bootstrapSeqRef.current + 1;
    bootstrapSeqRef.current = bootstrapSeq;
    let active = true;

    const canCommit = () => active && bootstrapSeq === bootstrapSeqRef.current && !manualLogoutRef.current;

    const bootstrap = async () => {
      if (manualLogoutRef.current) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        let activeTokens = tokens;
        if (!activeTokens?.access && activeTokens?.refresh && !manualLogoutRef.current) {
          activeTokens = await refreshAccessToken();
          if (activeTokens?.access && canCommit()) {
            setTokens(activeTokens);
          }
        }

        if (!activeTokens?.access || !canCommit()) {
          if (active) setLoading(false);
          return;
        }

        const profile = await authService.getProfile();
        if (!canCommit()) return;
        setUser(profile);
        saveStoredUser(profile);
      } catch (error) {
        if (!active || manualLogoutRef.current) return;
        console.error("Erreur chargement profil:", error);
        clearSession({
          clearSharedStorage: !error?.isForeignRefreshSession,
          blockRefreshBootstrap: Boolean(error?.isForeignRefreshSession),
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, [tokens?.access]);

  const login = useCallback(async (credentials) => {
    manualLogoutRef.current = false;
    const data = await authService.login(credentials);
    return persistAuthPayload(data, { setTokens, setUser });
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    manualLogoutRef.current = false;
    const data = await authService.googleLogin(credential);
    return persistAuthPayload(data, { setTokens, setUser });
  }, []);

  const logout = useCallback(async () => {
    manualLogoutRef.current = true;
    bootstrapSeqRef.current += 1;

    try {
      await authService.logout();
    } catch (error) {
      console.warn("Déconnexion serveur indisponible, nettoyage local appliqué.", error);
    } finally {
      clearSession();
      applyLogout();
    }
  }, [applyLogout]);

  const value = useMemo(
    () => ({
      user,
      tokens,
      loading,
      isAuthenticated: Boolean(tokens?.access),
      isClientPortal: user?.portal_type === "client",
      isInternalPortal: user?.portal_type === "internal",
      login,
      loginWithGoogle,
      logout,
      setUser,
    }),
    [user, tokens, loading, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
