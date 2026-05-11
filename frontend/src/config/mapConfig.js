const DEFAULT_VECTOR_TILES = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  maxNativeZoom: 20,
  maxZoom: 22,
  detectRetina: true,
};

const DEFAULT_LABEL_TILES = {
  // Labels Google Hybrid : routes + noms à superposer sur le satellite.
  url: "https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",
  attribution: "&copy; Google",
  opacity: 0.9,
  maxNativeZoom: 22,
  maxZoom: 22,
  detectRetina: false,
};

const DEFAULT_SATELLITE_TILES = {
  // Satellite Google simple, sans labels.
  // Le mode hybride ajoute DEFAULT_LABEL_TILES au-dessus.
  url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
  attribution: "&copy; Google",
  maxNativeZoom: 22,
  maxZoom: 22,
  detectRetina: false,
};

function clampOpacity(value, fallback = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(1, Math.max(0, numericValue));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseJsonEnv(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("Configuration cartographique JSON invalide.", error);
    return null;
  }
}

function normalizeBaseLayer(rawLayer, fallback) {
  const maxNativeZoom = Number(
    rawLayer?.maxNativeZoom ?? fallback.maxNativeZoom,
  );
  const maxZoom = Number(rawLayer?.maxZoom ?? fallback.maxZoom);
  return {
    url: rawLayer?.url || fallback.url,
    attribution: rawLayer?.attribution || fallback.attribution,
    opacity: clampOpacity(rawLayer?.opacity, fallback.opacity ?? 1),
    maxNativeZoom: Number.isFinite(maxNativeZoom) ? maxNativeZoom : undefined,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : undefined,
    detectRetina: rawLayer?.detectRetina ?? fallback.detectRetina,
  };
}

function normalizeSigLayer(rawLayer, index) {
  if (!rawLayer || typeof rawLayer !== "object") return null;

  const kind = String(rawLayer.service || rawLayer.type || rawLayer.dataFormat || rawLayer.data_format || "").toLowerCase();
  const sourceKind = ["geojson", "wms", "wfs"].includes(kind) ? kind : "";
  if (!sourceKind) return null;

  const url = typeof rawLayer.url === "string" ? rawLayer.url.trim() : "";
  const endpoint = typeof rawLayer.endpoint === "string" ? rawLayer.endpoint.trim() : url;
  const isWms = sourceKind === "wms";
  const isVector = sourceKind === "geojson" || sourceKind === "wfs";

  if (isWms && (!url || !(typeof rawLayer.layers === "string" && rawLayer.layers.trim()))) {
    return null;
  }
  if (isVector && !endpoint) return null;

  return {
    ...rawLayer,
    id: rawLayer.id || `sig-${index}`,
    name: rawLayer.name || rawLayer.title || `Couche ${index + 1}`,
    url: isWms ? url : "",
    endpoint: isVector ? endpoint : rawLayer.endpoint,
    type: isWms ? "wms" : "geojson",
    service: sourceKind,
    dataFormat: sourceKind,
    layers: isWms ? rawLayer.layers.trim() : rawLayer.layers,
    attribution: rawLayer.attribution || "",
    visible: rawLayer.visible ?? rawLayer.defaultVisible ?? true,
    opacity: clampOpacity(rawLayer.opacity, isWms ? 0.65 : 0.85),
    transparent: rawLayer.transparent !== false,
    format: rawLayer.format || "image/png",
  };
}

export function getMapConfig() {
  const vectorTiles = normalizeBaseLayer(
    parseJsonEnv(import.meta.env.VITE_VECTOR_TILE),
    DEFAULT_VECTOR_TILES,
  );
  const labelTiles = normalizeBaseLayer(
    parseJsonEnv(import.meta.env.VITE_LABEL_TILE),
    DEFAULT_LABEL_TILES,
  );
  const satelliteTiles = normalizeBaseLayer(
    parseJsonEnv(import.meta.env.VITE_SATELLITE_TILE),
    DEFAULT_SATELLITE_TILES,
  );

  const rawSigLayers = parseJsonEnv(import.meta.env.VITE_SIG_LAYERS);
  const sigLayers = Array.isArray(rawSigLayers)
    ? rawSigLayers.map(normalizeSigLayer).filter(Boolean)
    : [];

  return {
    vectorTiles,
    labelTiles,
    satelliteTiles,
    sigLayers,
  };
}
