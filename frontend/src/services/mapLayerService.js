import api, { getDeduped } from "./api";
import { normalizeListResponse } from "./responseUtils";

const LAYER_TYPE_LABELS = {
  geojson: "Vectoriel",
  wms: "WMS",
  wfs: "WFS",
  postgis: "PostGIS",
};

const DATA_FORMAT_LABELS = {
  geojson: "Vectoriel",
  wms: "WMS",
  wfs: "WFS",
  postgis: "PostGIS",
};

const LAYER_GROUPS = {
  geojson: "zonage",
  wms: "contexte",
  wfs: "zonage",
  postgis: "zonage",
};

const SUPPORTED_DATA_FORMATS = new Set(["wms", "wfs", "postgis"]);
const SENSITIVE_CLIENT_KEYS = new Set(["service_url", "tile_url", "tiles_path", "private_path", "storage_path", "absolute_path", "file_path", "source_path", "original_path"]);
const PRIVATE_LAYER_COLOR = "#FBBF24";
const PRIVATE_LAYER_FILL = "#FBBF24";
const PRIVATE_LAYER_FILL_OPACITY = 0.16;
const PRIVATE_LAYER_STROKE_OPACITY = 0.9;
const PRIVATE_LAYER_STROKE_WEIGHT = 3;
const PRIVATE_LAYER_POINT_RADIUS = 7;

function dispatchMapLayerMutation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mapgeo:layers:refresh"));
  window.dispatchEvent(new CustomEvent("mapgeo:notifications:refresh"));
}

function sanitizeClientMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeClientMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_CLIENT_KEYS.has(String(key).toLowerCase()))
      .map(([key, item]) => [key, sanitizeClientMetadata(item)]),
  );
}

function isLayerReady(layer = {}) {
  return !layer.processing_status || layer.processing_status === "ready";
}

function isDisplayableClientLayer(layerType, dataFormat, metadata = {}) {
  if (!SUPPORTED_DATA_FORMATS.has(dataFormat)) return false;
  if (!(SUPPORTED_DATA_FORMATS.has(layerType) || (dataFormat === "postgis" && layerType === "geojson"))) return false;
  if (dataFormat === "wms") {
    const wmsCrs = String(metadata?.wms_crs || "EPSG:3857").toUpperCase();
    return wmsCrs === "EPSG:3857";
  }
  return true;
}

function clientLayerDisplayMessage(layer = {}, clientDisplayable = false) {
  if (layer.display_message || layer.processing_error) return layer.display_message || layer.processing_error;
  if (clientDisplayable) return "";
  if (layer.is_active === false) return "Couche masquée côté client. Réactivez-la pour l’afficher.";
  if (layer.processing_status === "pending") return "Couche stockée, en attente de préparation avant affichage client.";
  if (layer.processing_status === "processing") return "Couche en préparation, non affichable pour le moment.";
  if (layer.processing_status === "failed") return "La préparation de cette couche a échoué.";
  return "Couche non disponible pour l’affichage client.";
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: payload, properties: {} }],
      metadata: { count: 1, normalized_on_client: true },
    };
  }
  return { type: "FeatureCollection", features: [], metadata: { count: 0, invalid_payload: true } };
}

function normalizeLayerInfo(layer = {}) {
  return {
    id: layer.id,
    group: layer.group || "contexte",
    type: layer.type || "geojson",
    service: layer.service || layer.type || "geojson",
    name: layer.name || layer.label || layer.id,
    shortName: layer.shortName || layer.name || layer.id,
    endpoint: layer.endpoint || layer.url || "",
    url: layer.url || "",
    visible: Boolean(layer.visible),
    available: layer.available !== false,
    minZoom: Number.isFinite(Number(layer.minZoom)) ? Number(layer.minZoom) : undefined,
    maxZoom: Number.isFinite(Number(layer.maxZoom)) ? Number(layer.maxZoom) : 22,
    labelMinZoom: Number.isFinite(Number(layer.labelMinZoom)) ? Number(layer.labelMinZoom) : undefined,
    geometryType: normalizeGeometryType(layer.geometry_type || layer.geometryType),
    legend: Array.isArray(layer.legend) ? layer.legend : [],
    metadata: layer.metadata || {},
    fields: layer.fields || {},
    updatedAt: layer.updated_at || layer.updatedAt || "",
    versionKey: layer.versionKey || layer.updated_at || layer.updatedAt || "",
  };
}

export function getMapLayerTypeLabel(type) {
  return LAYER_TYPE_LABELS[type] || type || "Autre";
}

export function getMapLayerDataFormatLabel(format) {
  return DATA_FORMAT_LABELS[format] || format || "Autre";
}

