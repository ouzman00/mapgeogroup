import { getMapConfig } from "../../../config/mapConfig";

export const LAYER_GROUPS = [
  { id: "fonds", label: "Fonds de carte" },
  { id: "parcelles", label: "Parcelles" },
  { id: "contexte", label: "Couches SIG" },
  { id: "cadastre", label: "Cadastre" },
  { id: "zonage", label: "Zonage" },
  { id: "risques", label: "Risques" },
  { id: "reseaux", label: "Réseaux" },
  { id: "relief", label: "Relief / MNT" },
  { id: "documents", label: "Documents" },
];

export const COORDINATE_SYSTEMS = [
  { id: "EPSG:32628", label: "Sénégal - WGS 84 / UTM zone 28N" },
  { id: "EPSG:4326", label: "WGS 84" },
  { id: "EPSG:3857", label: "Web Mercator" },
];

function normaliseGroup(value) {
  const group = String(value || "").toLowerCase();
  if (["fonds", "parcelles", "contexte", "cadastre", "zonage", "risques", "reseaux", "réseaux", "relief", "documents"].includes(group)) {
    return group === "réseaux" ? "reseaux" : group;
  }
  if (group.includes("contexte") || group.includes("commune") || group.includes("route") || group.includes("sanitaire") || group.includes("scolaire")) return "contexte";
  if (group.includes("cadastre")) return "cadastre";
  if (group.includes("risque")) return "risques";
  if (group.includes("reseau") || group.includes("réseau")) return "reseaux";
  if (group.includes("relief") || group.includes("mnt") || group.includes("dem") || group.includes("hillshade")) return "relief";
  if (group.includes("document")) return "documents";
  if (group.includes("parcelle")) return "parcelles";
  return "zonage";
}

function normaliseGeometryType(value) {
  const raw = String(value || "").toLowerCase();
  if (["line", "linestring", "multilinestring"].includes(raw)) return "line";
  if (["point", "multipoint"].includes(raw)) return "point";
  if (["polygon", "multipolygon"].includes(raw)) return "polygon";
  return raw;
}

function sourceKind(layer = {}) {
  return String(layer.service || layer.type || layer.dataFormat || layer.data_format || layer.clientLayerType || layer.layerType || layer.metadata?.dataFormat || "").toLowerCase();
}

function isSupportedOperationalSource(layer = {}) {
  const kind = sourceKind(layer);
  const format = String(layer.dataFormat || layer.data_format || layer.metadata?.dataFormat || layer.clientLayerType || layer.layerType || "").toLowerCase();
  return ["geojson", "wfs", "wms"].includes(kind) || ["geojson", "wfs", "wms"].includes(format);
}

function normaliseLegend(layer) {
  if (Array.isArray(layer.legend) && layer.legend.length) return layer.legend;
  const geometryType = normaliseGeometryType(layer.geometryType || layer.geometry_type);
  return [
    {
      label: layer.name || layer.title || "Couche métier",
      symbol: ["wms", "secure-tile"].includes(String(layer.type || layer.service || "").toLowerCase()) || String(layer.dataFormat || layer.data_format || "").toLowerCase() === "wms" ? "image" : geometryType === "line" ? "line" : geometryType === "point" ? "point" : "polygon",
      color: layer.color || "#123B5D",
      fillColor: layer.fillColor,
    },
  ];
}

function normaliseContextLayer(layer, index) {
  const geometryType = normaliseGeometryType(layer.geometryType || layer.geometry_type);
  return {
    id: layer.id || `context-${index}`,
    group: normaliseGroup(layer.group || layer.category),
    type: "geojson",
    service: "geojson",
    clientLayerType: layer.clientLayerType || layer.layerType || layer.metadata?.layerType || "",
    name: layer.name || layer.title || `Couche SIG ${index + 1}`,
    shortName: layer.shortName || layer.name || layer.title,
    visible: layer.visible ?? layer.defaultVisible ?? false,
    available: layer.available !== false,
    order: layer.order ?? 180 + index * 10,
    endpoint: layer.endpoint || layer.url,
    sourceLayerId: layer.sourceLayerId,
    privateLayer: Boolean(layer.privateLayer),
    updatedAt: layer.updatedAt || layer.updated_at || "",
    versionKey: layer.versionKey || layer.updatedAt || layer.updated_at || "",
    authTileEndpoint: layer.authTileEndpoint || layer.tile_endpoint || layer.tileEndpoint || "",
    bounds: layer.bounds || layer.extent,
    dataFormat: layer.dataFormat || layer.data_format || "geojson",
    opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
    minZoom: Number.isFinite(Number(layer.minZoom)) ? Number(layer.minZoom) : undefined,
    maxZoom: Number.isFinite(Number(layer.maxZoom)) ? Number(layer.maxZoom) : 22,
    labelMinZoom: Number.isFinite(Number(layer.labelMinZoom)) ? Number(layer.labelMinZoom) : undefined,
    geometryType,
    style: layer.style || layer.metadata?.style || undefined,
    legend: normaliseLegend({ ...layer, geometryType }),
    metadata: {
      ...(layer.metadata || {}),
      source: layer.source || layer.metadata?.source || "Référentiel SIG",
      date: layer.date || layer.metadata?.date || "Temps réel",
      projection: layer.projection || layer.metadata?.projection || "EPSG:4326 / affichage EPSG:3857",
      owner: layer.owner || layer.metadata?.owner || "Référentiel SIG",
      licence: layer.licence || layer.license || layer.metadata?.licence || "Interne",
      description: layer.description || layer.metadata?.description || "",
      layerType: layer.clientLayerType || layer.layerType || layer.metadata?.layerType || "",
    },
    fields: layer.fields || {},
  };
}

