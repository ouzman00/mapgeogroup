import { lazy } from "react";

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
  "expected a javascript-or-wasm module script",
  "strict mime type checking",
  "chunkloaderror",
  "loading chunk",
  "loading css chunk",
];

function isChunkLoadError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function reloadForFreshBuild(reason = "chunk-load") {
  if (typeof window === "undefined") return false;

  const storage = safeSessionStorage();
  const key = "mapgeo:fresh-build-reload";
  const now = Date.now();

  try {
    const previous = Number(storage?.getItem(key) || 0);

    if (previous && now - previous < 30000) {
      return false;
    }

    storage?.setItem(key, String(now));
  } catch {
    // Si sessionStorage est indisponible, on tente quand même un rechargement.
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(now));

  console.warn(`[MAPGEO] Rechargement automatique apres erreur de module (${reason}).`);
  window.location.replace(url.toString());

  return true;
}

export function lazyWithRetry(importer, chunkName = "page") {
  return lazy(() =>
    importer().catch((error) => {
      if (isChunkLoadError(error) && reloadForFreshBuild(chunkName)) {
        return new Promise(() => {});
      }

      throw error;
    }),
  );
}

export function installChunkLoadGuards() {
  if (typeof window === "undefined" || window.__MAPGEO_CHUNK_GUARDS__) return;

  window.__MAPGEO_CHUNK_GUARDS__ = true;

  window.addEventListener(
    "error",
    (event) => {
      const target = event?.target;
      const assetUrl = target?.src || target?.href || "";
      const message = String(event?.message || "").toLowerCase();

      if (
        assetUrl.includes("/assets/") ||
        CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
      ) {
        reloadForFreshBuild("asset-error");
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event?.reason)) {
      event.preventDefault?.();
      reloadForFreshBuild("dynamic-import");
    }
  });
}