export function normalizeClientMapLayer(layer = {}) {
  const { service_url: _serviceUrl, tile_url: _tileUrl, ...safeLayer } = layer || {};
  const layerType = safeLayer.layer_type || safeLayer.type || "other";
  const dataFormat = safeLayer.data_format || "other";
  const metadata = sanitizeClientMetadata(safeLayer.metadata || {});
  const clientDisplayable = isLayerReady(safeLayer) && safeLayer.is_active !== false && safeLayer.available !== false && isDisplayableClientLayer(layerType, dataFormat, metadata);
  const service = safeLayer.service || (dataFormat === "geojson" ? "geojson" : dataFormat);
  const id = safeLayer.id;
  return {
    ...safeLayer,
    id,
    layer_type: layerType,
    type: layerType,
    data_format: dataFormat,
    type_label: safeLayer.layer_type_label || getMapLayerTypeLabel(layerType),
    data_format_label: safeLayer.data_format_label || getMapLayerDataFormatLabel(dataFormat),
    group: safeLayer.group || LAYER_GROUPS[layerType] || "contexte",
    service,
    endpoint: safeLayer.endpoint || (["geojson", "wfs"].includes(service) && id ? `/map-layers/${id}/geojson/` : ""),
    tile_endpoint: safeLayer.tile_endpoint || (service === "wms" && id ? `/map-layers/${id}/tiles/{z}/{x}/{y}/` : ""),
    is_active: safeLayer.is_active !== false,
    available: clientDisplayable,
    visible: layer.visible !== false && clientDisplayable,
    display_message: clientLayerDisplayMessage({ ...safeLayer, metadata }, clientDisplayable),
    visibility_state: clientDisplayable ? "visible" : (safeLayer.processing_status || "unavailable"),
    requires_tiling: Boolean(safeLayer.requires_tiling || metadata?.requires_tiling),
    opacity: normalizeNumber(safeLayer.opacity, 1),
    z_index: normalizeNumber(safeLayer.z_index, 1),
    min_zoom: normalizeNumber(safeLayer.min_zoom, 0),
    max_zoom: normalizeNumber(safeLayer.max_zoom, 22),
    bounds: safeLayer.bounds || {},
    center: safeLayer.center || {},
    updatedAt: safeLayer.updated_at || safeLayer.updatedAt || "",
    versionKey: safeLayer.versionKey || safeLayer.updated_at || safeLayer.updatedAt || "",
    metadata,
  };
}

