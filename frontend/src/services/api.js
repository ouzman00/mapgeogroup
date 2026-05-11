import axios from "axios";

const runtimeConfig = typeof window !== "undefined" ? window.__MAPGEO_CONFIG__ || {} : {};

const API_BASE_URL = (
  runtimeConfig.API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  "/api"
).replace(/\/+$/, "") || "/";

function readBooleanConfig(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

const USE_REFRESH_COOKIE = readBooleanConfig(
  runtimeConfig.USE_REFRESH_COOKIE ?? import.meta.env.VITE_USE_REFRESH_COOKIE,
  true,
);

const ACCESS_TOKEN_STORAGE_MODE = String(
  runtimeConfig.ACCESS_TOKEN_STORAGE || import.meta.env.VITE_ACCESS_TOKEN_STORAGE || "memory",
).trim().toLowerCase();

const USE_MEMORY_ACCESS_TOKEN = USE_REFRESH_COOKIE && ACCESS_TOKEN_STORAGE_MODE !== "session";

export const REFRESH_ENDPOINT = "/auth/refresh/";
let refreshTokenPromise = null;

export function isRefreshCookieEnabled() {
  return USE_REFRESH_COOKIE;
}

function joinApiUrl(baseUrl, endpoint) {
  if (!endpoint) return baseUrl;
  const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
  const normalizedEndpoint = String(endpoint || "").replace(/^\/+/, "");
  if (!normalizedBase || normalizedBase === "/") return `/${normalizedEndpoint}`;
  return `${normalizedBase}/${normalizedEndpoint}`;
}

function normalizeApiRequestUrl(url) {
  if (!url) return url;

  const requestUrl = String(url);
  if (!/^https?:\/\//i.test(requestUrl)) {
    return requestUrl;
  }

  try {
    const parsed = new URL(requestUrl);
    const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
    const basePath = API_BASE_URL.startsWith("/") ? API_BASE_URL : new URL(API_BASE_URL).pathname;
    const apiPath = basePath.replace(/\/+$/, "") || "/api";

    if (parsed.pathname === apiPath || parsed.pathname.startsWith(`${apiPath}/`)) {
      const relativePath = parsed.pathname.slice(apiPath.length) || "/";
      return `${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}${parsed.search}${parsed.hash}`;
    }

    if (parsed.origin === browserOrigin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return requestUrl;
  }

  return requestUrl;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});


const inFlightGetRequests = new Map();

function stableSerialize(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

function buildDedupedGetKey(url, config = {}) {
  const accessToken = getStoredTokens()?.access || "";
  return [
    String(url || ""),
    stableSerialize(config.params || {}),
    String(config.responseType || ""),
    accessToken ? `auth:${accessToken.slice(-16)}` : "anon",
  ].join("::");
}

export function getDeduped(url, config = {}) {
  const key = buildDedupedGetKey(url, config);
  const existingRequest = inFlightGetRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = api.get(url, config).finally(() => {
    inFlightGetRequests.delete(key);
  });

  inFlightGetRequests.set(key, request);
  return request;
}

const TOKEN_STORAGE_KEY = "mapgeo_tokens";
const USER_STORAGE_KEY = "mapgeo_user";
const SESSION_IDENTITY_STORAGE_KEY = "mapgeo_session_identity";
const COOKIE_BOOTSTRAP_BLOCKED_STORAGE_KEY = "mapgeo_cookie_bootstrap_blocked";
let inMemoryTokens = null;


function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    const decoded = typeof window !== "undefined" && typeof window.atob === "function"
      ? window.atob(padded)
      : globalThis.atob?.(padded);
    if (!decoded) return null;

    const json = decodeURIComponent(
      decoded
        .split("")
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeIdentity(identity = {}) {
  const role = identity.role ? String(identity.role) : "";
  const portalType = identity.portal_type || identity.portalType || (role === "client" ? "client" : role ? "internal" : "");

  return {
    id: identity.user_id ?? identity.id ?? identity.sub ?? null,
    role,
    portal_type: portalType ? String(portalType) : "",
    client_id: identity.client_id ?? identity.clientId ?? null,
    client_code: identity.client_code || identity.clientCode || "",
  };
}

function identityValue(value) {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function identitiesConflict(expected, actual) {
  if (!expected || !actual) return false;

  const expectedIdentity = normalizeIdentity(expected);
  const actualIdentity = normalizeIdentity(actual);

  if (identityValue(expectedIdentity.id) && identityValue(actualIdentity.id) && identityValue(expectedIdentity.id) !== identityValue(actualIdentity.id)) {
    return true;
  }

  if (expectedIdentity.role && actualIdentity.role && expectedIdentity.role !== actualIdentity.role) {
    return true;
  }

  if (expectedIdentity.portal_type && actualIdentity.portal_type && expectedIdentity.portal_type !== actualIdentity.portal_type) {
    return true;
  }

  if (expectedIdentity.role === "client" || actualIdentity.role === "client") {
    if (identityValue(expectedIdentity.client_id) && identityValue(actualIdentity.client_id) && identityValue(expectedIdentity.client_id) !== identityValue(actualIdentity.client_id)) {
      return true;
    }
    if (expectedIdentity.client_code && actualIdentity.client_code && expectedIdentity.client_code !== actualIdentity.client_code) {
      return true;
    }
  }

  return false;
}

function getAccessTokenIdentity(accessToken) {
  const claims = decodeJwtPayload(accessToken);
  return claims ? normalizeIdentity(claims) : null;
}

export function getStoredSessionIdentity() {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) return null;

  const explicitIdentity = safeJsonParse(sessionStorageRef.getItem(SESSION_IDENTITY_STORAGE_KEY));
  if (explicitIdentity) return normalizeIdentity(explicitIdentity);

  const storedUser = safeJsonParse(sessionStorageRef.getItem(USER_STORAGE_KEY));
  return storedUser ? normalizeIdentity(storedUser) : null;
}

export function saveStoredSessionIdentity(user) {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef || !user) return;
  clearCookieBootstrapBlockForTab();
  sessionStorageRef.setItem(SESSION_IDENTITY_STORAGE_KEY, JSON.stringify(normalizeIdentity(user)));
}

function clearStoredSessionIdentity() {
  getSessionStorage()?.removeItem(SESSION_IDENTITY_STORAGE_KEY);
}

function clearCookieBootstrapBlockForTab() {
  getSessionStorage()?.removeItem(COOKIE_BOOTSTRAP_BLOCKED_STORAGE_KEY);
}

function blockCookieBootstrapForTab() {
  getSessionStorage()?.setItem(COOKIE_BOOTSTRAP_BLOCKED_STORAGE_KEY, "1");
}

function isCookieBootstrapBlockedForTab() {
  return getSessionStorage()?.getItem(COOKIE_BOOTSTRAP_BLOCKED_STORAGE_KEY) === "1";
}

function createForeignRefreshSessionError() {
  const error = new Error("Session incompatible : le compte actif du navigateur ne correspond pas à cet onglet.");
  error.isForeignRefreshSession = true;
  return error;
}

function rejectForeignRefreshSession(nextTokens) {
  const expectedIdentity = getStoredSessionIdentity();
  const refreshedIdentity = getAccessTokenIdentity(nextTokens?.access);

  if (!expectedIdentity || !refreshedIdentity || !identitiesConflict(expectedIdentity, refreshedIdentity)) {
    return false;
  }

  // Le cookie refresh HttpOnly est partagé par tout le navigateur.
  // Si un autre onglet vient de se connecter avec un autre compte, le refresh
  // peut réussir avec ce compte étranger. Dans ce cas on nettoie uniquement
  // l'état local de l'onglet courant : appeler /accounts/logout/ ici supprimerait
  // le cookie global et déconnecterait le compte valide ouvert ailleurs.
  clearSession({ clearSharedStorage: false, blockRefreshBootstrap: true });
  return true;
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSessionTokens() {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) return null;
  return safeJsonParse(sessionStorageRef.getItem(TOKEN_STORAGE_KEY));
}

function normalizeStoredTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return null;
  const normalized = {};
  if (tokens.access) normalized.access = tokens.access;
  if (tokens.refresh) normalized.refresh = tokens.refresh;
  return normalized.access || normalized.refresh ? normalized : null;
}

export function getStoredTokens() {
  const sessionStorageRef = getSessionStorage();
  const localStorageRef = getLocalStorage();

  try {
    if (USE_MEMORY_ACCESS_TOKEN) {
      // L'access token reste en mémoire, mais le refresh token est gardé par onglet
      // en sessionStorage. Ainsi deux onglets peuvent rester sur deux comptes
      // différents sans réutiliser le cookie refresh global du navigateur.
      localStorageRef?.removeItem(TOKEN_STORAGE_KEY);
      const sessionTokens = normalizeStoredTokens(readSessionTokens());
      const memoryTokens = normalizeStoredTokens(inMemoryTokens);
      const mergedTokens = normalizeStoredTokens({
        ...sessionTokens,
        ...memoryTokens,
        refresh: memoryTokens?.refresh || sessionTokens?.refresh,
      });
      return mergedTokens;
    }

    // Même en mode stockage session, ne jamais restaurer l'auth depuis
    // localStorage : il est partagé entre tous les onglets du navigateur.
    localStorageRef?.removeItem(TOKEN_STORAGE_KEY);
    const raw = sessionStorageRef?.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;

    const tokens = normalizeStoredTokens(JSON.parse(raw));
    return tokens;
  } catch (error) {
    console.error("Tokens invalides dans le stockage navigateur:", error);
    sessionStorageRef?.removeItem(TOKEN_STORAGE_KEY);
    localStorageRef?.removeItem(TOKEN_STORAGE_KEY);
    inMemoryTokens = null;
    return null;
  }
}

export function saveStoredTokens(tokens) {
  const sessionStorageRef = getSessionStorage();
  const localStorageRef = getLocalStorage();
  const safeTokens = normalizeStoredTokens(tokens);

  if (safeTokens?.access || safeTokens?.refresh) {
    clearCookieBootstrapBlockForTab();
  }

  if (USE_MEMORY_ACCESS_TOKEN) {
    inMemoryTokens = safeTokens?.access ? { access: safeTokens.access, refresh: safeTokens.refresh } : null;

    if (safeTokens?.refresh) {
      // Ne jamais mettre le refresh token dans localStorage : il serait partagé
      // entre onglets et recréerait le changement/déconnexion de compte.
      sessionStorageRef?.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ refresh: safeTokens.refresh }));
    } else {
      sessionStorageRef?.removeItem(TOKEN_STORAGE_KEY);
    }
    localStorageRef?.removeItem(TOKEN_STORAGE_KEY);
    return;
  }

  if (safeTokens) {
    sessionStorageRef?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(safeTokens));
  } else {
    sessionStorageRef?.removeItem(TOKEN_STORAGE_KEY);
  }
  localStorageRef?.removeItem(TOKEN_STORAGE_KEY);
}

