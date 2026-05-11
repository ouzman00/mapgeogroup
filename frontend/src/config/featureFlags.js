const runtimeConfig = typeof window !== "undefined" ? window.__MAPGEO_CONFIG__ || {} : {};

function envFlag(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export const ENABLE_LEGACY_GEOJSON_LAYERS = envFlag(
  runtimeConfig.ENABLE_LEGACY_GEOJSON_LAYERS ?? import.meta.env.VITE_ENABLE_LEGACY_GEOJSON_LAYERS,
  false,
);
