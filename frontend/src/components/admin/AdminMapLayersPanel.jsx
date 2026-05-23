import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileUp,
  Info,
  Layers,
  Loader2,
  Palette,
  PencilLine,
  RefreshCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import mapLayerService, { getMapLayerDataFormatLabel, getMapLayerTypeLabel } from "../../services/mapLayerService";
import { getErrorMessage } from "../../services/responseUtils";

const SOURCE_TYPES = [
  ["postgis", "PostGIS"],
  ["wfs", "WFS"],
  ["wms", "WMS"],
];
const WMS_VERSION_OPTIONS = [["1.3.0", "WMS 1.3.0"], ["1.1.1", "WMS 1.1.1"]];
const WMS_CRS_OPTIONS = [["EPSG:3857", "EPSG:3857 — Web Mercator"], ["EPSG:4326", "EPSG:4326 — WGS84"]];
const WFS_VERSION_OPTIONS = [["2.0.0", "WFS 2.0.0"], ["1.1.0", "WFS 1.1.0"], ["1.0.0", "WFS 1.0.0"]];
const CRS_OPTIONS = [
  ["", "Auto — WGS84 si possible"],
  ["EPSG:4326", "EPSG:4326 — WGS84 lon/lat"],
  ["EPSG:32628", "EPSG:32628 — Sénégal / UTM 28N"],
  ["EPSG:3857", "EPSG:3857 — Web Mercator"],
];
const STATUS_CONFIG = {
  pending: { label: "En attente", className: "bg-amber-50 text-amber-700 border-amber-100", helper: "Stockée, mais pas encore affichable." },
  processing: { label: "Traitement", className: "bg-blue-50 text-blue-700 border-blue-100", helper: "Préparation en cours." },
  ready: { label: "Prête", className: "bg-green-50 text-green-700 border-green-100", helper: "Affichable si elle est autorisée." },
  failed: { label: "Échec", className: "bg-red-50 text-red-700 border-red-100", helper: "Non affichable. Vérifiez l’erreur." },
};
const METADATA_FIELDS = [
  ["source_crs", "CRS source"],
  ["detected_crs", "CRS détecté"],
  ["display_crs", "CRS affichage"],
  ["served_crs", "CRS servi"],
  ["wms_crs", "CRS WMS"],
  ["wms_version", "Version WMS"],
  ["wfs_version", "Version WFS"],
];
const DEFAULT_GEOJSON_COLOR = "#FBBF24";
const DEFAULT_STYLE = {
  style_fill_color: DEFAULT_GEOJSON_COLOR,
  style_stroke_color: DEFAULT_GEOJSON_COLOR,
  style_fill_opacity: 0.16,
  style_stroke_opacity: 0.9,
  style_weight: 3,
  style_radius: 7,
};
const LOCAL_POSTGIS_DEFAULTS = {
  host: "",
  port: "",
  database: "",
  username: "",
  schema: "donnees_mapgeo",
  geometryColumn: "",
  idColumn: "",
  sourceSrid: "auto",
  limit: 20000,
};
const POSTGIS_TABLE_PRESETS = [
  ["", "Choisir une table ou une vue"],
  ["communes", "Communes"],
  ["parcels_parcel", "Parcelles"],
  ["parcels_parcel_qgis", "Parcelles — vue QGIS"],
];

function normalizePostgisTableOption(table) {
  const schema = String(table?.schema || "").trim();
  const value = String(table?.table || table?.value || "").trim();
  if (!value) return null;

  const label = String(table?.label || value.replace(/_/g, " ")).trim();

  return {
    schema,
    value,
    label,
    geometryColumn: String(table?.geometry_column || "").trim(),
    idColumn: String(table?.id_column || "").trim(),
    qualifiedName: String(table?.qualified_name || (schema ? `${schema}.${value}` : value)).trim(),
  };
}

const STYLE_MODE_OPTIONS = [
  ["single", "Style unique"],
  ["categorized", "Catégorisé par attribut"],
];
const CATEGORY_PALETTE = [
  "#2563EB", "#059669", "#D97706", "#7C3AED", "#DC2626", "#0891B2",
  "#4F46E5", "#16A34A", "#EA580C", "#DB2777", "#0F766E", "#9333EA",
  "#0369A1", "#65A30D", "#B45309", "#BE123C", "#0E7490", "#4338CA",
  "#15803D", "#C2410C", "#A21CAF", "#334155", "#047857", "#B91C1C",
];
const emptyForm = {
  name: "",
  description: "",
  layer_type: "geojson",
  data_format: "postgis",
  is_active: true,
  file: null,
  service_url: "",
  service_layers: "",
  source_kind: "database",
  source_crs: "",
  wms_version: "1.3.0",
  wms_crs: "EPSG:3857",
  wfs_version: "2.0.0",
  postgis_host: LOCAL_POSTGIS_DEFAULTS.host,
  postgis_port: LOCAL_POSTGIS_DEFAULTS.port,
  postgis_database: LOCAL_POSTGIS_DEFAULTS.database,
  postgis_username: LOCAL_POSTGIS_DEFAULTS.username,
  postgis_password: "",
  postgis_schema: LOCAL_POSTGIS_DEFAULTS.schema,
  postgis_table: "",
  postgis_geometry_column: LOCAL_POSTGIS_DEFAULTS.geometryColumn,
  postgis_id_column: LOCAL_POSTGIS_DEFAULTS.idColumn,
  postgis_source_srid: LOCAL_POSTGIS_DEFAULTS.sourceSrid,
  postgis_where_clause: "",
  postgis_limit: LOCAL_POSTGIS_DEFAULTS.limit,
  style_color: DEFAULT_GEOJSON_COLOR,
  ...DEFAULT_STYLE,
  style_mode: "single",
  style_category_field: "",
  style_categories: [],
  opacity: 1,
  z_index: 1,
  min_zoom: 0,
  max_zoom: 22,
};

function inputClass(extra = "") {
  return `w-full rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-semibold text-mapgeo-primary outline-none transition focus:border-mapgeo-primary ${extra}`;
}
function smallInputClass(extra = "") {
  return `w-full rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary outline-none transition focus:border-mapgeo-primary ${extra}`;
}
function isVectorLayer(formOrLayer) {
  const dataFormat = String(formOrLayer?.data_format || formOrLayer?.dataFormat || "").toLowerCase();
  const layerType = String(formOrLayer?.layer_type || formOrLayer?.type || "").toLowerCase();
  const service = String(formOrLayer?.service || formOrLayer?.source || "").toLowerCase();
  return dataFormat === "postgis" || dataFormat === "geojson" || dataFormat === "wfs" || layerType === "geojson" || layerType === "wfs" || service === "geojson" || service === "wfs";
}
function isWms(formOrLayer) { return String(formOrLayer?.data_format || formOrLayer?.dataFormat || formOrLayer?.layer_type || formOrLayer?.type || formOrLayer?.service || "").toLowerCase() === "wms"; }
function isWfs(formOrLayer) { return String(formOrLayer?.data_format || formOrLayer?.dataFormat || formOrLayer?.layer_type || formOrLayer?.type || formOrLayer?.service || "").toLowerCase() === "wfs"; }
function isPostgis(formOrLayer) { return String(formOrLayer?.data_format || formOrLayer?.dataFormat || formOrLayer?.source || "").toLowerCase() === "postgis"; }
function isStyledVector(formOrLayer) { return isPostgis(formOrLayer) || isWfs(formOrLayer); }
function needsServiceUrl(form) { return isWfs(form); }
function needsServiceLayerName(form) { return isWms(form) || isWfs(form); }
function selectedServiceLayerNames(formOrValue) {
  const raw = typeof formOrValue === "string" ? formOrValue : formOrValue?.service_layers;
  return String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
}
function serviceCapabilityLabel(layer) {
  const title = String(layer?.title || layer?.label || "").trim();
  const name = String(layer?.name || "").trim();
  return title && title !== name ? `${title} — ${name}` : (name || title || "Couche sans nom");
}
function serviceCapabilityTitle(layer) {
  return String(layer?.title || layer?.label || layer?.name || "Couche sélectionnée").trim();
}
function serviceVersionFor(form) {
  return isWms(form) ? form.wms_version : form.wfs_version;
}
function capabilityRequestPayload(form) {
  return {
    service_type: isWms(form) ? "wms" : "wfs",
    data_format: form.data_format,
    service_url: form.service_url,
    version: serviceVersionFor(form),
    wms_version: form.wms_version,
    wfs_version: form.wfs_version,
  };
}
function isReady(layer) { return !layer.processing_status || layer.processing_status === "ready"; }
function isClientVisible(layer) { return layer.is_active !== false && layer.available !== false && isReady(layer); }
function statusConfig(layer) { return STATUS_CONFIG[layer.processing_status || "ready"] || STATUS_CONFIG.ready; }
function metadataObject(layer) { return layer?.metadata && typeof layer.metadata === "object" ? layer.metadata : {}; }
function metadataStyle(layer) {
  const style = metadataObject(layer).style;
  return style && typeof style === "object" ? style : {};
}

