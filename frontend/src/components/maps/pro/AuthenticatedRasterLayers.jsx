import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import mapLayerService from "../../../services/mapLayerService";

function tileEndpoint(endpoint, coords) {
  return String(endpoint || "").replace("{z}", coords.z).replace("{x}", coords.x).replace("{y}", coords.y);
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
        setLayerRuntime?.(layerId, { loading: true, error: "" });
        mapLayerService.getAuthenticatedBlob(tileEndpoint(endpoint, coords))
          .then((blob) => {
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
