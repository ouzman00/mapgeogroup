import api, { getDeduped } from "./api";
import { normalizeListResponse } from "./responseUtils";

const CLIENT_LAYERS_ENDPOINT = "/geojson-layers/";
const ADMIN_LAYERS_ENDPOINT = "/admin/geojson-layers/";

const LAYER_TYPE_LABELS = {
  occupation_sol: "Occupation du sol",
  parcelles: "Parcelles",
  zones_protegees: "Zones protégées",
  limites_admin: "Limites administratives",
  autre: "Autre",
};

const LAYER_TYPE_GROUPS = {
  occupation_sol: "zonage",
  parcelles: "cadastre",
  zones_protegees: "zonage",
  limites_admin: "contexte",
  autre: "contexte",
};
const PRIVATE_LAYER_COLOR = "#FBBF24";
const PRIVATE_LAYER_FILL = "#FBBF24";
const PRIVATE_LAYER_FILL_OPACITY = 0.16;

function dispatchMapLayerMutation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mapgeo:layers:refresh"));
  window.dispatchEvent(new CustomEvent("mapgeo:notifications:refresh"));
}

function normalizeGeometryType(value) {
  const raw = String(value || "").toLowerCase();
  if (["line", "linestring", "multilinestring"].includes(raw)) return "line";
  if (["point", "multipoint"].includes(raw)) return "point";
  if (["polygon", "multipolygon"].includes(raw)) return "polygon";
  return raw;
}


function normalizeGeoJsonPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { type: "FeatureCollection", features: [], metadata: { count: 0 } };
  }
  if (payload.type === "FeatureCollection") {
    const features = Array.isArray(payload.features) ? payload.features : [];
    return { ...payload, features, metadata: { ...(payload.metadata || {}), count: payload.metadata?.count ?? features.length } };
  }
  if (payload.type === "Feature") {
    return { type: "FeatureCollection", features: [payload], metadata: { count: 1, normalized_on_client: true } };
  }
  if (["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(payload.type)) {
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: payload, properties: {} }], metadata: { count: 1, normalized_on_client: true } };
  }
  return { type: "FeatureCollection", features: [], metadata: { count: 0, invalid_payload: true } };
}

function normalizeStyleNumber(value, fallback) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function styleFor(layer = {}) {
  const metadataStyle = layer.metadata?.style && typeof layer.metadata.style === "object" ? layer.metadata.style : null;
  const style = layer.style && typeof layer.style === "object" ? layer.style : metadataStyle || {};
  const color = style.strokeColor || style.color || PRIVATE_LAYER_COLOR;
  const fillColor = style.fillColor || style.fill || PRIVATE_LAYER_FILL;
  return {
    ...style,
    color,
    strokeColor: color,
    fillColor,
    fill: fillColor,
    opacity: normalizeStyleNumber(style.opacity, 0.9),
    fillOpacity: normalizeStyleNumber(style.fillOpacity, PRIVATE_LAYER_FILL_OPACITY),
    weight: normalizeStyleNumber(style.weight, 3),
    radius: normalizeStyleNumber(style.radius, 7),
  };
}

function legendFor(layer) {
  const backendLegend = Array.isArray(layer.legend) && layer.legend.length ? layer.legend : Array.isArray(layer.metadata?.legend) ? layer.metadata.legend : [];
  if (backendLegend.length) return backendLegend;

  const style = styleFor(layer);
  const geometryType = normalizeGeometryType(layer.geometry_type || layer.geometryType);
  const symbol = geometryType === "line" ? "line" : geometryType === "point" ? "point" : "polygon";
  const item = {
    label: layer.name || layer.type_label,
    symbol,
    color: style.color || style.strokeColor || PRIVATE_LAYER_COLOR,
    strokeColor: style.color || style.strokeColor || PRIVATE_LAYER_COLOR,
    opacity: style.opacity,
    strokeOpacity: style.opacity,
    weight: style.weight,
  };
  if (symbol === "point") item.radius = style.radius;
  if (symbol !== "line") {
    item.fillColor = style.fillColor || style.fill || PRIVATE_LAYER_FILL;
    item.fillOpacity = style.fillOpacity;
  }
  return [item];
}

