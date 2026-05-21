import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import mapLayerService from "../../../services/mapLayerService";

const AUTH_TILE_BLOB_CACHE = new Map();
const AUTH_TILE_BLOB_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTH_TILE_BLOB_CACHE_MAX = 320;

function tileEndpoint(endpoint, coords) {
  return String(endpoint || "").replace("{z}", coords.z).replace("{x}", coords.x).replace("{y}", coords.y);
}

function getCachedTileBlob(key) {
  const cached = AUTH_TILE_BLOB_CACHE.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    AUTH_TILE_BLOB_CACHE.delete(key);
    return null;
  }
  return cached.blob;
}

function rememberTileBlob(key, blob) {
  if (!key || !blob) return;
  if (AUTH_TILE_BLOB_CACHE.has(key)) AUTH_TILE_BLOB_CACHE.delete(key);
  AUTH_TILE_BLOB_CACHE.set(key, { blob, expiresAt: Date.now() + AUTH_TILE_BLOB_CACHE_TTL_MS });

  while (AUTH_TILE_BLOB_CACHE.size > AUTH_TILE_BLOB_CACHE_MAX) {
    const oldestKey = AUTH_TILE_BLOB_CACHE.keys().next().value;
    AUTH_TILE_BLOB_CACHE.delete(oldestKey);
  }
}

function dataFormat(layer = {}) {
  return String(layer.dataFormat || layer.data_format || layer.metadata?.dataFormat || layer.clientLayerType || "").toLowerCase();
}

function hasRenderableWmsTileSource(layer, endpoint) {
  if (!endpoint || layer?.available === false || layer?.visible === false) return false;
  return dataFormat(layer) === "wms";
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  if (Array.isArray(bounds)) return bounds;
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return [[south, west], [north, east]];
}

export function AuthenticatedTileLayer({ layer, zIndex = 200, setLayerRuntime }) {
  const map = useMap();
  const endpoint = layer?.authTileEndpoint || layer?.tileEndpoint || layer?.tile_endpoint || "";
  const layerId = layer?.id;
  const opacity = Number.isFinite(Number(layer?.opacity)) ? Number(layer.opacity) : 1;

  useEffect(() => {
    if (!map || !endpoint || !layerId || !hasRenderableWmsTileSource(layer, endpoint)) return undefined;

    const SecureGridLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        const tileUrl = tileEndpoint(endpoint, coords);
        const cachedBlob = getCachedTileBlob(tileUrl);

        if (cachedBlob) {
          const url = URL.createObjectURL(cachedBlob);
          img.onload = () => { URL.revokeObjectURL(url); done(null, img); };
          img.onerror = () => { URL.revokeObjectURL(url); done(new Error("Erreur tuile WMS"), img); };
          img.src = url;
          return img;
        }

        setLayerRuntime?.(layerId, { loading: true, error: "" });
        mapLayerService.getAuthenticatedBlob(tileUrl)
          .then((blob) => {
            rememberTileBlob(tileUrl, blob);
            const url = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(url); done(null, img); };
            img.onerror = () => { URL.revokeObjectURL(url); done(new Error("Erreur tuile WMS"), img); };
            img.src = url;
          })
          .catch((error) => {
            console.warn(`Impossible de charger la tuile WMS privée ${layer?.name || layerId}.`, error);
            setLayerRuntime?.(layerId, { loading: false, error: "Erreur WMS" });
            done(error, img);
          });
        return img;
      },
    });

    const secureLayer = new SecureGridLayer({
      minZoom: layer?.minZoom,
      maxZoom: layer?.maxZoom ?? 22,
      tileSize: layer?.tileSize || 256,
      opacity,
      zIndex,
      bounds: normalizeBounds(layer?.bounds),
    });

    secureLayer.on("loading", () => setLayerRuntime?.(layerId, { loading: true, error: "" }));
    secureLayer.on("load", () => setLayerRuntime?.(layerId, { loading: false, error: "" }));
    secureLayer.on("tileerror", () => setLayerRuntime?.(layerId, { loading: false, error: "Erreur WMS" }));
    secureLayer.addTo(map);
    return () => secureLayer.removeFrom(map);
  }, [endpoint, layerId, layer?.available, layer?.bounds, layer?.clientLayerType, layer?.dataFormat, layer?.data_format, layer?.maxZoom, layer?.metadata?.dataFormat, layer?.minZoom, layer?.name, layer?.tileSize, layer?.visible, map, opacity, setLayerRuntime, zIndex]);

  return null;
}