export function clearSession(options = {}) {
  const { clearSharedStorage = true, blockRefreshBootstrap = false } = options || {};

  inMemoryTokens = null;
  getSessionStorage()?.removeItem(TOKEN_STORAGE_KEY);
  getSessionStorage()?.removeItem(USER_STORAGE_KEY);
  if (clearSharedStorage) {
    getLocalStorage()?.removeItem(TOKEN_STORAGE_KEY);
    getLocalStorage()?.removeItem(USER_STORAGE_KEY);
  }
  clearStoredSessionIdentity();
  if (blockRefreshBootstrap) {
    blockCookieBootstrapForTab();
  }
  window.dispatchEvent(new Event("mapgeo:logout"));
}

function isPublicAuthEndpoint(url = "") {
  const requestUrl = String(url);

  return (
    requestUrl.includes("/accounts/login/") ||
    requestUrl.includes("/accounts/register/") ||
    requestUrl.includes("/accounts/forgot-password/") ||
    requestUrl.includes("/accounts/reset-password/") ||
    requestUrl.includes("/accounts/clients/activation/") ||
    requestUrl.includes("/accounts/google/login/") ||
    requestUrl.includes("/accounts/logout/") ||
    requestUrl.includes(REFRESH_ENDPOINT)
  );
}

export async function refreshAccessToken() {
  const storedTokens = getStoredTokens();

  if (USE_REFRESH_COOKIE && isCookieBootstrapBlockedForTab()) {
    throw createForeignRefreshSessionError();
  }

  // Ne pas tenter un refresh vide basé uniquement sur le cookie HttpOnly global :
  // ce cookie est partagé par tous les onglets et peut appartenir au dernier
  // compte connecté. Le refresh token de l'onglet doit être envoyé dans le body.
  if (!storedTokens?.refresh) {
    return null;
  }

  if (refreshTokenPromise) return refreshTokenPromise;

  refreshTokenPromise = (async () => {
    const tokens = storedTokens || {};
    const refreshResponse = await axios.post(
      joinApiUrl(API_BASE_URL, REFRESH_ENDPOINT),
      tokens.refresh ? { refresh: tokens.refresh } : {},
      {
        withCredentials: true,
        headers: { "Content-Type": "application/json" },
      },
    );

    const nextTokens = {
      ...tokens,
      access: refreshResponse.data.access,
      refresh: refreshResponse.data.refresh || tokens.refresh,
    };

    if (rejectForeignRefreshSession(nextTokens)) {
      throw createForeignRefreshSessionError();
    }

    saveStoredTokens(nextTokens);
    return nextTokens;
  })().finally(() => {
    refreshTokenPromise = null;
  });

  return refreshTokenPromise;
}