function attributeFieldsFromMetadata(metadata) {
  const fields = metadata && typeof metadata === "object" ? metadata.attribute_fields : [];
  return Array.isArray(fields) ? fields.filter((field) => field?.name) : [];
}
function attributeFields(layer) {
  return attributeFieldsFromMetadata(metadataObject(layer));
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
function isPlaceholderCategoryLabel(label) {
  const raw = String(label || "").trim();
  return !raw || /^Catégorie \d+$/i.test(raw) || /^Valeur \d+$/i.test(raw) || raw === "Valeur vide" || raw === "Sans valeur";
}
function displayCategoryLabel(category) {
  const value = normalizeCategoryValue(category?.value);
  const rawLabel = String(category?.label || "").trim();
  return isPlaceholderCategoryLabel(rawLabel) ? categoryLabel(value) : rawLabel;
}
function normalizeFieldName(value) {
  return String(value || "").trim().toLowerCase();
}
function findAttributeFieldInList(fields, fieldName) {
  const normalized = normalizeFieldName(fieldName);
  if (!normalized) return null;
  return fields.find((item) => item.name === fieldName) || fields.find((item) => normalizeFieldName(item.name) === normalized) || null;
}
function findAttributeField(layer, fieldName) {
  return findAttributeFieldInList(attributeFields(layer), fieldName);
}
function categoryPaletteColor(index) {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

function normalizeDecimal(value) {
  if (typeof value === "number") return value;
  return String(value ?? "").trim().replace(",", ".");
}
function toNumber(value, fallback) {
  const number = Number(normalizeDecimal(value));
  return Number.isFinite(number) ? number : fallback;
}
function clampNumber(value, fallback, min, max) {
  const number = toNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function normalizeCategoryDraft(category, index = 0, fallbackStyle = DEFAULT_STYLE) {
  const rawStyle = category?.style && typeof category.style === "object" ? category.style : category || {};
  const fallbackColor = categoryPaletteColor(index);
  const stroke = rawStyle.strokeColor || rawStyle.color || rawStyle.style_stroke_color || fallbackStyle.style_stroke_color || fallbackColor;
  const fill = rawStyle.fillColor || rawStyle.fill || rawStyle.style_fill_color || fallbackStyle.style_fill_color || stroke;
  const value = normalizeCategoryValue(category?.value);
  const label = displayCategoryLabel({ ...category, value });
  return {
    value,
    label,
    style_fill_color: fill,
    style_stroke_color: stroke,
    style_fill_opacity: clampNumber(rawStyle.fillOpacity ?? rawStyle.style_fill_opacity ?? fallbackStyle.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity, 0, 1),
    style_stroke_opacity: clampNumber(rawStyle.opacity ?? rawStyle.style_stroke_opacity ?? fallbackStyle.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity, 0, 1),
    style_weight: clampNumber(rawStyle.weight ?? rawStyle.style_weight ?? fallbackStyle.style_weight, DEFAULT_STYLE.style_weight, 0.5, 12),
    style_radius: clampNumber(rawStyle.radius ?? rawStyle.style_radius ?? fallbackStyle.style_radius, DEFAULT_STYLE.style_radius, 2, 30),
  };
}
function categoryDraftsFromAttributeField(field, fallbackStyle) {
  const values = Array.isArray(field?.values) ? field.values : [];
  return values.slice(0, 60).map((item, index) => normalizeCategoryDraft({
    value: item.value,
    label: item.label || categoryLabel(item.value),
    style: { color: categoryPaletteColor(index), strokeColor: categoryPaletteColor(index), fillColor: categoryPaletteColor(index) },
  }, index, fallbackStyle));
}
function categoryDraftsFromField(layer, fieldName, fallbackStyle) {
  return categoryDraftsFromAttributeField(findAttributeField(layer, fieldName), fallbackStyle);
}
function bestCategoryField(fields, preferredField = "") {
  if (!Array.isArray(fields) || !fields.length) return null;
  const preferred = findAttributeFieldInList(fields, preferredField);
  if (preferred?.values?.length) return preferred;
  return fields.find((field) => field.suitable && Array.isArray(field.values) && field.values.length > 1)
    || fields.find((field) => Array.isArray(field.values) && field.values.length > 1)
    || fields.find((field) => Array.isArray(field.values) && field.values.length)
    || fields[0];
}
function categoriesLookAutoGenerated(categories) {
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.every((category) => {
    const value = normalizeCategoryValue(category?.value);
    const label = String(category?.label || "").trim();
    return value === "__empty__" && (!label || /^Catégorie \d+$/.test(label) || /^Valeur \d+$/.test(label));
  });
}
function shouldAutofillCategorizedDraft(draft) {
  return !String(draft?.style_category_field || "").trim() || categoriesLookAutoGenerated(draft?.style_categories);
}
function autoCategorizedStylePatchFromMetadata(draft, metadata, { force = false } = {}) {
  const fields = attributeFieldsFromMetadata(metadata);
  const selected = bestCategoryField(fields, draft?.style_category_field);
  if (!selected?.name) return null;
  if (!force && !shouldAutofillCategorizedDraft(draft)) return null;
  const categories = categoryDraftsFromAttributeField(selected, draft);
  if (!categories.length) return null;
  return {
    style_mode: "categorized",
    style_category_field: selected.name,
    style_categories: categories,
  };
}

function getLayerStyle(layer) {
  const style = metadataStyle(layer);
  const stroke = layer?.style_stroke_color || layer?.style_color || style.strokeColor || style.color || DEFAULT_STYLE.style_stroke_color;
  const fill = layer?.style_fill_color || style.fillColor || style.fill || layer?.style_color || DEFAULT_STYLE.style_fill_color;
  return {
    style_fill_color: fill,
    style_stroke_color: stroke,
    style_fill_opacity: clampNumber(layer?.style_fill_opacity ?? style.fillOpacity, DEFAULT_STYLE.style_fill_opacity, 0, 1),
    style_stroke_opacity: clampNumber(layer?.style_stroke_opacity ?? style.opacity, DEFAULT_STYLE.style_stroke_opacity, 0, 1),
    style_weight: clampNumber(layer?.style_weight ?? style.weight, DEFAULT_STYLE.style_weight, 0.5, 12),
    style_radius: clampNumber(layer?.style_radius ?? style.radius, DEFAULT_STYLE.style_radius, 2, 30),
    style_mode: style.mode === "categorized" ? "categorized" : "single",
    style_category_field: style.categoryField || "",
    style_categories: Array.isArray(style.categories) ? style.categories.map((category, index) => normalizeCategoryDraft(category, index, { style_fill_color: fill, style_stroke_color: stroke, style_fill_opacity: style.fillOpacity, style_stroke_opacity: style.opacity, style_weight: style.weight, style_radius: style.radius })) : [],
  };
}
function getGeometryType(layer) {
  const direct = String(layer?.geometry_type || layer?.geometryType || "").toLowerCase();
  if (["point", "multipoint"].includes(direct)) return "point";
  if (["line", "linestring", "multilinestring"].includes(direct)) return "line";
  if (["polygon", "multipolygon"].includes(direct)) return "polygon";
  const types = metadataObject(layer).geometry_types;
  const values = types && typeof types === "object" ? Object.keys(types) : Array.isArray(types) ? types : [];
  const normalized = values.map((value) => String(value).toLowerCase());
  if (normalized.length && normalized.every((value) => ["point", "multipoint"].includes(value))) return "point";
  if (normalized.length && normalized.every((value) => ["line", "linestring", "multilinestring"].includes(value))) return "line";
  if (normalized.length && normalized.every((value) => ["polygon", "multipolygon"].includes(value))) return "polygon";
  return "mixed";
}
function geometryLabel(layer) {
  const type = getGeometryType(layer);
  return type === "point" ? "Points" : type === "line" ? "Lignes" : type === "polygon" ? "Polygones" : "Mixte / inconnu";
}
function metadataValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function metadataRows(layer) {
  const metadata = metadataObject(layer);
  const rows = METADATA_FIELDS.map(([key, label]) => [label, metadata[key]]).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (layer?.processing_error) rows.push(["Erreur traitement", layer.processing_error]);
  else if (metadata.processing_error) rows.push(["Erreur traitement", metadata.processing_error]);
  if (metadata.bounds_wgs84) rows.push(["Bounds WGS84", metadata.bounds_wgs84]);
  if (metadata.geometry_types) rows.push(["Types géométrie", metadata.geometry_types]);
  return rows;
}
function layerDisplayMessage(layer) {
  if (layer?.display_message || layer?.displayMessage || layer?.processing_error) return layer.display_message || layer.displayMessage || layer.processing_error;
  if (layer?.is_active === false) return "Couche masquée côté client. Réactivez-la pour l’afficher.";
  if (layer?.available === false) return "Couche non prête ou mal configurée.";
  return "";
}
function validateUrl(value, label) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (!parsed.protocol.startsWith("http")) return `${label} doit utiliser une URL HTTP ou HTTPS.`;
    return "";
  } catch {
    return `${label} est invalide.`;
  }
}
function validateHexColor(value, label = "La couleur") {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || "")) ? "" : `${label} doit être au format #RRGGBB.`;
}
function validateNumberRange(value, label, min, max) {
  const number = Number(normalizeDecimal(value));
  if (!Number.isFinite(number)) return `${label} doit être numérique.`;
  if (number < min || number > max) return `${label} doit être entre ${min} et ${max}.`;
  return "";
}
function validateCategoryDraft(category, index) {
  return validateHexColor(category.style_fill_color, `La couleur de remplissage de la catégorie ${index + 1}`)
    || validateHexColor(category.style_stroke_color, `La couleur de bordure/ligne de la catégorie ${index + 1}`)
    || validateNumberRange(category.style_fill_opacity, `L’opacité de remplissage de la catégorie ${index + 1}`, 0, 1)
    || validateNumberRange(category.style_stroke_opacity, `L’opacité de bordure/ligne de la catégorie ${index + 1}`, 0, 1)
    || validateNumberRange(category.style_weight, `L’épaisseur de la catégorie ${index + 1}`, 0.5, 12)
    || validateNumberRange(category.style_radius, `La taille des points de la catégorie ${index + 1}`, 2, 30);
}
function validateVectorStyle(style) {
  const baseError = validateHexColor(style.style_fill_color, "La couleur de remplissage vectoriel")
    || validateHexColor(style.style_stroke_color, "La couleur de bordure/ligne vectorielle")
    || validateNumberRange(style.style_fill_opacity, "L’opacité de remplissage", 0, 1)
    || validateNumberRange(style.style_stroke_opacity, "L’opacité de bordure/ligne", 0, 1)
    || validateNumberRange(style.style_weight, "L’épaisseur de ligne/bordure", 0.5, 12)
    || validateNumberRange(style.style_radius, "La taille des points", 2, 30);
  if (baseError) return baseError;
  if (style.style_mode === "categorized") {
    if (!String(style.style_category_field || "").trim()) return "Choisissez l’attribut de catégorisation.";
    if (!Array.isArray(style.style_categories) || !style.style_categories.length) return "Ajoutez au moins une catégorie détectée pour cette symbologie.";
    for (let index = 0; index < style.style_categories.length; index += 1) {
      const categoryError = validateCategoryDraft(style.style_categories[index], index);
      if (categoryError) return categoryError;
    }
  }
  return "";
}
function validateCommonSettings(settings) {
  return validateNumberRange(settings.opacity, "L’opacité générale", 0, 1)
    || validateNumberRange(settings.z_index, "Le z-index", -1000, 1000)
    || validateNumberRange(settings.min_zoom, "Le zoom min", 0, 24)
    || validateNumberRange(settings.max_zoom, "Le zoom max", 0, 24)
    || (toNumber(settings.max_zoom, 22) < toNumber(settings.min_zoom, 0) ? "Le zoom max doit être supérieur ou égal au zoom min." : "");
}
function validateForm(form) {
  if (!form.name.trim()) return "Renseignez un nom de couche.";
  const settingsError = validateCommonSettings(form);
  if (settingsError) return settingsError;
  if (isStyledVector(form)) {
    const styleError = validateVectorStyle(form);
    if (styleError) return styleError;
  }
  if (needsServiceUrl(form)) {
    if (!form.service_url.trim()) return "L’URL du service WFS est obligatoire.";
    const urlError = validateUrl(form.service_url, "L’URL WFS");
    if (urlError) return urlError;
  }
  if (isWms(form) && form.service_url.trim()) {
    const urlError = validateUrl(form.service_url, "L’URL GeoServer WMS");
    if (urlError) return urlError;
  }
  if (needsServiceLayerName(form) && !form.service_layers.trim()) return `Le nom de couche ${isWms(form) ? "GeoServer WMS" : "WFS"} est obligatoire.`;
  if (isPostgis(form)) {
    if (!form.postgis_table.trim()) return "Choisissez la table ou vue PostGIS à importer dans le portefeuille.";
    const limitError = validateNumberRange(form.postgis_limit, "La limite d’import PostGIS", 1, 200000);
    if (limitError) return limitError;
  }
  return "";
}
function numericPayload(value, fallback) {
  return toNumber(value, fallback);
}
function buildPayload(form) {
  const payload = {
    ...form,
    layer_type: isPostgis(form) ? "geojson" : form.data_format,
    source_kind: isWms(form) ? "service" : "database",
    opacity: numericPayload(form.opacity, 1),
    z_index: numericPayload(form.z_index, 1),
    min_zoom: numericPayload(form.min_zoom, 0),
    max_zoom: numericPayload(form.max_zoom, 22),
  };
  if (isStyledVector(form)) {
    payload.style_color = form.style_stroke_color;
    payload.style_fill_color = form.style_fill_color;
    payload.style_stroke_color = form.style_stroke_color;
    payload.style_fill_opacity = numericPayload(form.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity);
    payload.style_stroke_opacity = numericPayload(form.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity);
    payload.style_weight = numericPayload(form.style_weight, DEFAULT_STYLE.style_weight);
    payload.style_radius = numericPayload(form.style_radius, DEFAULT_STYLE.style_radius);
  } else {
    delete payload.file;
    delete payload.source_crs;
    delete payload.style_color;
    delete payload.style_fill_color;
    delete payload.style_stroke_color;
    delete payload.style_fill_opacity;
    delete payload.style_stroke_opacity;
    delete payload.style_weight;
    delete payload.style_radius;
    delete payload.style_mode;
    delete payload.style_category_field;
    delete payload.style_categories;
  }
  if (!isWms(form)) {
    delete payload.wms_crs;
    delete payload.wms_version;
  }
  if (!isWfs(form)) delete payload.wfs_version;
  if (!isPostgis(form)) {
    delete payload.postgis_host; delete payload.postgis_port; delete payload.postgis_database; delete payload.postgis_username; delete payload.postgis_password;
    delete payload.postgis_schema; delete payload.postgis_table; delete payload.postgis_geometry_column; delete payload.postgis_id_column;
    delete payload.postgis_source_srid; delete payload.postgis_where_clause; delete payload.postgis_limit;
  }
  if (!needsServiceUrl(form) && !isWms(form)) {
    delete payload.service_url;
    delete payload.service_layers;
  }
  if (isWms(form) && !String(payload.service_url || "").trim()) delete payload.service_url;
  return payload;
}
function noticeFor(form) {
  if (isWms(form)) return "WMS servi par GeoServer/proxy sécurisé : la classification se gère côté GeoServer/SLD, pas comme une couche vectorielle locale.";
  if (isWfs(form)) return "WFS importé en base PostGIS à la création, puis stylable comme une couche vectorielle PostGIS.";
  if (isPostgis(form)) return "";
  return "";
}
function postgisPreviewPayload(form) {
  return {
    postgis_host: form.postgis_host,
    postgis_port: form.postgis_port,
    postgis_database: form.postgis_database,
    postgis_username: form.postgis_username,
    postgis_password: form.postgis_password,
    postgis_schema: form.postgis_schema,
    postgis_table: form.postgis_table,
    postgis_geometry_column: form.postgis_geometry_column,
    postgis_id_column: form.postgis_id_column,
    postgis_source_srid: form.postgis_source_srid,
    postgis_where_clause: form.postgis_where_clause,
    postgis_limit: Math.min(toNumber(form.postgis_limit, LOCAL_POSTGIS_DEFAULTS.limit), 5000),
  };
}
function wfsPreviewPayload(form) {
  return {
    service_url: form.service_url,
    service_layers: form.service_layers,
    wfs_version: form.wfs_version,
    limit: 5000,
  };
}
function stylePayload(style) {
  const payload = {
    style_color: style.style_stroke_color,
    style_fill_color: style.style_fill_color,
    style_stroke_color: style.style_stroke_color,
    style_fill_opacity: numericPayload(style.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity),
    style_stroke_opacity: numericPayload(style.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity),
    style_weight: numericPayload(style.style_weight, DEFAULT_STYLE.style_weight),
    style_radius: numericPayload(style.style_radius, DEFAULT_STYLE.style_radius),
    style_mode: style.style_mode === "categorized" ? "categorized" : "single",
    style_category_field: style.style_category_field || "",
  };
  if (Array.isArray(style.style_categories)) {
    payload.style_categories = style.style_categories.map((category) => ({
      value: normalizeCategoryValue(category.value),
      label: displayCategoryLabel(category),
      style: {
        color: category.style_stroke_color,
        strokeColor: category.style_stroke_color,
        fillColor: category.style_fill_color,
        fill: category.style_fill_color,
        opacity: numericPayload(category.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity),
        fillOpacity: numericPayload(category.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity),
        weight: numericPayload(category.style_weight, DEFAULT_STYLE.style_weight),
        radius: numericPayload(category.style_radius, DEFAULT_STYLE.style_radius),
      },
    }));
  }
  return payload;
}
function settingsPayload(settings) {
  return {
    opacity: numericPayload(settings.opacity, 1),
    z_index: numericPayload(settings.z_index, 1),
    min_zoom: numericPayload(settings.min_zoom, 0),
    max_zoom: numericPayload(settings.max_zoom, 22),
  };
}
function getLayerSettings(layer) {
  return {
    opacity: clampNumber(layer?.opacity, 1, 0, 1),
    z_index: toNumber(layer?.z_index, 1),
    min_zoom: clampNumber(layer?.min_zoom, 0, 0, 24),
    max_zoom: clampNumber(layer?.max_zoom, 22, 0, 24),
  };
}
function getLayerInfo(layer) {
  return {
    name: layer?.name || "",
    description: layer?.description || "",
  };
}
function infoPayload(info) {
  return {
    name: String(info.name || "").trim(),
    description: String(info.description || "").trim(),
  };
}
function validateLayerInfo(info) {
  if (!String(info.name || "").trim()) return "Renseignez un nom de couche.";
  if (String(info.name || "").trim().length > 160) return "Le nom de couche est trop long.";
  return "";
}
function styleModeLabel(layer) {
  return getLayerStyle(layer).style_mode === "categorized" ? "Catégorisé" : "Style unique";
}
function sourceLabel(layer) {
  if (isPostgis(layer)) return "PostGIS";
  return layer.layer_type_label || getMapLayerTypeLabel(layer.layer_type || layer.type || layer.service || "postgis");
}
function dataLabel(layer) {
  return layer.data_format_label || getMapLayerDataFormatLabel(layer.data_format || layer.dataFormat || layer.service || "postgis");
}
function visibilityLabel(layer) {
  if (isClientVisible(layer)) return { label: "Visible client", className: "bg-green-50 text-green-700 border-green-100" };
  if (layer.is_active === false) return { label: "Masquée client", className: "bg-slate-50 text-slate-700 border-slate-200" };
  return { label: "Non visible", className: "bg-amber-50 text-amber-700 border-amber-100" };
}