function normalizeStyleNumber(value, fallback) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function clampStyleNumber(value, fallback, min, max) {
  const number = normalizeStyleNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function hexToRgba(color, opacity = 1) {
  const raw = String(color || "").trim();
  const alpha = clampStyleNumber(opacity, 1, 0, 1);
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return raw || PRIVATE_LAYER_COLOR;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}


function normalizeCategoryValue(value) {
  if (value === null || value === undefined) return "__null__";
  const raw = String(value).trim();
  return raw || "__empty__";
}

function categoryLabel(value) {
  const normalized = normalizeCategoryValue(value);
  if (normalized === "__null__") return "Non renseigné";
  if (normalized === "__empty__") return "Non renseigné";
  return String(value || "Autre");
}

function normalizeCategoryStyle(rawStyle = {}, fallbackStyle = {}) {
  const strokeColor = rawStyle.strokeColor || rawStyle.color || rawStyle.style_stroke_color || fallbackStyle.strokeColor || fallbackStyle.color || PRIVATE_LAYER_COLOR;
  const fillColor = rawStyle.fillColor || rawStyle.fill || rawStyle.style_fill_color || fallbackStyle.fillColor || fallbackStyle.fill || strokeColor;
  return {
    ...fallbackStyle,
    ...rawStyle,
    color: strokeColor,
    strokeColor,
    fillColor,
    fill: fillColor,
    opacity: clampStyleNumber(rawStyle.opacity ?? rawStyle.style_stroke_opacity ?? fallbackStyle.opacity, fallbackStyle.opacity ?? PRIVATE_LAYER_STROKE_OPACITY, 0, 1),
    fillOpacity: clampStyleNumber(rawStyle.fillOpacity ?? rawStyle.style_fill_opacity ?? fallbackStyle.fillOpacity, fallbackStyle.fillOpacity ?? PRIVATE_LAYER_FILL_OPACITY, 0, 1),
    weight: clampStyleNumber(rawStyle.weight ?? rawStyle.style_weight ?? fallbackStyle.weight, fallbackStyle.weight ?? PRIVATE_LAYER_STROKE_WEIGHT, 0.5, 12),
    radius: clampStyleNumber(rawStyle.radius ?? rawStyle.style_radius ?? fallbackStyle.radius, fallbackStyle.radius ?? PRIVATE_LAYER_POINT_RADIUS, 2, 30),
  };
}

function styleFor(layer = {}) {
  const metadataStyle = layer.metadata?.style && typeof layer.metadata.style === "object" ? layer.metadata.style : null;
  const rawStyle = layer.style && typeof layer.style === "object" ? layer.style : metadataStyle || {};
  const strokeColor = layer.style_stroke_color || layer.style_color || rawStyle.strokeColor || rawStyle.color || PRIVATE_LAYER_COLOR;
  const fillColor = layer.style_fill_color || rawStyle.fillColor || rawStyle.fill || layer.style_color || PRIVATE_LAYER_FILL;
  const baseStyle = {
    ...rawStyle,
    color: strokeColor,
    strokeColor,
    fillColor,
    fill: fillColor,
    opacity: clampStyleNumber(layer.style_stroke_opacity ?? rawStyle.opacity, PRIVATE_LAYER_STROKE_OPACITY, 0, 1),
    fillOpacity: clampStyleNumber(layer.style_fill_opacity ?? rawStyle.fillOpacity, PRIVATE_LAYER_FILL_OPACITY, 0, 1),
    weight: clampStyleNumber(layer.style_weight ?? rawStyle.weight, PRIVATE_LAYER_STROKE_WEIGHT, 0.5, 12),
    radius: clampStyleNumber(layer.style_radius ?? rawStyle.radius, PRIVATE_LAYER_POINT_RADIUS, 2, 30),
  };
  if (rawStyle.mode === "categorized" && rawStyle.categoryField && Array.isArray(rawStyle.categories)) {
    return {
      ...baseStyle,
      mode: "categorized",
      categoryField: rawStyle.categoryField,
      categories: rawStyle.categories.map((category) => ({
        value: normalizeCategoryValue(category?.value),
        label: category?.label || categoryLabel(category?.value),
        style: normalizeCategoryStyle(category?.style || category, baseStyle),
      })),
    };
  }
  return { ...baseStyle, mode: rawStyle.mode || "single" };
}

function normaliseLegendItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function normalizeWmsLegendItem(item, layer, index = 0) {
  const endpoint = item?.imageEndpoint || item?.image_endpoint || item?.legendEndpoint || item?.legend_endpoint || item?.url || item?.imageUrl || item?.image_url || "";
  return {
    ...item,
    id: item?.id || `wms-legend-${layer.id || "layer"}-${index}`,
    label: item?.label || item?.title || layer.name || layer.type_label || "Légende WMS",
    symbol: "wms-legend",
    imageEndpoint: endpoint,
    source: item?.source || "wms_server",
  };
}

function wmsLegendFor(layer) {
  const publishedLegend = normaliseLegendItems(layer.metadata?.legend || layer.metadata?.wms_legend || layer.legend)
    .filter((item) => item?.imageEndpoint || item?.image_endpoint || item?.legendEndpoint || item?.legend_endpoint || item?.url || item?.imageUrl || item?.image_url);
  if (publishedLegend.length) return publishedLegend.map((item, index) => normalizeWmsLegendItem(item, layer, index));
  return [{
    id: `wms-legend-${layer.id || "layer"}`,
    label: layer.name || layer.type_label || "Légende WMS",
    symbol: "wms-legend",
    imageEndpoint: layer.id ? `/map-layers/${layer.id}/legend/` : "",
    source: "wms_server",
  }];
}

function legendFor(layer) {
  if (["wms", "secure-tile"].includes(layer.service) || layer.data_format === "wms") return wmsLegendFor(layer);

  const backendLegend = normaliseLegendItems(layer.legend || layer.metadata?.legend);
  if (backendLegend.length) return backendLegend;

  const style = styleFor(layer);
  const label = layer.name || layer.type_label;
  const color = style.color || style.strokeColor || PRIVATE_LAYER_COLOR;
  const fillColor = style.fillColor || style.fill || PRIVATE_LAYER_FILL;

  const geometryType = normalizeGeometryType(layer.geometry_type || layer.geometryType);
  if (style.mode === "categorized" && Array.isArray(style.categories) && style.categories.length) {
    const symbol = geometryType === "line" ? "line" : geometryType === "point" ? "point" : "polygon";
    return style.categories.map((category) => {
      const categoryStyle = normalizeCategoryStyle(category.style || category, style);
      const item = {
        label: category.label || categoryLabel(category.value),
        symbol,
        color: categoryStyle.strokeColor || categoryStyle.color,
        strokeColor: categoryStyle.strokeColor || categoryStyle.color,
        opacity: categoryStyle.opacity,
        strokeOpacity: categoryStyle.opacity,
        weight: categoryStyle.weight,
      };
      if (symbol === "point") item.radius = categoryStyle.radius;
      if (symbol !== "line") {
        item.fillColor = categoryStyle.fillColor || categoryStyle.fill;
        item.fillOpacity = categoryStyle.fillOpacity;
        item.fillColorRgba = hexToRgba(item.fillColor, categoryStyle.fillOpacity);
      }
      return item;
    });
  }
  const symbol = geometryType === "line" ? "line" : geometryType === "point" ? "point" : "polygon";
  const item = {
    label,
    symbol,
    color,
    strokeColor: color,
    opacity: style.opacity,
    strokeOpacity: style.opacity,
    weight: style.weight,
  };
  if (symbol === "point") item.radius = style.radius;
  if (symbol !== "line") {
    item.fillColor = fillColor;
    item.fillOpacity = style.fillOpacity;
    item.fillColorRgba = hexToRgba(fillColor, style.fillOpacity);
  }
  return [item];
}

export function toSecureMapLayer(layer = {}) {
  const normalized = normalizeClientMapLayer(layer);
  const isGeoJson = ["geojson", "wfs"].includes(normalized.service) || ["geojson", "wfs"].includes(normalized.data_format);
  const isWms = normalized.service === "wms" || normalized.data_format === "wms" || normalized.layer_type === "wms";
  const service = isGeoJson ? "geojson" : isWms ? "secure-tile" : normalized.service;
  return {
    ...normalized,
    id: `client-map-layer-${normalized.id}`,
    sourceLayerId: normalized.id,
    privateLayer: true,
    updatedAt: normalized.updatedAt || normalized.updated_at || "",
    versionKey: normalized.versionKey || normalized.updatedAt || normalized.updated_at || `${normalized.id}`,
    service,
    type: service,
    clientLayerType: normalized.layer_type,
    dataFormat: normalized.data_format,
    name: normalized.name || normalized.type_label,
    shortName: normalized.name || normalized.type_label,
    endpoint: isGeoJson ? normalized.endpoint : "",
    authTileEndpoint: isWms ? normalized.tile_endpoint : "",
    url: "",
    layers: "",
    bounds: normalized.bounds,
    visible: normalized.visible !== false && normalized.available !== false && normalized.is_active !== false && isLayerReady(normalized),
    defaultVisible: normalized.visible !== false && normalized.available !== false && normalized.is_active !== false && isLayerReady(normalized),
    available: normalized.available !== false && normalized.is_active !== false && isLayerReady(normalized),
    displayMessage: normalized.display_message || "",
    requiresTiling: Boolean(normalized.requires_tiling),
    opacity: normalizeNumber(normalized.opacity, isGeoJson ? 0.85 : 1),
    order: 220 + normalizeNumber(normalized.z_index, 1),
    minZoom: normalizeNumber(normalized.min_zoom, 0),
    maxZoom: normalizeNumber(normalized.max_zoom, 22),
    geometryType: normalizeGeometryType(normalized.geometry_type || normalized.geometryType),
    style: styleFor(normalized),
    legend: legendFor(normalized),
    metadata: { ...sanitizeClientMetadata(normalized.metadata || {}), source: "Couche privée client", owner: "Client connecté", licence: "Privé MAPGEO", layerType: normalized.layer_type, dataFormat: normalized.data_format, description: normalized.description || "" },
  };
}

function appendFormData(formData, payload) {
  formData.append("name", payload.name || "");
  formData.append("description", payload.description || "");
  formData.append("layer_type", payload.layer_type || payload.type || "geojson");
  formData.append("data_format", payload.data_format || "postgis");
  formData.append("is_active", payload.is_active === false ? "false" : "true");
  formData.append("opacity", payload.opacity ?? 1);
  formData.append("z_index", payload.z_index ?? 1);
  formData.append("min_zoom", payload.min_zoom ?? 0);
  formData.append("max_zoom", payload.max_zoom ?? 22);
  if (payload.source_crs) formData.append("source_crs", payload.source_crs);
  if (payload.source_kind) formData.append("source_kind", payload.source_kind);
  if (payload.wms_crs) formData.append("wms_crs", payload.wms_crs);
  if (payload.wms_version) formData.append("wms_version", payload.wms_version);
  if (payload.wfs_version) formData.append("wfs_version", payload.wfs_version);
  for (const key of ["postgis_host", "postgis_port", "postgis_database", "postgis_username", "postgis_password", "postgis_schema", "postgis_table", "postgis_geometry_column", "postgis_id_column", "postgis_source_srid", "postgis_where_clause", "postgis_limit"]) {
    if (payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== "") formData.append(key, payload[key]);
  }
  if (payload.style_color) formData.append("style_color", payload.style_color);
  if (payload.style_fill_color) formData.append("style_fill_color", payload.style_fill_color);
  if (payload.style_stroke_color) formData.append("style_stroke_color", payload.style_stroke_color);
  if (payload.style_fill_opacity !== undefined) formData.append("style_fill_opacity", payload.style_fill_opacity);
  if (payload.style_stroke_opacity !== undefined) formData.append("style_stroke_opacity", payload.style_stroke_opacity);
  if (payload.style_weight !== undefined) formData.append("style_weight", payload.style_weight);
  if (payload.style_radius !== undefined) formData.append("style_radius", payload.style_radius);
  if (payload.style_mode) formData.append("style_mode", payload.style_mode);
  if (payload.style_category_field) formData.append("style_category_field", payload.style_category_field);
  if (payload.style_mode === "categorized" && payload.style_categories !== undefined) formData.append("style_categories", JSON.stringify(payload.style_categories));
  if (payload.service_url) formData.append("service_url", payload.service_url);
  if (payload.tile_url) formData.append("tile_url", payload.tile_url);
  if (payload.service_layers) formData.append("service_layers", payload.service_layers);
  if (payload.bounds && Object.keys(payload.bounds).length) formData.append("bounds", JSON.stringify(payload.bounds));
  if (payload.center && Object.keys(payload.center).length) formData.append("center", JSON.stringify(payload.center));
  if (payload.file) formData.append("file", payload.file);
}

const mapLayerService = {
  async getLayers() {
    const response = await getDeduped("/map/layers/");
    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    return results.map(normalizeLayerInfo);
  },
  async getLayerGeoJson(layer, params = {}, requestConfig = {}) {
    let endpoint = typeof layer === "string" ? layer : layer?.endpoint;
    if (typeof layer === "string") {
      const layerId = layer.replace(/^\/+|\/+$/g, "");
      endpoint = layerId.includes("/") ? `/${layerId}/` : `/map/${layerId}/`;
      endpoint = endpoint.replace(/\/+/g, "/");
    }
    if (!endpoint) throw new Error("Endpoint de couche SIG manquant.");
    const response = await getDeduped(endpoint, { ...requestConfig, params });
    return normalizeGeoJsonPayload(response.data);
  },
  async getClientLayers() {
    const response = await getDeduped("/map-layers/");
    return normalizeListResponse(response.data).results.map(normalizeClientMapLayer);
  },
  async getAuthenticatedBlob(endpoint) {
    const response = await api.get(endpoint, { responseType: "blob" });
    return response.data;
  },
  async adminListLayers(filters = null) {
    const params = typeof filters === "object" && filters !== null
      ? Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""))
      : (filters ? { client_id: filters } : {});
    const response = await api.get("/admin/map-layers/", { params });
    return normalizeListResponse(response.data).results.map(normalizeClientMapLayer);
  },
  async adminListPostgisTables(clientId, params = {}) {
    const response = await api.get(`/admin/clients/${clientId}/map-layers/postgis-tables/`, { params });
    return response.data || { tables: [] };
  },
  async adminGetCapabilities(clientId, payload) {
    const response = await api.post(`/admin/clients/${clientId}/map-layers/capabilities/`, payload);
    return response.data || { layers: [] };
  },
  async adminPreviewPostgis(clientId, payload) {
    const response = await api.post(`/admin/clients/${clientId}/map-layers/postgis-preview/`, payload);
    return response.data || {};
  },
  async adminPreviewWfs(clientId, payload) {
    const response = await api.post(`/admin/clients/${clientId}/map-layers/wfs-preview/`, payload);
    return response.data || {};
  },
  async adminCreateLayer(clientId, payload) {
    const formData = new FormData(); appendFormData(formData, payload);
    const response = await api.post(`/admin/clients/${clientId}/map-layers/`, formData);
    dispatchMapLayerMutation();
    return normalizeClientMapLayer(response.data);
  },
  async adminUpdateLayer(layerId, payload) {
    const response = await api.patch(`/admin/map-layers/${layerId}/`, payload);
    dispatchMapLayerMutation();
    return normalizeClientMapLayer(response.data);
  },
  async adminDeleteLayer(layerId) {
    await api.delete(`/admin/map-layers/${layerId}/`);
    dispatchMapLayerMutation();
  },
};

export default mapLayerService;