export function buildLayerCatalog(sigLayers = []) {
  const mapConfig = getMapConfig();

  const baseLayers = [
    {
      id: "base-plan",
      group: "fonds",
      type: "base",
      name: "Plan",
      shortName: "Plan",
      visible: true,
      order: 10,
      url: mapConfig.vectorTiles.url,
      opacity: mapConfig.vectorTiles.opacity ?? 1,
      attribution: mapConfig.vectorTiles.attribution,
      maxNativeZoom: mapConfig.vectorTiles.maxNativeZoom ?? 20,
      maxZoom: mapConfig.vectorTiles.maxZoom ?? 22,
      detectRetina: mapConfig.vectorTiles.detectRetina ?? true,
      metadata: {
        source: "OpenStreetMap / CARTO",
        date: "Temps réel",
        projection: "EPSG:3857",
        owner: "OpenStreetMap contributors / CARTO",
        licence: "ODbL / CARTO",
      },
      legend: [{ label: "Plan vectoriel", symbol: "tile", color: "#F7F5F2" }],
    },
    {
      id: "base-satellite",
      group: "fonds",
      type: "base",
      name: "Satellite",
      shortName: "Satellite",
      visible: false,
      order: 20,
      url: mapConfig.satelliteTiles.url,
      opacity: mapConfig.satelliteTiles.opacity ?? 1,
      attribution: mapConfig.satelliteTiles.attribution,
      maxNativeZoom: mapConfig.satelliteTiles.maxNativeZoom ?? 18,
      maxZoom: mapConfig.satelliteTiles.maxZoom ?? 22,
      detectRetina: mapConfig.satelliteTiles.detectRetina ?? false,
      metadata: {
        source: "Google Satellite",
        date: "Selon fournisseur",
        projection: "EPSG:3857",
        owner: "Google",
        licence: "Selon conditions fournisseur",
      },
      legend: [{ label: "Imagerie satellite", symbol: "tile", color: "#C7B299" }],
    },
    {
      id: "base-hybrid",
      group: "fonds",
      type: "base-hybrid",
      name: "Hybride",
      shortName: "Hybride",
      visible: false,
      order: 30,
      url: mapConfig.satelliteTiles.url,
      opacity: mapConfig.satelliteTiles.opacity ?? 1,
      labelUrl: mapConfig.labelTiles.url,
      labelOpacity: mapConfig.labelTiles.opacity ?? 0.96,
      attribution: `${mapConfig.satelliteTiles.attribution} ${mapConfig.labelTiles.attribution}`,
      maxNativeZoom: mapConfig.satelliteTiles.maxNativeZoom ?? 18,
      maxZoom: mapConfig.satelliteTiles.maxZoom ?? 22,
      labelMaxNativeZoom: mapConfig.labelTiles.maxNativeZoom ?? 18,
      labelMaxZoom: mapConfig.labelTiles.maxZoom ?? 22,
      detectRetina: mapConfig.satelliteTiles.detectRetina ?? false,
      labelDetectRetina: mapConfig.labelTiles.detectRetina ?? false,
      metadata: {
        source: "Google Satellite + Google Hybrid labels",
        date: "Selon fournisseur",
        projection: "EPSG:3857",
        owner: "Google",
        licence: "Selon conditions fournisseur",
      },
      legend: [{ label: "Satellite avec libellés", symbol: "tile", color: "#123B5D" }],
    },
    {
      id: "base-relief",
      group: "fonds",
      type: "base",
      name: "OpenStreetMap",
      shortName: "OSM",
      visible: false,
      order: 40,
      url: import.meta.env.VITE_OSM_TILE_URL || import.meta.env.VITE_RELIEF_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: import.meta.env.VITE_OSM_TILE_ATTRIBUTION || import.meta.env.VITE_RELIEF_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors",
      maxNativeZoom: 19,
      maxZoom: 22,
      detectRetina: true,
      metadata: {
        source: "OpenStreetMap Standard",
        date: "Temps réel",
        projection: "EPSG:3857",
        owner: "OpenStreetMap contributors",
        licence: "ODbL",
      },
      legend: [{ label: "Fond OpenStreetMap", symbol: "tile", color: "#F7F5F2" }],
    },
  ];

  const parcelLayers = [
    {
      id: "parcels-portfolio",
      group: "parcelles",
      type: "feature",
      name: "Parcelles",
      visible: true,
      order: 100,
      minZoom: 2,
      maxZoom: 22,
      metadata: {
        source: "Base applicative MAPGEO",
        date: "Temps réel",
        projection: "EPSG:4326 / affichage EPSG:3857",
        owner: "MAPGEO",
        licence: "Interne",
      },
      legend: [{ label: "Parcelle", symbol: "polygon", color: "#123B5D", fillColor: "rgba(199,178,153,0.35)" }],
    },
  ];

  const cadastreUrl = import.meta.env.VITE_CADASTRE_WMS_URL || "";
  const cadastreLayer = cadastreUrl
    ? [
        {
          id: "cadastre-parcels",
          group: "cadastre",
          type: "wms",
          service: "wms",
          name: "Limites cadastrales",
          visible: false,
          order: 150,
          url: cadastreUrl,
          layers: import.meta.env.VITE_CADASTRE_WMS_LAYERS || "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
          format: "image/png",
          transparent: true,
          opacity: 0.7,
          metadata: {
            source: "Cadastre / référentiel parcellaire",
            date: "Selon service WMS",
            projection: "EPSG:3857",
            owner: "Administration / fournisseur WMS",
            licence: "À renseigner",
          },
          legend: [{ label: "Limites cadastrales", symbol: "line", color: "#C7B299" }],
        },
      ]
    : [];

  const externalLayers = (Array.isArray(sigLayers) ? sigLayers : [])
    .filter(isSupportedOperationalSource)
    .map((layer, index) => {
    if (layer?.type === "geojson" || layer?.service === "geojson" || layer?.service === "wfs" || layer?.dataFormat === "wfs" || layer?.endpoint) {
      return normaliseContextLayer(layer, index);
    }
    return {
      id: layer.id || `external-${index}`,
      group: normaliseGroup(layer.group || layer.category),
      type: layer.type || layer.service || "tile",
      service: layer.service,
      sourceLayerId: layer.sourceLayerId,
      privateLayer: Boolean(layer.privateLayer),
      updatedAt: layer.updatedAt || layer.updated_at || "",
      versionKey: layer.versionKey || layer.updatedAt || layer.updated_at || "",
      authTileEndpoint: layer.authTileEndpoint || layer.tile_endpoint || layer.tileEndpoint || "",
        bounds: layer.bounds || layer.extent,
      dataFormat: layer.dataFormat || layer.data_format || "",
      clientLayerType: layer.clientLayerType || layer.layer_type || layer.layerType || "",
      name: layer.name || layer.title || `Couche métier ${index + 1}`,
      visible: layer.visible ?? layer.defaultVisible ?? false,
      order: layer.order ?? 220 + index * 10,
      url: layer.url,
      layers: layer.layers,
      format: layer.format || "image/png",
      transparent: layer.transparent !== false,
      opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 0.7,
      minZoom: Number.isFinite(Number(layer.minZoom)) ? Number(layer.minZoom) : undefined,
      maxZoom: Number.isFinite(Number(layer.maxZoom)) ? Number(layer.maxZoom) : undefined,
      maxNativeZoom: Number.isFinite(Number(layer.maxNativeZoom)) ? Number(layer.maxNativeZoom) : undefined,
      extent: layer.extent || layer.bounds,
      attribution: layer.attribution || "",
      style: layer.style || layer.metadata?.style || undefined,
      legend: normaliseLegend(layer),
      metadata: {
        ...(layer.metadata || {}),
        source: layer.source || layer.metadata?.source || "À renseigner",
        date: layer.date || layer.metadata?.date || "À renseigner",
        projection: layer.projection || layer.metadata?.projection || "EPSG:3857",
        owner: layer.owner || layer.metadata?.owner || "À renseigner",
        licence: layer.licence || layer.license || layer.metadata?.licence || "À renseigner",
        description: layer.description || layer.metadata?.description || "",
        layerType: layer.clientLayerType || layer.layer_type || layer.layerType || layer.metadata?.layerType || "",
        dataFormat: layer.dataFormat || layer.data_format || layer.metadata?.dataFormat || "",
      },
      technicalSheetUrl: layer.technicalSheetUrl || layer.metadataUrl,
    };
  });

  return [...baseLayers, ...parcelLayers, ...cadastreLayer, ...externalLayers];
}

export function isLayerVisibleAtZoom(layer, zoom) {
  if (!Number.isFinite(Number(zoom))) return true;
  if (Number.isFinite(Number(layer.minZoom)) && zoom < Number(layer.minZoom)) return false;
  if (Number.isFinite(Number(layer.maxZoom)) && zoom > Number(layer.maxZoom)) return false;
  return true;
}