function Field({ label, children, className = "" }) {
  return <label className={`min-w-0 space-y-1.5 ${className}`}><span className="block truncate text-xs font-extrabold uppercase tracking-wide text-mapgeo-secondary/70" title={label}>{label}</span>{children}</label>;
}
function NumberField({ label, value, onChange, min, max, step = "0.01", disabled = false, suffix = "" }) {
  return (
    <Field label={label}>
      <div className="flex min-w-0 items-center gap-2">
        <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={smallInputClass("min-w-0 disabled:opacity-50")} />
        {suffix ? <span className="min-w-fit text-xs font-bold text-mapgeo-secondary/65">{suffix}</span> : null}
      </div>
    </Field>
  );
}
function ColorField({ label, value, onChange, disabled = false }) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-11 w-full rounded-xl border border-mapgeo-line bg-white p-1 disabled:opacity-50" />
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} className={smallInputClass("font-mono uppercase disabled:opacity-50")} />
      </div>
    </Field>
  );
}
function VectorPreview({ style, geometryType = "mixed" }) {
  const fillOpacity = clampNumber(style.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity, 0, 1);
  const strokeOpacity = clampNumber(style.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity, 0, 1);
  const weight = clampNumber(style.style_weight, DEFAULT_STYLE.style_weight, 0.5, 12);
  const radius = clampNumber(style.style_radius, DEFAULT_STYLE.style_radius, 2, 30);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/45 px-3 py-2">
      {geometryType !== "line" ? (
        <span
          className="shrink-0 rounded-full border bg-white"
          style={{
            width: `${Math.min(32, Math.max(12, radius * 2))}px`,
            height: `${Math.min(32, Math.max(12, radius * 2))}px`,
            borderColor: style.style_stroke_color,
            borderWidth: `${Math.min(4, Math.max(1, weight / 2))}px`,
            backgroundColor: style.style_fill_color,
            opacity: Math.max(fillOpacity, strokeOpacity),
          }}
        />
      ) : null}
      {geometryType !== "point" ? (
        <span className="h-0 w-16 rounded-full" style={{ borderTop: `${Math.max(2, weight)}px solid ${style.style_stroke_color}`, opacity: strokeOpacity }} />
      ) : null}
      {geometryType !== "point" && geometryType !== "line" ? (
        <span
          className="h-7 w-12 rounded-md border"
          style={{
            borderColor: style.style_stroke_color,
            borderWidth: `${Math.min(4, Math.max(1, weight / 2))}px`,
            backgroundColor: style.style_fill_color,
            opacity: Math.max(fillOpacity, strokeOpacity),
          }}
        />
      ) : null}
      <span className="min-w-0 text-xs font-bold text-mapgeo-secondary/70">Aperçu</span>
    </div>
  );
}