export function getGeoJsonLayerTypeLabel(type) {
  return LAYER_TYPE_LABELS[type] || type || "Autre";
}

export function normalizeClientGeoJsonLayer(layer = {}) {
  const layerType = layer.type || layer.layer_type || "autre";
  const id = layer.id;
  return {
    ...layer,
    id,
    type: layerType,
    type_label: getGeoJsonLayerTypeLabel(layerType),
    endpoint: layer.endpoint || (id ? `/geojson-layers/${id}/` : ""),
    service: "geojson",
    group: layer.group || LAYER_TYPE_GROUPS[layerType] || "contexte",
    visible: layer.visible !== false && layer.is_active !== false,
    is_active: layer.is_active !== false,
    geometry_type: normalizeGeometryType(layer.geometry_type || layer.geometryType),
    updatedAt: layer.updated_at || layer.updatedAt || "",
    versionKey: layer.versionKey || layer.updated_at || layer.updatedAt || "",
  };
}

export function toSecureMapLayer(layer = {}) {
  const normalized = normalizeClientGeoJsonLayer(layer);
  return {
    ...normalized,
    id: `client-geojson-${normalized.id}`,
    sourceLayerId: normalized.id,
    privateLayer: true,
    updatedAt: normalized.updatedAt || normalized.updated_at || "",
    versionKey: normalized.versionKey || normalized.updatedAt || normalized.updated_at || `${normalized.id}`,
    service: "geojson",
    type: "geojson",
    clientLayerType: normalized.type,
    name: normalized.name || normalized.type_label,
    shortName: normalized.name || normalized.type_label,
    endpoint: normalized.endpoint,
    visible: normalized.visible !== false && normalized.is_active !== false,
    defaultVisible: normalized.visible !== false && normalized.is_active !== false,
    available: normalized.is_active !== false,
    opacity: 0.85,
    group: normalized.group,
    geometryType: normalizeGeometryType(normalized.geometry_type || normalized.geometryType),
    style: styleFor(normalized),
    metadata: {
      ...(normalized.metadata || {}),
      source: "Couche privée client",
      owner: "Client connecté",
      projection: "EPSG:4326 / affichage EPSG:3857",
      licence: "Privé MAPGEO",
      layerType: normalized.type,
      description: normalized.description || "",
    },
    legend: legendFor(normalized),
  };
}

const geojsonLayerService = {
  async getClientLayers() {
    const response = await getDeduped(CLIENT_LAYERS_ENDPOINT);
    return normalizeListResponse(response.data).results.map(normalizeClientGeoJsonLayer);
  },

  async getClientLayerGeoJson(layerId, params = {}) {
    const response = await getDeduped(`/geojson-layers/${layerId}/`, { params });
    return normalizeGeoJsonPayload(response.data);
  },

  async adminListLayers(filters = null) {
    const params = typeof filters === "object" && filters !== null
      ? Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""))
      : (filters ? { client_id: filters } : {});
    const response = await api.get(ADMIN_LAYERS_ENDPOINT, { params });
    return normalizeListResponse(response.data).results.map(normalizeClientGeoJsonLayer);
  },

  async adminCreateLayer(clientId, payload) {
    const formData = new FormData();
    formData.append("name", payload.name || "");
    formData.append("description", payload.description || "");
    formData.append("type", payload.type || "autre");
    formData.append("is_active", payload.is_active === false ? "false" : "true");
    formData.append("file", payload.file);
    const response = await api.post(`/admin/clients/${clientId}/geojson-layers/`, formData);
    dispatchMapLayerMutation();
    return normalizeClientGeoJsonLayer(response.data);
  },

  async adminUpdateLayer(layerId, payload) {
    const response = await api.patch(`/admin/geojson-layers/${layerId}/`, payload);
    dispatchMapLayerMutation();
    return normalizeClientGeoJsonLayer(response.data);
  },

  async adminDeleteLayer(layerId) {
    await api.delete(`/admin/geojson-layers/${layerId}/`);
    dispatchMapLayerMutation();
  },
};

export default geojsonLayerService;