api.interceptors.request.use(
  (config) => {
    const tokens = getStoredTokens();

    if (!config.headers) {
      config.headers = {};
    }

    if (tokens?.access && !isPublicAuthEndpoint(config.url)) {
      config.headers.Authorization = `Bearer ${tokens.access}`;
    } else {
      delete config.headers.Authorization;
    }

    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      delete config.headers["Content-Type"];
      delete config.headers["content-type"];
    }

    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    const statusCode = error.response?.status;
    const detail = String(error.response?.data?.detail || "").toLowerCase();
    const looksLikeAuth403 = statusCode === 403 && (
      detail.includes("authentification")
      || detail.includes("authentication")
      || detail.includes("credentials")
      || detail.includes("identifiants")
      || detail.includes("token")
    );

    if (!error.response || (statusCode !== 401 && !looksLikeAuth403)) {
      return Promise.reject(error);
    }

    if (!originalRequest) {
      clearSession();
      return Promise.reject(error);
    }

    const requestUrl = String(originalRequest.url || "");

    if (isPublicAuthEndpoint(requestUrl)) {
      return Promise.reject(error);
    }

    if (originalRequest._retry) {
      clearSession();
      return Promise.reject(error);
    }

    const tokens = getStoredTokens();

    // Sans refresh token propre à cet onglet, ne pas utiliser le cookie global
    // du navigateur : il peut appartenir à un autre compte ouvert ailleurs.
    if (!tokens?.refresh) {
      clearSession();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const newTokens = await refreshAccessToken();

      if (!newTokens?.access) {
        clearSession();
        return Promise.reject(error);
      }

      if (!originalRequest.headers) {
        originalRequest.headers = {};
      }

      originalRequest.headers.Authorization = `Bearer ${newTokens.access}`;

      return api(originalRequest);
    } catch (refreshError) {
      clearSession({
        clearSharedStorage: !refreshError?.isForeignRefreshSession,
        blockRefreshBootstrap: Boolean(refreshError?.isForeignRefreshSession),
      });
      return Promise.reject(refreshError);
    }
  },
);


export async function fetchAllPages(endpoint, params = {}, options = {}) {
  const pageSize = options.pageSize || 200;
  const maxPages = options.maxPages || 50;
  const results = [];
  let nextUrl = null;
  let count = 0;
  let previous = null;
  let page = 1;

  do {
    const response = await api.get(
      normalizeApiRequestUrl(nextUrl) || endpoint,
      nextUrl ? undefined : { params: { page_size: pageSize, ...params } },
    );
    const data = response.data;

    if (Array.isArray(data)) {
      return { count: data.length, next: null, previous: null, results: data };
    }

    const pageResults = Array.isArray(data?.results) ? data.results : [];
    results.push(...pageResults);
    count = Number(data?.count ?? results.length);
    previous = data?.previous ?? previous;
    nextUrl = data?.next || null;
    page += 1;
  } while (nextUrl && page <= maxPages);

  return { count, next: nextUrl, previous, results, truncated: Boolean(nextUrl) };
}

export default api;