function VectorStyleFields({ value, onChange, geometryType = "mixed", compact = false, disabled = false }) {
  const update = (key, nextValue) => onChange({ ...value, [key]: nextValue });
  const lineLabel = geometryType === "line" ? "Épaisseur ligne" : "Épaisseur bordure/ligne";
  return (
    <div className={`rounded-3xl border border-mapgeo-line bg-white ${compact ? "p-4" : "p-5 lg:col-span-2"}`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary"><Palette size={16} /> Style</div>
        <VectorPreview style={value} geometryType={geometryType} />
      </div>
      <div className={`grid grid-cols-1 gap-3 ${compact ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        <ColorField label="Remplissage" value={value.style_fill_color} disabled={disabled} onChange={(next) => update("style_fill_color", next)} />
        <ColorField label="Bordure / ligne" value={value.style_stroke_color} disabled={disabled} onChange={(next) => update("style_stroke_color", next)} />
        <NumberField label="Opacité remplissage" min="0" max="1" step="0.01" value={value.style_fill_opacity} disabled={disabled} onChange={(next) => update("style_fill_opacity", next)} />
        <NumberField label="Opacité bordure / ligne" min="0" max="1" step="0.01" value={value.style_stroke_opacity} disabled={disabled} onChange={(next) => update("style_stroke_opacity", next)} />
        <NumberField label={lineLabel} min="0.5" max="12" step="0.5" value={value.style_weight} disabled={disabled} onChange={(next) => update("style_weight", next)} />
        <NumberField label="Taille des points" min="2" max="30" step="0.5" value={value.style_radius} disabled={disabled} onChange={(next) => update("style_radius", next)} />
      </div>
    </div>
  );
}



function StyleAdvancedDetails({ children, label = "Avancé" }) {
  return (
    <details className="rounded-2xl border border-mapgeo-line bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-extrabold uppercase tracking-[0.14em] text-mapgeo-secondary/70 marker:hidden">
        {label}
      </summary>
      <div className="border-t border-mapgeo-line p-4">{children}</div>
    </details>
  );
}

function normalizeColorLabel(value) {
  return String(value || DEFAULT_GEOJSON_COLOR).toUpperCase();
}

function safeColorInputValue(value) {
  const normalized = normalizeColorLabel(value);
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_GEOJSON_COLOR;
}


function CompactColorControl({ label, value, onChange, disabled = false }) {
  const colorValue = safeColorInputValue(value);
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-mapgeo-secondary/60">{label}</span>
      <div className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
        <input
          type="color"
          value={colorValue}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-full cursor-pointer rounded-xl border border-mapgeo-line bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className={smallInputClass("min-w-0 h-10 px-3 py-2 font-mono text-xs uppercase disabled:opacity-50")}
        />
      </div>
    </label>
  );
}

function CategoryInlineStyleControls({ category, geometryType, update, disabled = false }) {
  const sizeLabel = geometryType === "point" ? "Taille" : "Épaisseur";
  const sizeKey = geometryType === "point" ? "style_radius" : "style_weight";
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      <NumberField label="Opacité fond" min="0" max="1" step="0.01" value={category.style_fill_opacity} disabled={disabled} onChange={(next) => update("style_fill_opacity", next)} />
      <NumberField label="Opacité trait" min="0" max="1" step="0.01" value={category.style_stroke_opacity} disabled={disabled} onChange={(next) => update("style_stroke_opacity", next)} />
      <NumberField
        label={sizeLabel}
        min={geometryType === "point" ? "2" : "0.5"}
        max={geometryType === "point" ? "30" : "12"}
        step="0.5"
        value={category[sizeKey]}
        disabled={disabled}
        onChange={(next) => update(sizeKey, next)}
      />
    </div>
  );
}

function CategorizedDefaultStyle({ value, onChange, geometryType = "mixed", disabled = false, onApplyToCategories = null }) {
  const sizeLabel = geometryType === "point" ? "Taille des points" : "Épaisseur du trait";
  const sizeKey = geometryType === "point" ? "style_radius" : "style_weight";
  const update = (key, nextValue) => onChange({ ...value, [key]: nextValue });
  return (
    <div className="rounded-2xl border border-mapgeo-line bg-slate-50/70 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-mapgeo-secondary/60">Style par défaut</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-mapgeo-secondary/70">
            Utilisé pour les nouvelles catégories. Les couleurs restent pilotées par chaque valeur.
          </p>
        </div>
        {onApplyToCategories ? (
          <button
            type="button"
            onClick={onApplyToCategories}
            disabled={disabled}
            className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50"
          >
            Appliquer aux catégories
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <NumberField label="Opacité remplissage" min="0" max="1" step="0.01" value={value.style_fill_opacity} disabled={disabled} onChange={(next) => update("style_fill_opacity", next)} />
        <NumberField label="Opacité trait" min="0" max="1" step="0.01" value={value.style_stroke_opacity} disabled={disabled} onChange={(next) => update("style_stroke_opacity", next)} />
        <NumberField
          label={sizeLabel}
          min={geometryType === "point" ? "2" : "0.5"}
          max={geometryType === "point" ? "30" : "12"}
          step="0.5"
          value={value[sizeKey]}
          disabled={disabled}
          onChange={(next) => update(sizeKey, next)}
        />
      </div>
    </div>
  );
}

function CategoryPreview({ category, geometryType }) {
  const fillOpacity = clampNumber(category.style_fill_opacity, DEFAULT_STYLE.style_fill_opacity, 0, 1);
  const strokeOpacity = clampNumber(category.style_stroke_opacity, DEFAULT_STYLE.style_stroke_opacity, 0, 1);
  const weight = clampNumber(category.style_weight, DEFAULT_STYLE.style_weight, 0.5, 12);
  if (geometryType === "point") {
    return <span className="inline-flex h-5 w-5 rounded-full border" style={{ borderColor: category.style_stroke_color, borderWidth: `${Math.min(3, Math.max(1, weight / 2))}px`, backgroundColor: category.style_fill_color, opacity: Math.max(fillOpacity, strokeOpacity) }} />;
  }
  if (geometryType === "line") {
    return <span className="inline-flex h-0 w-14 rounded-full" style={{ borderTop: `${Math.max(2, weight)}px solid ${category.style_stroke_color}`, opacity: strokeOpacity }} />;
  }
  return <span className="inline-flex h-6 w-16 rounded-md border" style={{ borderColor: category.style_stroke_color, borderWidth: `${Math.min(3, Math.max(1, weight / 2))}px`, backgroundColor: category.style_fill_color, opacity: Math.max(fillOpacity, strokeOpacity) }} />;
}

function CategoryColorCell({ value, onChange, disabled = false }) {
  const colorValue = safeColorInputValue(value);
  return (
    <div className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-2">
      <input
        type="color"
        value={colorValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="h-9 w-full cursor-pointer rounded-lg border border-mapgeo-line bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Couleur"
      />
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="min-w-0 rounded-lg border border-mapgeo-line bg-white px-2 py-2 font-mono text-xs font-bold uppercase text-mapgeo-primary outline-none transition focus:border-mapgeo-primary disabled:opacity-50"
        aria-label="Code couleur"
      />
    </div>
  );
}

function CategoryStyleRow({ category, index, geometryType, onChange, onRemove = null, disabled = false }) {
  const update = (key, nextValue) => onChange(index, { ...category, [key]: nextValue });
  const rawValueLabel = categoryLabel(category.value);
  const labelText = displayCategoryLabel(category);
  const showRawValue = labelText && normalizeFieldName(labelText) !== normalizeFieldName(rawValueLabel);
  return (
    <div className="border-t border-mapgeo-line first:border-t-0">
      <div className="grid min-w-0 grid-cols-[44px_minmax(170px,1.1fr)_minmax(150px,1fr)_minmax(150px,1fr)_90px] items-center gap-3 px-3 py-2.5">
        <span className="text-xs font-black text-mapgeo-secondary/70">{index + 1}</span>
        <div className="min-w-0">
          <input
            value={category.label}
            disabled={disabled}
            onChange={(event) => update("label", event.target.value)}
            className="w-full min-w-0 rounded-lg border border-mapgeo-line bg-white px-3 py-2 text-sm font-extrabold text-mapgeo-primary outline-none transition focus:border-mapgeo-primary disabled:opacity-50"
            aria-label="Libellé légende"
          />
          {showRawValue ? <div className="mt-1 truncate text-[11px] font-semibold text-mapgeo-secondary/55" title={rawValueLabel}>Source : {rawValueLabel}</div> : null}
        </div>
        <CategoryColorCell value={category.style_fill_color} disabled={disabled} onChange={(next) => update("style_fill_color", next)} />
        <CategoryColorCell value={category.style_stroke_color} disabled={disabled} onChange={(next) => update("style_stroke_color", next)} />
        <div className="flex items-center justify-between gap-2">
          <CategoryPreview category={category} geometryType={geometryType} />
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-xs font-black text-mapgeo-secondary hover:bg-mapgeo-ivory marker:hidden">•••</summary>
            <div className="absolute right-0 z-20 mt-2 w-[320px] rounded-2xl border border-mapgeo-line bg-white p-3 shadow-panel">
              <CategoryInlineStyleControls category={category} geometryType={geometryType} update={update} disabled={disabled} />
            </div>
          </details>
          {onRemove ? <button type="button" onClick={() => onRemove(index)} disabled={disabled} className="rounded-lg p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50" aria-label="Supprimer la catégorie"><Trash2 size={14} /></button> : null}
        </div>
      </div>
    </div>
  );
}

function ManualCategoryStyleRow({ category, index, geometryType, onChange, onRemove = null, disabled = false }) {
  const update = (key, nextValue) => onChange(index, { ...category, [key]: nextValue });
  return (
    <div className="border-t border-mapgeo-line first:border-t-0">
      <div className="grid min-w-0 grid-cols-[44px_minmax(130px,0.9fr)_minmax(150px,1fr)_minmax(140px,0.9fr)_minmax(140px,0.9fr)_90px] items-center gap-3 px-3 py-2.5">
        <span className="text-xs font-black text-mapgeo-secondary/70">{index + 1}</span>
        <input
          value={category.value === "__empty__" ? "" : category.value}
          disabled={disabled}
          onChange={(event) => update("value", event.target.value)}
          className="w-full min-w-0 rounded-lg border border-mapgeo-line bg-white px-3 py-2 text-sm font-bold text-mapgeo-primary outline-none transition focus:border-mapgeo-primary disabled:opacity-50"
          placeholder="Valeur source"
          aria-label="Valeur"
        />
        <input
          value={category.label}
          disabled={disabled}
          onChange={(event) => update("label", event.target.value)}
          className="w-full min-w-0 rounded-lg border border-mapgeo-line bg-white px-3 py-2 text-sm font-extrabold text-mapgeo-primary outline-none transition focus:border-mapgeo-primary disabled:opacity-50"
          placeholder="Libellé"
          aria-label="Libellé légende"
        />
        <CategoryColorCell value={category.style_fill_color} disabled={disabled} onChange={(next) => update("style_fill_color", next)} />
        <CategoryColorCell value={category.style_stroke_color} disabled={disabled} onChange={(next) => update("style_stroke_color", next)} />
        <div className="flex items-center justify-between gap-2">
          <CategoryPreview category={category} geometryType={geometryType} />
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-xs font-black text-mapgeo-secondary hover:bg-mapgeo-ivory marker:hidden">•••</summary>
            <div className="absolute right-0 z-20 mt-2 w-[320px] rounded-2xl border border-mapgeo-line bg-white p-3 shadow-panel">
              <CategoryInlineStyleControls category={category} geometryType={geometryType} update={update} disabled={disabled} />
            </div>
          </details>
          {onRemove ? <button type="button" onClick={() => onRemove(index)} disabled={disabled} className="rounded-lg p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50" aria-label="Supprimer la catégorie"><Trash2 size={14} /></button> : null}
        </div>
      </div>
    </div>
  );
}

function CategoryListHeader({ count, manual = false }) {
  return (
    // <div className="overflow-hidden rounded-2xl border border-mapgeo-line bg-white">
    <div>
      <div className="flex flex-col gap-1 border-b border-mapgeo-line bg-slate-50 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        {/* <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-mapgeo-secondary/60">Catégories</p>
          <p className="mt-1 text-sm font-extrabold text-mapgeo-primary">{count} valeur{count > 1 ? "s" : ""} configurée{count > 1 ? "s" : ""}</p>
        </div>
        <p className="text-xs font-semibold text-mapgeo-secondary/65">Couleurs visibles en tableau. Opacité et dimensions dans le menu •••.</p> */}
      </div>
      <div className={`hidden border-b border-mapgeo-line bg-mapgeo-ivory/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mapgeo-secondary/60 xl:grid ${manual ? "grid-cols-[44px_minmax(130px,0.9fr)_minmax(150px,1fr)_minmax(140px,0.9fr)_minmax(140px,0.9fr)_90px" : "grid-cols-[44px_minmax(170px,1.1fr)_minmax(150px,1fr)_minmax(150px,1fr)_90px"} gap-3`}>
        {/* <span>#</span>
        {manual ? <span>Valeur source</span> : null}
        <span>Valeur</span>
        <span>Remplissage</span>
        <span>Trait</span>
        <span>Aperçu</span> */}
      </div>
    </div>
  );
}

function ManualCategorizedSymbologyPanel({ draft, onChange, geometryType = "mixed", disabled = false, metadata = null, previewLoading = false, previewError = "", onRequestPreview = null }) {
  const mode = draft.style_mode === "categorized" ? "categorized" : "single";
  const fields = attributeFieldsFromMetadata(metadata);
  const selectedField = findAttributeFieldInList(fields, draft.style_category_field);
  const categories = Array.isArray(draft.style_categories) ? draft.style_categories : [];
  const hasTablePreview = Boolean(metadata?.preview || metadata?.attribute_fields);
  const update = (patch) => onChange({ ...draft, ...patch });

  const createCategory = (index = categories.length) => normalizeCategoryDraft({
    value: "",
    label: `Valeur ${index + 1}`,
    style: { color: categoryPaletteColor(index), strokeColor: categoryPaletteColor(index), fillColor: categoryPaletteColor(index) },
  }, index, draft);

  const applyDetectedCategories = (force = true) => {
    const patch = autoCategorizedStylePatchFromMetadata(draft, metadata, { force });
    if (patch) {
      update(patch);
      return true;
    }
    return false;
  };

  const handleModeChange = (modeValue) => {
    if (modeValue !== "categorized") {
      update({ style_mode: "single" });
      return;
    }
    if (applyDetectedCategories(true)) return;
    if (typeof onRequestPreview === "function") onRequestPreview({ autoCategorize: true });
    update({
      style_mode: "categorized",
      style_category_field: draft.style_category_field || "",
      style_categories: categoriesLookAutoGenerated(categories) ? [] : categories,
    });
  };

  const handleFieldChange = (fieldName) => {
    const field = findAttributeFieldInList(fields, fieldName);
    update({
      style_mode: "categorized",
      style_category_field: fieldName,
      style_categories: field ? categoryDraftsFromAttributeField(field, draft) : categories,
    });
  };

  const regenerateDetectedCategories = () => {
    if (applyDetectedCategories(true)) return;
    if (typeof onRequestPreview === "function") onRequestPreview({ autoCategorize: true });
  };

  const updateCategory = (index, nextCategory) => {
    update({ style_categories: categories.map((category, categoryIndex) => (categoryIndex === index ? nextCategory : category)) });
  };

  const applyDefaultsToCategories = () => {
    const sizeKey = geometryType === "point" ? "style_radius" : "style_weight";
    update({
      style_categories: categories.map((category) => ({
        ...category,
        style_fill_opacity: draft.style_fill_opacity,
        style_stroke_opacity: draft.style_stroke_opacity,
        [sizeKey]: draft[sizeKey],
      })),
    });
  };

  const addCategory = () => {
    update({ style_mode: "categorized", style_categories: [...categories, createCategory(categories.length)] });
  };

  const removeCategory = (index) => {
    update({ style_categories: categories.filter((_, categoryIndex) => categoryIndex !== index) });
  };

  return (
    <div className="rounded-2xl border border-mapgeo-line bg-white p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-end">
        <Field label="Type de symbologie">
          <select value={mode} disabled={disabled} onChange={(event) => handleModeChange(event.target.value)} className={smallInputClass("disabled:opacity-50")}>{STYLE_MODE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </Field>
        {mode === "categorized" ? (
          <Field label="Nombre de catégories">
            <div className="flex h-[42px] items-center rounded-xl border border-mapgeo-line bg-mapgeo-ivory/35 px-3 text-sm font-extrabold text-mapgeo-primary">
              {categories.length} valeur{categories.length > 1 ? "s" : ""}
            </div>
          </Field>
        ) : null}
      </div>

      {mode === "single" ? (
        <div className="mt-4">
          <p className="mb-3 text-xs font-semibold leading-5 text-mapgeo-secondary/70">Un seul style s’applique à toute la couche importée.</p>
          <VectorStyleFields value={draft} onChange={onChange} geometryType={geometryType} compact disabled={disabled} />
        </div>
      ) : null}

      {mode === "categorized" ? (
        <div className="mt-4 space-y-4">
          {(previewLoading || previewError) ? (
            <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-mapgeo-secondary/70">
              {previewLoading ? <span className="inline-flex items-center gap-2 rounded-full border border-mapgeo-line bg-white px-3 py-1.5"><Loader2 size={14} className="animate-spin" /> Analyse…</span> : null}
              {!previewLoading && previewError ? <span className="inline-flex items-center gap-2 rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-amber-800"><AlertTriangle size={14} /> {previewError}</span> : null}
            </div>
          ) : null}

          {fields.length ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <Field label="Attribut de catégorisation">
                <select value={draft.style_category_field || ""} disabled={disabled} onChange={(event) => handleFieldChange(event.target.value)} className={smallInputClass("disabled:opacity-50")}>
                  <option value="">Détection automatique</option>
                  {fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.label || field.name} · {field.unique_count} valeur{field.unique_count > 1 ? "s" : ""}{field.suitable ? "" : " · à vérifier"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={regenerateDetectedCategories} disabled={disabled || previewLoading} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">
                  {previewLoading ? "Préparation…" : "Auto"}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <Field label="Attribut de catégorisation">
                <input value={draft.style_category_field || ""} disabled={disabled} onChange={(event) => update({ style_category_field: event.target.value })} className={smallInputClass("disabled:opacity-50")} placeholder="ex. type_zone, classe, occupation" />
              </Field>
              <button type="button" onClick={() => onRequestPreview?.({ autoCategorize: true })} disabled={disabled || previewLoading} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">
                {previewLoading ? "Préparation…" : hasTablePreview ? "Relancer la détection" : "Détecter depuis la table"}
              </button>
            </div>
          )}

          {selectedField?.truncated ? (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">Valeurs principales uniquement.</div>
          ) : null}

          <CategorizedDefaultStyle value={draft} onChange={onChange} geometryType={geometryType} disabled={disabled} onApplyToCategories={categories.length ? applyDefaultsToCategories : null} />

          <div className="space-y-2">
            <CategoryListHeader count={categories.length} manual={!fields.length} />
            {categories.length ? categories.map((category, index) => (
              fields.length ? (
                <CategoryStyleRow key={`${category.value}-${index}`} category={category} index={index} geometryType={geometryType} disabled={disabled} onChange={updateCategory} onRemove={removeCategory} />
              ) : (
                <ManualCategoryStyleRow key={`${category.value}-${index}`} category={category} index={index} geometryType={geometryType} disabled={disabled} onChange={updateCategory} onRemove={removeCategory} />
              )
            )) : (
              <div className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-xs font-bold text-mapgeo-secondary/70">Aucune valeur.</div>
            )}
            {!fields.length ? (
              <button type="button" onClick={addCategory} disabled={disabled} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">Ajouter une valeur</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CategorizedSymbologyPanel({ layer, draft, onChange, geometryType, disabled = false }) {
  const fields = attributeFields(layer);
  const update = (patch) => onChange({ ...draft, ...patch });
  const selectedField = findAttributeField(layer, draft.style_category_field);
  const fieldValues = selectedField?.values || [];
  const mode = draft.style_mode === "categorized" ? "categorized" : "single";
  const categories = Array.isArray(draft.style_categories) ? draft.style_categories : [];

  const handleModeChange = (modeValue) => {
    if (modeValue !== "categorized") {
      update({ style_mode: "single" });
      return;
    }
    const firstRelevantField = fields.find((field) => field.suitable) || fields[0];
    const nextFieldName = draft.style_category_field || firstRelevantField?.name || "";
    update({
      style_mode: "categorized",
      style_category_field: nextFieldName,
      style_categories: nextFieldName && !categories.length ? categoryDraftsFromField(layer, nextFieldName, draft) : categories,
    });
  };

  const handleFieldChange = (fieldName) => {
    update({
      style_mode: "categorized",
      style_category_field: fieldName,
      style_categories: categoryDraftsFromField(layer, fieldName, draft),
    });
  };

  const updateCategory = (index, nextCategory) => {
    update({ style_categories: categories.map((category, categoryIndex) => (categoryIndex === index ? nextCategory : category)) });
  };

  const applyDefaultsToCategories = () => {
    const sizeKey = geometryType === "point" ? "style_radius" : "style_weight";
    update({
      style_categories: categories.map((category) => ({
        ...category,
        style_fill_opacity: draft.style_fill_opacity,
        style_stroke_opacity: draft.style_stroke_opacity,
        [sizeKey]: draft[sizeKey],
      })),
    });
  };

  const removeCategory = (index) => {
    update({ style_categories: categories.filter((_, categoryIndex) => categoryIndex !== index) });
  };

  const createManualCategory = (index = categories.length) => normalizeCategoryDraft({
    value: "",
    label: `Valeur ${index + 1}`,
    style: { color: categoryPaletteColor(index), strokeColor: categoryPaletteColor(index), fillColor: categoryPaletteColor(index) },
  }, index, draft);

  const addManualCategory = () => {
    update({ style_mode: "categorized", style_categories: [...categories, createManualCategory(categories.length)] });
  };

  const regenerateCategories = () => {
    update({ style_categories: categoryDraftsFromField(layer, draft.style_category_field, draft) });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-mapgeo-line bg-white p-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Field label="Type de symbologie">
          <select value={mode} disabled={disabled} onChange={(event) => handleModeChange(event.target.value)} className={smallInputClass("disabled:opacity-50")}>{STYLE_MODE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </Field>
        {mode === "categorized" ? (
          <>
            <Field label="Attribut">
              {fields.length ? (
                <select value={draft.style_category_field || ""} disabled={disabled} onChange={(event) => handleFieldChange(event.target.value)} className={smallInputClass("disabled:opacity-50")}>
                  <option value="">Choisir un attribut</option>
                  {fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.label || field.name} · {field.unique_count} valeur{field.unique_count > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={draft.style_category_field || ""} disabled={disabled} onChange={(event) => update({ style_category_field: event.target.value })} className={smallInputClass("disabled:opacity-50")} placeholder="ex. type_zone, classe, occupation" />
              )}
            </Field>
            <Field label="Catégories">
              <div className="flex h-[42px] items-center justify-between gap-2 rounded-xl border border-mapgeo-line bg-mapgeo-ivory/35 px-3 text-sm font-extrabold text-mapgeo-primary">
                <span>{categories.length} valeur{categories.length > 1 ? "s" : ""}</span>
                <button type="button" onClick={regenerateCategories} disabled={disabled || !draft.style_category_field || (fields.length && !fieldValues.length)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">Auto</button>
              </div>
            </Field>
          </>
        ) : null}
      </div>

      {mode === "single" ? (
        <div>
          <p className="mb-3 text-xs font-semibold leading-5 text-mapgeo-secondary/70">Un seul style s’applique à toute la couche.</p>
          <VectorStyleFields value={draft} onChange={onChange} geometryType={geometryType} compact disabled={disabled} />
        </div>
      ) : null}

      {mode === "categorized" ? (
        <div className="space-y-4">
          {!fields.length ? <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">Aucun attribut détecté. Vous pouvez saisir l’attribut et les valeurs manuellement.</div> : null}
          {selectedField?.truncated ? <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">Valeurs principales uniquement.</div> : null}
          <CategorizedDefaultStyle value={draft} onChange={onChange} geometryType={geometryType} disabled={disabled} onApplyToCategories={categories.length ? applyDefaultsToCategories : null} />
          <div className="space-y-2">
            <CategoryListHeader count={categories.length} manual={!fields.length} />
            {categories.length ? categories.map((category, index) => (
              fields.length ? (
                <CategoryStyleRow key={`${category.value}-${index}`} category={category} index={index} geometryType={geometryType} disabled={disabled} onChange={updateCategory} onRemove={removeCategory} />
              ) : (
                <ManualCategoryStyleRow key={`${category.value}-${index}`} category={category} index={index} geometryType={geometryType} disabled={disabled} onChange={updateCategory} onRemove={removeCategory} />
              )
            )) : (
              <div className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-xs font-bold text-mapgeo-secondary/70">Aucune valeur configurée.</div>
            )}
            {!fields.length ? (
              <button type="button" onClick={addManualCategory} disabled={disabled} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">Ajouter une valeur</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeleteLayerDialog({ layer, loading, onCancel, onConfirm }) {
  if (!layer) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-mapgeo-primary/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="delete-layer-title">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] border border-mapgeo-line bg-white p-5 shadow-panel sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-red-700">Suppression définitive</p>
            <h3 id="delete-layer-title" className="mt-1 text-xl font-extrabold text-mapgeo-primary">Supprimer cette couche ?</h3>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-full border border-mapgeo-line p-2 text-mapgeo-secondary hover:bg-mapgeo-ivory disabled:opacity-50"><X size={16} /></button>
        </div>
        <p className="mt-4 text-sm leading-6 text-mapgeo-secondary/80">La couche « <strong>{layer.name}</strong> » sera supprimée du client.</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-2xl border border-mapgeo-line px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">Annuler</button>
          <button type="button" onClick={onConfirm} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-700 px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

function VectorLayerStyleEditor({ layer, loading, onSave }) {
  const [draft, setDraft] = useState(() => getLayerStyle(layer));

  useEffect(() => {
    setDraft(getLayerStyle(layer));
  }, [layer]);

  const currentStyle = getLayerStyle(layer);
  const hasChanges = JSON.stringify(stylePayload(draft)) !== JSON.stringify(stylePayload(currentStyle));
  const geometryType = getGeometryType(layer);

  return (
    <div className="space-y-3">
      <CategorizedSymbologyPanel layer={layer} draft={draft} onChange={setDraft} geometryType={geometryType} disabled={loading} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={() => onSave(layer, draft)}
          disabled={loading || !hasChanges}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Palette size={14} />} Enregistrer la symbologie
        </button>
      </div>
    </div>
  );
}

function LayerInfoEditor({ layer, loading, onSave }) {
  const [draft, setDraft] = useState(() => getLayerInfo(layer));

  useEffect(() => {
    setDraft(getLayerInfo(layer));
  }, [layer]);

  const currentInfo = getLayerInfo(layer);
  const hasChanges = JSON.stringify(infoPayload(draft)) !== JSON.stringify(infoPayload(currentInfo));
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-3 rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/40 p-4">
      <div className="flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary"><PencilLine size={16} /> Informations</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,0.9fr)_1fr]">
        <Field label="Nom de couche"><input value={draft.name} disabled={loading} onChange={(event) => update("name", event.target.value)} className={smallInputClass("disabled:opacity-50")} /></Field>
        <Field label="Description"><input value={draft.description} disabled={loading} onChange={(event) => update("description", event.target.value)} className={smallInputClass("disabled:opacity-50")} placeholder="Description courte côté client" /></Field>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(layer, draft)}
          disabled={loading || !hasChanges}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Enregistrer les infos
        </button>
      </div>
    </div>
  );
}

function LayerSettingsEditor({ layer, loading, onSave }) {
  const [draft, setDraft] = useState(() => getLayerSettings(layer));

  useEffect(() => {
    setDraft(getLayerSettings(layer));
  }, [layer]);

  const currentSettings = getLayerSettings(layer);
  const hasChanges = JSON.stringify(settingsPayload(draft)) !== JSON.stringify(settingsPayload(currentSettings));
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-3 rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/40 p-4">
      <div className="flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary"><SlidersHorizontal size={16} /> Réglages portail</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField label="Opacité générale" min="0" max="1" step="0.05" value={draft.opacity} disabled={loading} onChange={(next) => update("opacity", next)} />
        <NumberField label="Z-index" min="-1000" max="1000" step="1" value={draft.z_index} disabled={loading} onChange={(next) => update("z_index", next)} />
        <NumberField label="Zoom min" min="0" max="24" step="1" value={draft.min_zoom} disabled={loading} onChange={(next) => update("min_zoom", next)} />
        <NumberField label="Zoom max" min="0" max="24" step="1" value={draft.max_zoom} disabled={loading} onChange={(next) => update("max_zoom", next)} />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(layer, draft)}
          disabled={loading || !hasChanges}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-xs font-extrabold text-mapgeo-primary hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Enregistrer les réglages
        </button>
      </div>
    </div>
  );
}

function TechnicalDetails({ layer, open = false }) {
  const rows = metadataRows(layer);
  if (!rows.length) return null;
  return (
    <details open={open} className="mt-3 rounded-2xl border border-mapgeo-line bg-white/80 px-4 py-3">
      <summary className="cursor-pointer list-none text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/70 marker:hidden">
        Technique
      </summary>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl bg-mapgeo-ivory/55 px-3 py-2">
            <dt className="font-extrabold uppercase tracking-wide text-mapgeo-secondary/60">{label}</dt>
            <dd className="mt-1 break-words font-semibold text-mapgeo-primary" title={metadataValue(value)}>{metadataValue(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function LayerBadge({ children, className = "" }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-extrabold ${className}`}>{children}</span>;
}

function LayerSummaryTile({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/45 px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-mapgeo-secondary/55">{label}</p>
      <p className="mt-1 truncate text-sm font-extrabold text-mapgeo-primary" title={String(value || "—")}>{value || "—"}</p>
    </div>
  );
}

function LayerActionButton({ active = false, danger = false, children, className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50";
  const variant = danger
    ? "border-red-100 bg-white text-red-700 hover:bg-red-50"
    : active
      ? "border-mapgeo-primary bg-mapgeo-primary text-white shadow-soft"
      : "border-mapgeo-line bg-white text-mapgeo-primary hover:bg-mapgeo-ivory";
  return <button type="button" className={`${base} ${variant} ${className}`} {...props}>{children}</button>;
}

function LayerEditorShell({ title, subtitle, tabs, activeTab, onTabChange, children }) {
  return (
    <div className="mt-4 overflow-visible rounded-3xl border border-mapgeo-line bg-white shadow-[0_12px_32px_rgba(15,23,42,0.04)] md:overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line bg-mapgeo-ivory/40 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-extrabold text-mapgeo-primary">{title}</p>
          {subtitle ? <p className="mt-1 text-xs font-semibold leading-5 text-mapgeo-secondary/65">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onTabChange(value)}
              className={`rounded-2xl px-3 py-2 text-xs font-extrabold transition ${activeTab === value ? "bg-mapgeo-primary text-white shadow-soft" : "border border-mapgeo-line bg-white text-mapgeo-primary hover:bg-mapgeo-ivory"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function LayerCard({ layer, toggling, infoSaving, styleSaving, settingsSaving, onToggle, onSaveInfo, onSaveStyle, onSaveSettings, onDelete }) {
  const [editor, setEditor] = useState(null);
  const cfg = statusConfig(layer);
  const visibility = visibilityLabel(layer);
  const message = layerDisplayMessage(layer);
  const isVector = isVectorLayer(layer);
  const geometry = isVector ? geometryLabel(layer) : "Service";
  const styleLabel = isVector ? styleModeLabel(layer) : "Service distant";
  const sourceName = sourceLabel(layer);
  const dataName = dataLabel(layer);
  const source = sourceName === dataName ? sourceName : `${sourceName} · ${dataName}`;
  const displayLabel = `z ${layer.z_index ?? 1} · zoom ${layer.min_zoom ?? 0}–${layer.max_zoom ?? 22} · opacité ${layer.opacity ?? 1}`;
  const editorButtons = [
    ["general", "Général"],
    ...(isVector ? [["style", "Symbologie"]] : []),
    ["display", "Affichage"],
    ["technical", "Technique"],
  ];
  const openEditor = (nextEditor) => setEditor((current) => (current === nextEditor ? null : nextEditor));

  return (
    <article className="overflow-visible rounded-3xl border border-mapgeo-line bg-white shadow-soft md:overflow-hidden">
      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-[minmax(160px,1.1fr)_120px_120px_140px_minmax(190px,1.1fr)_130px_105px_280px] items-center gap-3 border-b border-mapgeo-line bg-mapgeo-ivory/35 px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mapgeo-secondary/60">
          <span>Couche</span>
          <span>Source</span>
          <span>Géométrie</span>
          <span>Style</span>
          <span>Affichage</span>
          <span>Visibilité</span>
          <span>État</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="grid min-w-[980px] grid-cols-[minmax(160px,1.1fr)_120px_120px_140px_minmax(190px,1.1fr)_130px_105px_280px] items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded bg-mapgeo-primary" />
              <span className="truncate font-extrabold text-mapgeo-primary" title={layer.name}>{layer.name}</span>
            </div>
            {layer.description ? <p className="mt-1 truncate text-xs font-semibold text-mapgeo-secondary/60" title={layer.description}>{layer.description}</p> : null}
          </div>
          <span className="font-bold text-mapgeo-primary">{source}</span>
          <span className="font-bold text-mapgeo-primary">{geometry}</span>
          <span className="font-bold text-mapgeo-primary">{styleLabel}</span>
          <span className="truncate font-semibold text-mapgeo-secondary/80" title={displayLabel}>{displayLabel}</span>
          <span className="inline-flex w-fit items-center rounded-full border border-green-100 bg-green-50 px-3 py-1 text-xs font-extrabold text-green-700">{isClientVisible(layer) ? "Visible" : visibility.label}</span>
          <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-extrabold ${cfg.className}`}>{cfg.label}</span>
          <div className="flex justify-end gap-2">
            {isVector ? (
              <LayerActionButton active={editor === "style"} onClick={() => openEditor("style")} className="px-3 py-2">
                <Palette size={14} /> Configurer
              </LayerActionButton>
            ) : null}
            <LayerActionButton
              active={editor === "general"}
              onClick={() => openEditor("general")}
              className="px-3 py-2"
              title="Informations"
              aria-label="Modifier les informations de la couche"
            >
              <PencilLine size={14} />
              <span className="hidden 2xl:inline">Infos</span>
            </LayerActionButton>
            <LayerActionButton
              active={editor === "display"}
              onClick={() => openEditor("display")}
              className="px-3 py-2"
              title="Affichage"
              aria-label="Modifier les paramètres d'affichage"
            >
              <SlidersHorizontal size={14} />
              <span className="hidden 2xl:inline">Affichage</span>
            </LayerActionButton>
            <LayerActionButton
              onClick={() => onToggle(layer)}
              disabled={toggling}
              className="px-3 py-2"
              title="Autoriser ou masquer côté client"
              aria-label="Autoriser ou masquer cette couche côté client"
            >
              {toggling ? (
                <Loader2 size={14} className="animate-spin" />
              ) : layer.is_active === false ? (
                <Eye size={14} />
              ) : (
                <EyeOff size={14} />
              )}
              <span className="hidden 2xl:inline">
                {layer.is_active === false ? "Autoriser" : "Masquer"}
              </span>
            </LayerActionButton>
            <LayerActionButton
              danger
              onClick={() => onDelete(layer)}
              className="px-3 py-2"
              title="Supprimer"
              aria-label="Supprimer la couche"
            >
              <Trash2 size={14} />
              <span className="hidden 2xl:inline">Supprimer</span>
            </LayerActionButton>
          </div>
        </div>
      </div>

      {message ? (
        <div className={`mx-4 mb-4 rounded-2xl border px-4 py-3 text-xs font-bold leading-5 ${layer.available === false && layer.is_active !== false ? "border-amber-100 bg-amber-50 text-amber-800" : "border-mapgeo-line bg-white text-mapgeo-secondary"}`}>
          <Info size={14} className="mr-1 inline" />{message}
        </div>
      ) : null}

      {editor ? (
        <div className="border-t border-mapgeo-line p-4">
          <LayerEditorShell
            title={`Configuration : ${layer.name}`}
            subtitle="Modifiez uniquement la section nécessaire. Les paramètres techniques restent isolés."
            tabs={editorButtons}
            activeTab={editor}
            onTabChange={setEditor}
          >
            {editor === "general" ? <LayerInfoEditor layer={layer} loading={infoSaving} onSave={onSaveInfo} /> : null}
            {editor === "style" && isVector ? <VectorLayerStyleEditor layer={layer} loading={styleSaving} onSave={onSaveStyle} /> : null}
            {editor === "display" ? <LayerSettingsEditor layer={layer} loading={settingsSaving} onSave={onSaveSettings} /> : null}
            {editor === "technical" ? <TechnicalDetails layer={layer} open /> : null}
          </LayerEditorShell>
        </div>
      ) : null}
    </article>
  );
}

export default function AdminMapLayersPanel({ clientId }) {
  const [layers, setLayers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [infoSavingId, setInfoSavingId] = useState(null);
  const [styleSavingId, setStyleSavingId] = useState(null);
  const [settingsSavingId, setSettingsSavingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [postgisPreview, setPostgisPreview] = useState(null);
  const [postgisPreviewLoading, setPostgisPreviewLoading] = useState(false);
  const [postgisPreviewError, setPostgisPreviewError] = useState("");
  const [postgisTables, setPostgisTables] = useState([]);
  const [postgisTablesLoading, setPostgisTablesLoading] = useState(false);
  const [postgisTablesLoaded, setPostgisTablesLoaded] = useState(false);
  const [postgisTablesError, setPostgisTablesError] = useState("");
  const [serviceCapabilities, setServiceCapabilities] = useState(null);
  const [serviceCapabilitiesLoading, setServiceCapabilitiesLoading] = useState(false);
  const [serviceCapabilitiesError, setServiceCapabilitiesError] = useState("");
  const fileInputRef = useRef(null);
  const postgisPreviewRequestRef = useRef(0);
  const serviceCapabilitiesRequestRef = useRef(0);

  const activeCount = useMemo(() => layers.filter((layer) => layer.is_active !== false).length, [layers]);
  const visibleCount = useMemo(() => layers.filter(isClientVisible).length, [layers]);
  const serviceCapabilityLayers = useMemo(() => (Array.isArray(serviceCapabilities?.layers) ? serviceCapabilities.layers : []), [serviceCapabilities]);
  const selectedServiceLayers = useMemo(() => selectedServiceLayerNames(form), [form.service_layers]);
  const postgisTableOptions = useMemo(() => postgisTables.map(normalizePostgisTableOption).filter(Boolean), [postgisTables]);

  const loadLayers = useCallback(async () => {
    if (!clientId) return;
    setLoading(true); setError("");
    try { setLayers(await mapLayerService.adminListLayers(clientId)); }
    catch (loadError) { setError(getErrorMessage(loadError, "Impossible de charger les couches cartographiques privées du client.")); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { loadLayers(); }, [loadLayers]);


  const loadPostgisTables = useCallback(async () => {
    if (!clientId) return;

    setPostgisTablesLoading(true);
    setPostgisTablesError("");

    try {
      const response = await mapLayerService.adminListPostgisTables(clientId);
      setPostgisTables(Array.isArray(response?.tables) ? response.tables : []);
      setPostgisTablesLoaded(true);
    } catch (tablesError) {
      setPostgisTables([]);
      setPostgisTablesLoaded(true);
      setPostgisTablesError(getErrorMessage(tablesError, "Impossible de charger les tables PostGIS disponibles."));
    } finally {
      setPostgisTablesLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadPostgisTables(); }, [loadPostgisTables]);

  useEffect(() => {
    const handleFocus = () => loadPostgisTables();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadPostgisTables]);


  function refreshDashboardSources() {
    loadLayers();
    loadPostgisTables();
  }

  function resetServiceCapabilities() {
    serviceCapabilitiesRequestRef.current += 1;
    setServiceCapabilities(null);
    setServiceCapabilitiesError("");
    setServiceCapabilitiesLoading(false);
  }

  async function loadServiceCapabilities() {
    if (!clientId || !needsServiceLayerName(form)) return;
    setServiceCapabilitiesError("");

    if (isWfs(form) && !String(form.service_url || "").trim()) {
      setServiceCapabilities(null);
      setServiceCapabilitiesError("Renseignez l’URL WFS avant d’interroger GetCapabilities.");
      return;
    }
    if (String(form.service_url || "").trim()) {
      const urlError = validateUrl(form.service_url, isWms(form) ? "L’URL WMS" : "L’URL WFS");
      if (urlError) {
        setServiceCapabilities(null);
        setServiceCapabilitiesError(urlError);
        return;
      }
    }

    const requestId = serviceCapabilitiesRequestRef.current + 1;
    serviceCapabilitiesRequestRef.current = requestId;
    setServiceCapabilitiesLoading(true);
    try {
      const capabilities = await mapLayerService.adminGetCapabilities(clientId, capabilityRequestPayload(form));
      if (serviceCapabilitiesRequestRef.current !== requestId) return;
      const layersList = Array.isArray(capabilities?.layers) ? capabilities.layers : [];
      setServiceCapabilities({ ...capabilities, layers: layersList });
      if (!layersList.length) {
        setServiceCapabilitiesError(`Aucune couche ${isWms(form) ? "WMS" : "WFS"} trouvée dans GetCapabilities.`);
      }
    } catch (capabilitiesError) {
      if (serviceCapabilitiesRequestRef.current !== requestId) return;
      setServiceCapabilities(null);
      setServiceCapabilitiesError(getErrorMessage(capabilitiesError, "Impossible d’interroger GetCapabilities."));
    } finally {
      if (serviceCapabilitiesRequestRef.current === requestId) setServiceCapabilitiesLoading(false);
    }
  }

  function handleServiceUrlChange(value) {
    resetServiceCapabilities();
    setPostgisPreview(null);
    setPostgisPreviewError("");
    setForm((current) => ({
      ...current,
      service_url: value,
      service_layers: "",
      style_category_field: "",
      style_categories: current.style_mode === "categorized" ? [] : current.style_categories,
    }));
  }

  function handleServiceVersionChange(field, value) {
    resetServiceCapabilities();
    setPostgisPreview(null);
    setPostgisPreviewError("");
    setForm((current) => ({
      ...current,
      [field]: value,
      service_layers: "",
      style_category_field: "",
      style_categories: current.style_mode === "categorized" ? [] : current.style_categories,
    }));
  }

  function handleManualServiceLayersChange(value) {
    setPostgisPreview(null);
    setPostgisPreviewError("");
    setForm((current) => ({
      ...current,
      service_layers: value,
      style_category_field: "",
      style_categories: current.style_mode === "categorized" ? [] : current.style_categories,
    }));
  }

  function handleCapabilityLayerSelection(capabilityLayer, checked = true, { single = false } = {}) {
    const layerName = String(capabilityLayer?.name || "").trim();
    if (!layerName) return;
    setPostgisPreview(null);
    setPostgisPreviewError("");
    setForm((current) => {
      const currentNames = selectedServiceLayerNames(current);
      let nextNames = single ? [layerName] : currentNames;
      if (!single) {
        nextNames = checked
          ? Array.from(new Set([...currentNames, layerName]))
          : currentNames.filter((item) => item !== layerName);
      }
      const patch = {
        service_layers: nextNames.join(","),
        style_category_field: "",
        style_categories: current.style_mode === "categorized" ? [] : current.style_categories,
      };
      if (!String(current.name || "").trim() && nextNames.length === 1) {
        patch.name = serviceCapabilityTitle(capabilityLayer);
      }
      return { ...current, ...patch };
    });
  }

  const loadSourcePreview = useCallback(async (sourceForm, { autoCategorize = false } = {}) => {
    const isPostgisSource = isPostgis(sourceForm);
    const isWfsSource = isWfs(sourceForm);
    const hasPostgisSource = isPostgisSource && String(sourceForm.postgis_table || "").trim();
    const hasWfsSource = isWfsSource && String(sourceForm.service_url || "").trim() && String(sourceForm.service_layers || "").trim();
    if (!clientId || (!hasPostgisSource && !hasWfsSource)) {
      setPostgisPreview(null);
      setPostgisPreviewError("");
      return null;
    }
    const requestId = postgisPreviewRequestRef.current + 1;
    postgisPreviewRequestRef.current = requestId;
    setPostgisPreviewLoading(true);
    setPostgisPreviewError("");
    try {
      const metadata = isWfsSource
        ? await mapLayerService.adminPreviewWfs(clientId, wfsPreviewPayload(sourceForm))
        : await mapLayerService.adminPreviewPostgis(clientId, postgisPreviewPayload(sourceForm));
      if (postgisPreviewRequestRef.current !== requestId) return metadata;
      setPostgisPreview(metadata);
      if (autoCategorize || sourceForm.style_mode === "categorized") {
        setForm((current) => {
          if (isPostgisSource && (!isPostgis(current) || current.postgis_table !== sourceForm.postgis_table || current.postgis_schema !== sourceForm.postgis_schema)) return current;
          if (isWfsSource && (!isWfs(current) || current.service_url !== sourceForm.service_url || current.service_layers !== sourceForm.service_layers || current.wfs_version !== sourceForm.wfs_version)) return current;
          const patch = autoCategorizedStylePatchFromMetadata(current, metadata, { force: autoCategorize || shouldAutofillCategorizedDraft(current) });
          return patch ? { ...current, ...patch } : current;
        });
      }
      return metadata;
    } catch (previewError) {
      if (postgisPreviewRequestRef.current === requestId) {
        setPostgisPreview(null);
        const fallbackMessage = isWfsSource ? "Impossible d’analyser automatiquement ce WFS." : "Impossible d’analyser automatiquement cette table PostGIS.";
        setPostgisPreviewError(getErrorMessage(previewError, fallbackMessage));
      }
      return null;
    } finally {
      if (postgisPreviewRequestRef.current === requestId) setPostgisPreviewLoading(false);
    }
  }, [clientId]);

  const sourcePreviewSource = useMemo(() => ({
    data_format: form.data_format,
    postgis_host: form.postgis_host,
    postgis_port: form.postgis_port,
    postgis_database: form.postgis_database,
    postgis_username: form.postgis_username,
    postgis_password: form.postgis_password,
    postgis_schema: form.postgis_schema,
    postgis_table: form.postgis_table,
    postgis_geometry_column: form.postgis_geometry_column,
    postgis_id_column: form.postgis_id_column,
    postgis_source_srid: form.postgis_source_srid,
    postgis_where_clause: form.postgis_where_clause,
    postgis_limit: form.postgis_limit,
    service_url: form.service_url,
    service_layers: form.service_layers,
    wfs_version: form.wfs_version,
    style_mode: form.style_mode,
  }), [
    form.data_format,
    form.postgis_host,
    form.postgis_port,
    form.postgis_database,
    form.postgis_username,
    form.postgis_password,
    form.postgis_schema,
    form.postgis_table,
    form.postgis_geometry_column,
    form.postgis_id_column,
    form.postgis_source_srid,
    form.postgis_where_clause,
    form.postgis_limit,
    form.service_url,
    form.service_layers,
    form.wfs_version,
    form.style_mode,
  ]);

  useEffect(() => {
    const canPreviewPostgis = isPostgis(sourcePreviewSource) && String(sourcePreviewSource.postgis_table || "").trim();
    const canPreviewWfs = isWfs(sourcePreviewSource) && String(sourcePreviewSource.service_url || "").trim() && String(sourcePreviewSource.service_layers || "").trim();
    if (!canPreviewPostgis && !canPreviewWfs) {
      setPostgisPreview(null);
      setPostgisPreviewError("");
      setPostgisPreviewLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadSourcePreview(sourcePreviewSource, { autoCategorize: sourcePreviewSource.style_mode === "categorized" });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [clientId, sourcePreviewSource, loadSourcePreview]);

  function handleTypeChange(value) {
    resetServiceCapabilities();
    setPostgisPreview(null);
    setPostgisPreviewError("");
    setForm((current) => ({
      ...current,
      layer_type: value === "postgis" ? "geojson" : value,
      data_format: value,
      file: null,
      source_crs: "",
      service_url: value === "postgis" ? "" : current.service_url,
      service_layers: value === "postgis" ? "" : current.service_layers,
      postgis_host: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.host : current.postgis_host,
      postgis_port: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.port : current.postgis_port,
      postgis_database: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.database : current.postgis_database,
      postgis_username: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.username : current.postgis_username,
      postgis_schema: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.schema : current.postgis_schema,
      postgis_geometry_column: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.geometryColumn : current.postgis_geometry_column,
      postgis_id_column: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.idColumn : current.postgis_id_column,
      postgis_source_srid: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.sourceSrid : current.postgis_source_srid,
      postgis_limit: value === "postgis" ? LOCAL_POSTGIS_DEFAULTS.limit : current.postgis_limit,
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handlePostgisTableChange(value) {
    const selectedTable = postgisTableOptions.find((option) => option.value === value);

    setPostgisPreview(null);
    setPostgisPreviewError("");

    setForm((current) => ({
      ...current,
      postgis_schema: selectedTable?.schema || current.postgis_schema || LOCAL_POSTGIS_DEFAULTS.schema,
      postgis_table: value,
      postgis_geometry_column: selectedTable?.geometryColumn || "",
      postgis_id_column: selectedTable?.idColumn || "",
      name: !String(current.name || "").trim() && selectedTable?.label ? selectedTable.label : current.name,
      style_category_field: "",
      style_categories: current.style_mode === "categorized" ? [] : current.style_categories,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault(); setMessage(""); setError("");
    const formError = validateForm(form);
    if (formError) { setError(formError); return; }
    setUploading(true);
    try {
      const created = await mapLayerService.adminCreateLayer(clientId, buildPayload(form));
      setLayers((current) => [created, ...current]);
      setForm({ ...emptyForm });
      setPostgisPreview(null);
      setPostgisPreviewError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("Couche ajoutée et rattachée au client.");
    } catch (uploadError) { setError(getErrorMessage(uploadError, "Impossible d’ajouter cette couche.")); }
    finally { setUploading(false); }
  }

  async function toggleLayer(layer) {
    setMessage(""); setError(""); setTogglingId(layer.id);
    const nextActive = layer.is_active === false;
    try {
      const updated = await mapLayerService.adminUpdateLayer(layer.id, { is_active: nextActive });
      setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, ...updated } : item)));
      setMessage(nextActive ? "Couche autorisée côté client." : "Couche masquée côté client.");
    } catch (toggleError) { setError(getErrorMessage(toggleError, "Impossible de modifier la visibilité client.")); }
    finally { setTogglingId(null); }
  }

  async function updateLayerInfo(layer, draftInfo) {
    const infoError = validateLayerInfo(draftInfo);
    if (infoError) { setError(infoError); return; }
    setMessage(""); setError(""); setInfoSavingId(layer.id);
    try {
      const updated = await mapLayerService.adminUpdateLayer(layer.id, infoPayload(draftInfo));
      setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, ...updated } : item)));
      setMessage("Informations de la couche mises à jour.");
    } catch (infoErrorResponse) { setError(getErrorMessage(infoErrorResponse, "Impossible de modifier les informations de la couche.")); }
    finally { setInfoSavingId(null); }
  }

  async function updateLayerStyle(layer, draftStyle) {
    if (!isVectorLayer(layer)) return;
    const styleError = validateVectorStyle(draftStyle);
    if (styleError) { setError(styleError); return; }
    setMessage(""); setError(""); setStyleSavingId(layer.id);
    try {
      const updated = await mapLayerService.adminUpdateLayer(layer.id, stylePayload(draftStyle));
      setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, ...updated } : item)));
      setMessage("Symbologie mise à jour.");
    } catch (styleErrorResponse) { setError(getErrorMessage(styleErrorResponse, "Impossible de modifier le style vectoriel.")); }
    finally { setStyleSavingId(null); }
  }

  async function updateLayerSettings(layer, draftSettings) {
    const settingsError = validateCommonSettings(draftSettings);
    if (settingsError) { setError(settingsError); return; }
    setMessage(""); setError(""); setSettingsSavingId(layer.id);
    try {
      const updated = await mapLayerService.adminUpdateLayer(layer.id, settingsPayload(draftSettings));
      setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, ...updated } : item)));
      setMessage("Réglages portail mis à jour.");
    } catch (settingsErrorResponse) { setError(getErrorMessage(settingsErrorResponse, "Impossible de modifier les réglages portail.")); }
    finally { setSettingsSavingId(null); }
  }

  async function confirmDeleteLayer() {
    if (!deleteTarget) return;
    setMessage(""); setError(""); setDeleting(true);
    try {
      await mapLayerService.adminDeleteLayer(deleteTarget.id);
      setLayers((current) => current.filter((item) => item.id !== deleteTarget.id));
      setMessage("Couche supprimée.");
      setDeleteTarget(null);
    } catch (deleteError) { setError(getErrorMessage(deleteError, "Impossible de supprimer cette couche.")); }
    finally { setDeleting(false); }
  }

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/70">Données privées client</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary"><Layers size={22} /> Couches PostGIS, WFS et WMS</h2>
          <p className="mt-1 text-sm leading-6 text-mapgeo-secondary/75">Couches privées du client : import, visibilité et symbologie.</p>
        </div>
        <button type="button" onClick={refreshDashboardSources} disabled={loading || postgisTablesLoading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-2 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50">
          {loading || postgisTablesLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />} Actualiser
        </button>
      </div>

      <details className="mt-5 overflow-hidden rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/45">
        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 marker:hidden sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-sm font-extrabold text-mapgeo-primary">Ajouter une couche</span>
            <span className="mt-1 block text-xs font-semibold text-mapgeo-secondary/70">Importer une source PostGIS, WFS ou WMS.</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-xs font-extrabold text-mapgeo-primary"><FileUp size={14} /> Ouvrir l’import</span>
        </summary>
        <form onSubmit={handleSubmit} className="space-y-4 border-t border-mapgeo-line p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field label="Nom"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass()} placeholder="Zonage environnemental" required /></Field>
            <Field label="Source"><select value={form.data_format} onChange={(e) => handleTypeChange(e.target.value)} className={inputClass()}>{SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>


          {isPostgis(form) ? (
            <>
              <Field label="Table ou vue à importer">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={form.postgis_table}
                    onChange={(e) => handlePostgisTableChange(e.target.value)}
                    className={inputClass("sm:flex-1")}
                    required
                    disabled={postgisTablesLoading || postgisTableOptions.length === 0}
                  >
                    <option value="" disabled>
                      {postgisTablesLoading ? "Mise à jour…" : postgisTableOptions.length ? "Choisir une table ou une vue" : "Aucune table PostGIS disponible"}
                    </option>
                    {postgisTableOptions.map((option) => (
                      <option key={option.qualifiedName || option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={loadPostgisTables}
                    disabled={postgisTablesLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50"
                  >
                    {postgisTablesLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                    Tables
                  </button>
                </div>

                {postgisTablesError ? (
                  <p className="mt-2 text-xs font-bold text-red-700">{postgisTablesError}</p>
                ) : null}

                {postgisTablesLoaded && !postgisTablesLoading && !postgisTablesError && postgisTableOptions.length === 0 ? (
                  <p className="mt-2 text-xs font-semibold text-mapgeo-secondary/65">
                    Aucune table PostGIS avec géométrie trouvée dans la base configurée.
                  </p>
                ) : null}
              </Field>
              <Field label="Filtre" className="lg:col-span-2"><input value={form.postgis_where_clause} onChange={(e) => setForm({ ...form, postgis_where_clause: e.target.value })} className={inputClass()} placeholder="Exemple : type_zone = 'protected'" /></Field>
              <details className="lg:col-span-2 rounded-3xl border border-mapgeo-line bg-white">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-extrabold text-mapgeo-primary marker:hidden">Paramètres techniques avancés <span className="ml-2 text-xs font-bold text-mapgeo-secondary/60">à ouvrir seulement si la table n’utilise pas les valeurs par défaut</span></summary>
                <div className="grid grid-cols-1 gap-4 border-t border-mapgeo-line p-4 lg:grid-cols-2">
                  <Field label="Schéma"><input value={form.postgis_schema} onChange={(e) => setForm({ ...form, postgis_schema: e.target.value })} className={inputClass()} placeholder={LOCAL_POSTGIS_DEFAULTS.schema} /></Field>
                  <Field label="Colonne géométrique"><input value={form.postgis_geometry_column} onChange={(e) => setForm({ ...form, postgis_geometry_column: e.target.value })} className={inputClass()} placeholder="Auto (geom, geometry, the_geom, wkb_geometry)" /></Field>
                  <Field label="Colonne identifiant"><input value={form.postgis_id_column} onChange={(e) => setForm({ ...form, postgis_id_column: e.target.value })} className={inputClass()} placeholder="Auto (id, gid, fid, ogc_fid) ou vide" /></Field>
                  <Field label="SRID source"><select value={form.postgis_source_srid} onChange={(e) => setForm({ ...form, postgis_source_srid: e.target.value })} className={inputClass()}><option value="auto">Auto</option><option value="4326">EPSG:4326</option><option value="32628">EPSG:32628</option><option value="3857">EPSG:3857</option></select></Field>
                  <Field label="Limite d’import"><input value={form.postgis_limit} onChange={(e) => setForm({ ...form, postgis_limit: e.target.value })} className={inputClass()} inputMode="numeric" /></Field>
                  <Field label="Hôte"><input value={form.postgis_host} onChange={(e) => setForm({ ...form, postgis_host: e.target.value })} className={inputClass()} placeholder={LOCAL_POSTGIS_DEFAULTS.host} /></Field>
                  <Field label="Port"><input value={form.postgis_port} onChange={(e) => setForm({ ...form, postgis_port: e.target.value })} className={inputClass()} placeholder="5432" inputMode="numeric" /></Field>
                  <Field label="Base"><input value={form.postgis_database} onChange={(e) => setForm({ ...form, postgis_database: e.target.value })} className={inputClass()} placeholder={LOCAL_POSTGIS_DEFAULTS.database} /></Field>
                  <Field label="Utilisateur"><input value={form.postgis_username} onChange={(e) => setForm({ ...form, postgis_username: e.target.value })} className={inputClass()} placeholder={LOCAL_POSTGIS_DEFAULTS.username} autoComplete="off" /></Field>
                  <Field label="Mot de passe"><input value={form.postgis_password} onChange={(e) => setForm({ ...form, postgis_password: e.target.value })} className={inputClass()} type="password" placeholder="Utilise .env si vide" autoComplete="new-password" /></Field>
                </div>
              </details>
            </>
          ) : null}

          {needsServiceLayerName(form) ? (
            <>
              <Field label={isWms(form) ? "URL GeoServer WMS (optionnelle)" : "URL du service WFS"} className="lg:col-span-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={form.service_url}
                    onChange={(e) => handleServiceUrlChange(e.target.value)}
                    className={inputClass("sm:flex-1")}
                    placeholder={isWms(form) ? "Vide si GEOSERVER_WMS_URL est configuré" : "https://wfs.example.com/service"}
                  />
                  <button
                    type="button"
                    onClick={loadServiceCapabilities}
                    disabled={serviceCapabilitiesLoading || (isWfs(form) && !String(form.service_url || "").trim())}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-extrabold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:opacity-50"
                  >
                    {serviceCapabilitiesLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />} {serviceCapabilitiesLoading ? "Analyse…" : "Analyser le service"}
                  </button>
                </div>
              </Field>
              <Field label={`Couche${selectedServiceLayers.length > 1 ? "s" : ""} ${isWms(form) ? "WMS" : "WFS"} sélectionnée${selectedServiceLayers.length > 1 ? "s" : ""}`}>
                <input
                  value={form.service_layers}
                  onChange={(e) => handleManualServiceLayersChange(e.target.value)}
                  className={inputClass()}
                  placeholder="Aucune couche par défaut — interroger GetCapabilities puis choisir"
                />
              </Field>
              {isWms(form) ? (
                <>
                  <Field label="Version / CRS WMS">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <select value={form.wms_version} onChange={(e) => handleServiceVersionChange("wms_version", e.target.value)} className={inputClass()}>{WMS_VERSION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                      <select value={form.wms_crs} onChange={(e) => setForm({ ...form, wms_crs: e.target.value })} className={inputClass()}>{WMS_CRS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    </div>
                  </Field>
                  {form.wms_crs && form.wms_crs !== "EPSG:3857" ? (
                    <div className="lg:col-span-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                      <AlertTriangle size={14} className="mr-1 inline shrink-0" />
                      Le proxy WMS interne utilise <strong>EPSG:3857</strong> (Web Mercator) pour l'affichage Leaflet. Si votre serveur WMS ne supporte pas EPSG:3857, le rendu risque d'être incorrect. Privilégiez EPSG:3857 sauf si votre GeoServer supporte la reprojection.
                    </div>
                  ) : null}
                </>
              ) : null}
              {isWfs(form) ? <Field label="Version WFS"><select value={form.wfs_version} onChange={(e) => handleServiceVersionChange("wfs_version", e.target.value)} className={inputClass()}>{WFS_VERSION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field> : null}
              <div className="lg:col-span-2 rounded-3xl border border-mapgeo-line bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-extrabold text-mapgeo-primary">Choix de couche via GetCapabilities</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-mapgeo-secondary/70">
                      Aucune couche n’est choisie automatiquement. Sélectionnez une couche avant d’ajouter la source au portefeuille client.
                    </p>
                  </div>
                  {serviceCapabilities?.count !== undefined ? <span className="rounded-full bg-mapgeo-ivory px-3 py-1 text-xs font-extrabold text-mapgeo-primary">{serviceCapabilities.count} trouvée{serviceCapabilities.count > 1 ? "s" : ""}</span> : null}
                </div>
                {serviceCapabilitiesError ? <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"><AlertTriangle size={14} className="mr-1 inline" />{serviceCapabilitiesError}</div> : null}
                {serviceCapabilityLayers.length ? (
                  <div className="mt-4 space-y-3">
                    <Field label="Menu rapide">
                      <select
                        value={selectedServiceLayers[0] || ""}
                        onChange={(e) => {
                          const selectedLayer = serviceCapabilityLayers.find((item) => item.name === e.target.value);
                          if (selectedLayer) handleCapabilityLayerSelection(selectedLayer, true, { single: true });
                          else handleManualServiceLayersChange("");
                        }}
                        className={inputClass()}
                      >
                        <option value="">Choisir une couche…</option>
                        {serviceCapabilityLayers.map((layer) => <option key={layer.name} value={layer.name}>{serviceCapabilityLabel(layer)}</option>)}
                      </select>
                    </Field>
                    <div className="max-h-64 space-y-2 overflow-auto rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/35 p-3">
                      {serviceCapabilityLayers.map((layer) => {
                        const checked = selectedServiceLayers.includes(layer.name);
                        return (
                          <label key={layer.name} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary shadow-sm">
                            <input type="checkbox" checked={checked} onChange={(e) => handleCapabilityLayerSelection(layer, e.target.checked)} className="mt-1" />
                            <span className="min-w-0">
                              <span className="block truncate font-extrabold" title={serviceCapabilityLabel(layer)}>{serviceCapabilityLabel(layer)}</span>
                              {Array.isArray(layer.crs) && layer.crs.length ? <span className="mt-0.5 block truncate text-xs text-mapgeo-secondary/65">CRS : {layer.crs.slice(0, 4).join(", ")}{layer.crs.length > 4 ? "…" : ""}</span> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : !serviceCapabilitiesLoading && serviceCapabilities ? (
                  <div className="mt-3 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/45 px-3 py-3 text-sm font-semibold text-mapgeo-secondary/75">Aucune couche exploitable n’a été trouvée dans le document GetCapabilities.</div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {noticeFor(form) ? <div className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-semibold leading-6 text-mapgeo-secondary/80"><AlertTriangle size={16} className="mr-2 inline text-amber-700" />{noticeFor(form)}</div> : null}
        {isStyledVector(form) ? (
          <details className="rounded-3xl border border-mapgeo-line bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-extrabold text-mapgeo-primary marker:hidden">Symbologie <span className="ml-2 text-xs font-bold text-mapgeo-secondary/60">couleurs automatiques par défaut</span></summary>
            <div className="space-y-4 border-t border-mapgeo-line p-4">
              <ManualCategorizedSymbologyPanel draft={form} metadata={postgisPreview} previewLoading={postgisPreviewLoading} previewError={postgisPreviewError} onRequestPreview={(options) => loadSourcePreview(form, options)} onChange={(nextStyle) => setForm({ ...form, ...nextStyle })} disabled={uploading} />
            </div>
          </details>
        ) : null}
        <details className="rounded-3xl border border-mapgeo-line bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-extrabold text-mapgeo-primary marker:hidden">Réglages d’affichage avancés <span className="ml-2 text-xs font-bold text-mapgeo-secondary/60">opacité, ordre et niveaux de zoom</span></summary>
          <div className="grid grid-cols-2 gap-3 border-t border-mapgeo-line p-4 md:grid-cols-4">
            <NumberField label="Opacité générale" min="0" max="1" step="0.05" value={form.opacity} onChange={(next) => setForm({ ...form, opacity: next })} />
            <NumberField label="Z-index" min="-1000" max="1000" step="1" value={form.z_index} onChange={(next) => setForm({ ...form, z_index: next })} />
            <NumberField label="Zoom min" min="0" max="24" step="1" value={form.min_zoom} onChange={(next) => setForm({ ...form, min_zoom: next })} />
            <NumberField label="Zoom max" min="0" max="24" step="1" value={form.max_zoom} onChange={(next) => setForm({ ...form, max_zoom: next })} />
          </div>
        </details>
        <div className="flex flex-col justify-end gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex flex-col gap-1 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Autoriser côté client</span>
            <span className="text-xs font-semibold text-mapgeo-secondary/65">Visible seulement si la couche est prête et compatible.</span>
          </label>
          <button type="submit" disabled={uploading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-50">{uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} {uploading ? "Traitement…" : "Ajouter"}</button>
        </div>
        </form>
      </details>

      {error ? <div className="mt-4 rounded-2xl border border-mapgeo-sand/45 bg-mapgeo-sand/10 px-4 py-3 text-sm font-semibold text-mapgeo-primary"><AlertTriangle size={16} className="mr-2 inline" />{error}</div> : null}
      {message ? <div className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-semibold text-mapgeo-primary">{message}</div> : null}

      <div className="mt-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-bold text-mapgeo-secondary/80">{layers.length} couche{layers.length > 1 ? "s" : ""} · {activeCount} autorisée{activeCount > 1 ? "s" : ""} · {visibleCount} visible{visibleCount > 1 ? "s" : ""} côté client</div>
          {loading ? <span className="inline-flex items-center gap-2 text-xs font-bold text-mapgeo-secondary/70"><Loader2 size={14} className="animate-spin" /> Mise à jour</span> : null}
        </div>
        <div className="space-y-3">
          {layers.map((layer) => (
            <LayerCard
              key={layer.id}
              layer={layer}
              toggling={togglingId === layer.id}
              infoSaving={infoSavingId === layer.id}
              styleSaving={styleSavingId === layer.id}
              settingsSaving={settingsSavingId === layer.id}
              onToggle={toggleLayer}
              onSaveInfo={updateLayerInfo}
              onSaveStyle={updateLayerStyle}
              onSaveSettings={updateLayerSettings}
              onDelete={setDeleteTarget}
            />
          ))}
          {!layers.length && !loading ? <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/45 p-6 text-center text-sm font-semibold text-mapgeo-secondary/70">Aucune couche PostGIS, WFS ou WMS pour ce client.</div> : null}
        </div>
      </div>
      <DeleteLayerDialog layer={deleteTarget} loading={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteLayer} />
    </section>
  );
}
