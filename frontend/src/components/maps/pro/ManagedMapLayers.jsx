import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, TileLayer, WMSTileLayer, useMap } from "react-leaflet";
import mapLayerService from "../../../services/mapLayerService";
import { AuthenticatedTileLayer } from "./AuthenticatedRasterLayers";

const MANAGED_LAYER_PANES = {
  context: "mapgeo-context-pane",
  private: "mapgeo-private-layer-pane",
  raster: "mapgeo-managed-raster-pane",
  communes: "mapgeo-communes-pane",
  communeLabels: "mapgeo-communes-label-pane",
};

function isCommuneLayer(layer) {
  const id = String(layer?.id || "").toLowerCase();
  const name = String(layer?.name || "").toLowerCase();
  return id === "communes" || id.includes("commune") || name.includes("commune");
}

function getGeoJsonPane(layer) {
  if (isCommuneLayer(layer)) return MANAGED_LAYER_PANES.communes;
  if (layer?.privateLayer) return MANAGED_LAYER_PANES.private;
  return MANAGED_LAYER_PANES.context;
}

function ensureGeoJsonPanes(map) {
  if (!map?.createPane) return;

  const contextPane = map.getPane(MANAGED_LAYER_PANES.context) || map.createPane(MANAGED_LAYER_PANES.context);
  contextPane.style.zIndex = "360";

  const privatePane = map.getPane(MANAGED_LAYER_PANES.private) || map.createPane(MANAGED_LAYER_PANES.private);
  privatePane.style.zIndex = "410";

  const rasterPane = map.getPane(MANAGED_LAYER_PANES.raster) || map.createPane(MANAGED_LAYER_PANES.raster);
  rasterPane.style.zIndex = "405";

  const communesPane = map.getPane(MANAGED_LAYER_PANES.communes) || map.createPane(MANAGED_LAYER_PANES.communes);
  communesPane.style.zIndex = "370";
  communesPane.style.pointerEvents = "none";

  const communeLabelsPane = map.getPane(MANAGED_LAYER_PANES.communeLabels) || map.createPane(MANAGED_LAYER_PANES.communeLabels);
  communeLabelsPane.style.zIndex = "420";
  communeLabelsPane.style.pointerEvents = "none";
}


function ManagedLayerPaneController() {
  const map = useMap();

  useEffect(() => {
    ensureGeoJsonPanes(map);
  }, [map]);

  return null;
}

function layerKind(layer = {}) {
  return String(layer.service || layer.type || layer.dataFormat || layer.data_format || layer.clientLayerType || "").toLowerCase();
}

function dataFormat(layer = {}) {
  return String(layer.dataFormat || layer.data_format || layer.metadata?.dataFormat || layer.clientLayerType || "").toLowerCase();
}

function isGeoJsonLikeLayer(layer = {}) {
  const kind = layerKind(layer);
  const format = dataFormat(layer);
  return Boolean(layer.endpoint) && (kind === "geojson" || format === "geojson" || format === "wfs");
}

function isWmsLikeLayer(layer = {}) {
  const kind = layerKind(layer);
  const format = dataFormat(layer);
  if (kind === "wms") return Boolean(layer.url && layer.layers);
  return format === "wms" && Boolean(layer.authTileEndpoint || layer.tileEndpoint || layer.tile_endpoint);
}

function isRenderableOperationalLayer(layer) {
  if (!layer || layer.visible === false || layer.available === false) return false;
  if (layer.processing_status && layer.processing_status !== "ready") return false;
  if (layer.type === "feature") return false;
  return isGeoJsonLikeLayer(layer) || isWmsLikeLayer(layer);
}

function renderTileLayer(layer, zIndex, setLayerRuntime, pane = undefined) {
  if (!layer?.url) return null;

  return (
    <TileLayer
      key={layer.id}
      pane={pane}
      url={layer.url}
      opacity={layer.opacity ?? 1}
      attribution={layer.attribution || ""}
      minZoom={layer.minZoom}
      maxZoom={layer.maxZoom ?? 22}
      maxNativeZoom={layer.maxNativeZoom ?? layer.maxZoom ?? 19}
      zIndex={zIndex}
      keepBuffer={layer.keepBuffer ?? 2}
      crossOrigin="anonymous"
      detectRetina={Boolean(layer.detectRetina)}
      updateWhenIdle={layer.updateWhenIdle ?? true}
      updateWhenZooming={false}
      eventHandlers={{
        loading: () => setLayerRuntime(layer.id, { loading: true, error: "" }),
        load: () => setLayerRuntime(layer.id, { loading: false, error: "" }),
        tileerror: () => setLayerRuntime(layer.id, { loading: false, error: layer.privateLayer ? "Erreur couche privée" : "Erreur de chargement" }),
      }}
    />
  );
}

function renderWmsLayer(layer, zIndex, setLayerRuntime, pane = undefined) {
  if (!layer?.url || !layer?.layers) return null;

  return (
    <WMSTileLayer
      key={layer.id}
      pane={pane}
      url={layer.url}
      layers={layer.layers}
      format={layer.format || "image/png"}
      transparent={layer.transparent !== false}
      opacity={layer.opacity ?? 1}
      attribution={layer.attribution || ""}
      minZoom={layer.minZoom}
      maxZoom={layer.maxZoom ?? 22}
      maxNativeZoom={layer.maxNativeZoom ?? layer.maxZoom ?? 19}
      zIndex={zIndex}
      keepBuffer={layer.keepBuffer ?? 2}
      crossOrigin="anonymous"
      detectRetina={Boolean(layer.detectRetina)}
      updateWhenIdle={layer.updateWhenIdle ?? true}
      updateWhenZooming={false}
      eventHandlers={{
        loading: () => setLayerRuntime(layer.id, { loading: true, error: "" }),
        load: () => setLayerRuntime(layer.id, { loading: false, error: "" }),
        tileerror: () => setLayerRuntime(layer.id, { loading: false, error: "Erreur WMS" }),
      }}
    />
  );
}

function getFeatureClassification(feature) {
  return feature?.properties?.classification || "autre";
}

function getRoadStyle(classification) {
  switch (classification) {
    case "route_nationale":
      return { color: "#E11D48", weight: 6.5, opacity: 0.98, lineCap: "round", lineJoin: "round" };
    case "route_regionale":
      return { color: "#F97316", weight: 5.5, opacity: 0.96, lineCap: "round", lineJoin: "round" };
    case "piste":
      return { color: "#A16207", weight: 4.5, opacity: 0.94, dashArray: "8 6", lineCap: "round", lineJoin: "round" };
    case "voie_urbaine":
      return { color: "#2563EB", weight: 4.2, opacity: 0.92, lineCap: "round", lineJoin: "round" };
    default:
      return { color: "#374151", weight: 3.8, opacity: 0.88, lineCap: "round", lineJoin: "round" };
  }
}

function getSanitaryMarkerStyle(classification) {
  switch (classification) {
    case "hopital":
      return {
        radius: 7,
        color: "#DC2626",
        weight: 2,
        opacity: 1,
        fillColor: "#DC2626",
        fillOpacity: 1,
      };
    case "centre_sante":
      return {
        radius: 6.5,
        color: "#F97316",
        weight: 2,
        opacity: 1,
        fillColor: "#F97316",
        fillOpacity: 1,
      };
    case "poste_sante":
      return {
        radius: 6,
        color: "#EC4899",
        weight: 2,
        opacity: 1,
        fillColor: "#EC4899",
        fillOpacity: 1,
      };
    default:
      return {
        radius: 5.5,
        color: "#64748B",
        weight: 2,
        opacity: 1,
        fillColor: "#64748B",
        fillOpacity: 1,
      };
  }
}

function getSchoolMarkerStyle(classification) {
  switch (classification) {
    case "universite":
      return {
        radius: 7,
        color: "#7C3AED",
        weight: 2,
        opacity: 1,
        fillColor: "#7C3AED",
        fillOpacity: 1,
      };
    case "lycee":
      return {
        radius: 6.5,
        color: "#2563EB",
        weight: 2,
        opacity: 1,
        fillColor: "#2563EB",
        fillOpacity: 1,
      };
    case "college":
      return {
        radius: 6,
        color: "#0891B2",
        weight: 2,
        opacity: 1,
        fillColor: "#0891B2",
        fillOpacity: 1,
      };
    case "ecole_primaire":
      return {
        radius: 5.5,
        color: "#16A34A",
        weight: 2,
        opacity: 1,
        fillColor: "#16A34A",
        fillOpacity: 1,
      };
    default:
      return {
        radius: 5.5,
        color: "#64748B",
        weight: 2,
        opacity: 1,
        fillColor: "#64748B",
        fillOpacity: 1,
      };
  }
}

const PRIVATE_LAYER_COLOR = "#FBBF24";
const PRIVATE_LAYER_FILL = "#FBBF24";

function parseStyleNumber(value, fallback, min, max) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getPrivateLayerStyle(layer = {}) {
  const metadataStyle = layer.metadata?.style && typeof layer.metadata.style === "object" ? layer.metadata.style : null;
  const style = layer.style && typeof layer.style === "object" ? layer.style : metadataStyle || {};
  return {
    color: style.strokeColor || style.color || PRIVATE_LAYER_COLOR,
    fillColor: style.fillColor || style.fill || PRIVATE_LAYER_FILL,
    weight: parseStyleNumber(style.weight, undefined, 0.5, 12),
    opacity: parseStyleNumber(style.opacity, undefined, 0, 1),
    fillOpacity: parseStyleNumber(style.fillOpacity, undefined, 0, 1),
    radius: parseStyleNumber(style.radius, undefined, 2, 30),
    dashArray: style.dashArray,
  };
}


function normalizeCategoryValue(value) {
  if (value === null || value === undefined) return "__null__";
  const raw = String(value).trim();
  return raw || "__empty__";
}

function normalizeCategoryStyle(rawStyle = {}, fallbackStyle = {}) {
  const strokeColor = rawStyle.strokeColor || rawStyle.color || fallbackStyle.strokeColor || fallbackStyle.color || PRIVATE_LAYER_COLOR;
  const fillColor = rawStyle.fillColor || rawStyle.fill || fallbackStyle.fillColor || fallbackStyle.fill || strokeColor;
  return {
    ...fallbackStyle,
    ...rawStyle,
    color: strokeColor,
    strokeColor,
    fillColor,
    fill: fillColor,
    weight: parseStyleNumber(rawStyle.weight, fallbackStyle.weight ?? 3, 0.5, 12),
    opacity: parseStyleNumber(rawStyle.opacity, fallbackStyle.opacity ?? 0.9, 0, 1),
    fillOpacity: parseStyleNumber(rawStyle.fillOpacity, fallbackStyle.fillOpacity ?? 0.16, 0, 1),
    radius: parseStyleNumber(rawStyle.radius, fallbackStyle.radius ?? 7, 2, 30),
    dashArray: rawStyle.dashArray ?? fallbackStyle.dashArray,
  };
}

function styleForFeatureCategory(layer = {}, feature, baseStyle = {}) {
  const style = layer.style && typeof layer.style === "object" ? layer.style : layer.metadata?.style || {};
  if (style.mode !== "categorized" || !style.categoryField || !Array.isArray(style.categories)) {
    return baseStyle;
  }
  const props = feature?.properties || {};
  const featureValue = normalizeCategoryValue(getPropertyValueCaseInsensitive(props, style.categoryField));
  const match = style.categories.find((category) => normalizeCategoryValue(category?.value) === featureValue);
  if (!match) return baseStyle;
  return normalizeCategoryStyle(match.style || match, baseStyle);
}

function getLayerStyle(layer, feature) {
  const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1;
  if (isCommuneLayer(layer)) {
    return {
    color: "#CBD5E1",
    weight: 2,
    opacity: 0.7 * opacity,
    fillColor: "#CBD5E1",
    fillOpacity: 0.01 * opacity,
    dashArray: undefined,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
    };
  }
  if (layer.id === "roads") {
    const style = getRoadStyle(getFeatureClassification(feature));
    return { ...style, opacity: (style.opacity ?? 1) * opacity };
  }
  if (layer.privateLayer) {
    const isLine = layer.geometryType === "line";
    const baseStyle = getPrivateLayerStyle(layer);
    const style = styleForFeatureCategory(layer, feature, baseStyle);
    return {
      color: style.color || style.strokeColor,
      weight: style.weight ?? (isLine ? 4 : 3),
      opacity: (style.opacity ?? 0.9) * opacity,
      fillColor: style.fillColor || style.fill,
      fillOpacity: (isLine ? 0 : (style.fillOpacity ?? 0.16)) * opacity,
      dashArray: style.dashArray,
      lineCap: "round",
      lineJoin: "round",
    };
  }
  return { color: "#123B5D", weight: 2, opacity, fillOpacity: 0.1 };
}

function getPointStyle(layer, feature) {
  if (layer.privateLayer) {
    const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1;
    const baseStyle = getPrivateLayerStyle(layer);
    const style = styleForFeatureCategory(layer, feature, baseStyle);
    return {
      radius: style.radius ?? 6.5,
      color: style.color || style.strokeColor,
      weight: style.weight ?? 2.5,
      opacity: (style.opacity ?? 0.9) * opacity,
      fillColor: style.fillColor || style.fill,
      fillOpacity: (style.fillOpacity ?? 0.9) * opacity,
    };
  }
  const classification = getFeatureClassification(feature);
  const base = layer.id === "school-infrastructures" ? getSchoolMarkerStyle(classification) : getSanitaryMarkerStyle(classification);
  const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1;
  return {
    ...base,
    opacity,
    fillOpacity: (base.fillOpacity ?? 0.85) * opacity,
  };
}

function formatClassification(layerId, value) {
  const labels = {
    route_nationale: "Route nationale",
    route_regionale: "Route régionale",
    piste: "Piste",
    voie_urbaine: "Voie urbaine",
    hopital: "Hôpital",
    centre_sante: "Centre de santé",
    poste_sante: "Poste de santé",
    universite: "Université",
    lycee: "Lycée",
    college: "Collège",
    ecole_primaire: "École primaire",
    autre: layerId === "roads" ? "Route - autre" : "Autre",
  };
  return labels[value] || value || "Autre";
}

function escapePopupHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayAttributeValue(value) {
  if (value === null || value === undefined) return "Non renseigné";
  const raw = String(value).trim();
  return raw || "Non renseigné";
}

function getPropertyValueCaseInsensitive(props = {}, fieldName = "") {
  if (!fieldName) return undefined;
  if (Object.prototype.hasOwnProperty.call(props, fieldName)) return props[fieldName];
  const wanted = String(fieldName).toLowerCase();
  const key = Object.keys(props).find((item) => String(item).toLowerCase() === wanted);
  return key ? props[key] : undefined;
}

function getCategorizedPopupInfo(layer = {}, props = {}) {
  const style = layer.style && typeof layer.style === "object" ? layer.style : layer.metadata?.style || {};
  if (!layer.privateLayer || style.mode !== "categorized" || !style.categoryField) return null;

  const rawValue = getPropertyValueCaseInsensitive(props, style.categoryField);
  const normalizedValue = normalizeCategoryValue(rawValue);
  const category = Array.isArray(style.categories)
    ? style.categories.find((item) => normalizeCategoryValue(item?.value) === normalizedValue)
    : null;

  return {
    field: style.categoryField,
    value: displayAttributeValue(rawValue),
    label: category?.label || displayAttributeValue(rawValue),
  };
}

function popupRow(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<span><b>${escapePopupHtml(label)} :</b> ${escapePopupHtml(value)}</span>`;
}

function buildPopupHtml(layer, feature) {
  const props = feature?.properties || {};
  const title = props.label || props.name || layer.name || "Élément SIG";
  const commune = props.commune || props.CCRCA_1 || props.Commune || "";
  const categorizedInfo = getCategorizedPopupInfo(layer, props);

  if (categorizedInfo) {
    const categoryLabel = categorizedInfo.label && categorizedInfo.label !== categorizedInfo.value
      ? popupRow("Classe", categorizedInfo.label)
      : "";
    const layerRow = layer.name && String(layer.name) !== String(title) ? popupRow("Couche", layer.name) : "";

    return `
      <div class="mapgeo-sig-popup mapgeo-sig-popup--private-layer">
        <strong>${escapePopupHtml(title)}</strong>
        ${layerRow}
        ${popupRow(categorizedInfo.field, categorizedInfo.value)}
        ${categoryLabel}
        ${popupRow("Commune", commune)}
      </div>
    `;
  }

  const typeLabel = props.classification ? formatClassification(layer.id, props.classification) : "";
  return `
    <div class="mapgeo-sig-popup">
      <strong>${escapePopupHtml(title)}</strong>
      ${popupRow("Type", typeLabel)}
      ${popupRow("Commune", commune)}
    </div>
  `;
}

function bboxFromMap(map) {
  if (!map?.getBounds) return "";
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat].map((value) => Number(value).toFixed(6)).join(",");
}

function GeoJsonBboxLayer({ layer, zIndex, setLayerRuntime }) {
  const map = useMap();
  const [data, setData] = useState(null);
  const [zoom, setZoom] = useState(() => map.getZoom());
  const requestSeqRef = useRef(0);
  const timerRef = useRef(null);
  const lastRequestKeyRef = useRef("");
  const layerRef = useRef(layer);

  useEffect(() => {
    ensureGeoJsonPanes(map);
  }, [map]);

  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  const loadLayer = useCallback(() => {
    const currentLayer = layerRef.current;
    if (!currentLayer?.endpoint || !map) return;

    const currentZoom = map.getZoom();
    const minZoom = Number.isFinite(Number(currentLayer.minZoom)) ? Number(currentLayer.minZoom) : 0;
    const maxZoom = Number.isFinite(Number(currentLayer.maxZoom)) ? Number(currentLayer.maxZoom) : 22;

    setZoom(currentZoom);

    if (currentZoom < minZoom || currentZoom > maxZoom) {
      setData(null);
      lastRequestKeyRef.current = "";
      setLayerRuntime(currentLayer.id, { loading: false, error: "" });
      return;
    }

    const bbox = bboxFromMap(map);
    if (!bbox) return;

    const requestKey = `${currentLayer.id}|${currentLayer.versionKey || currentLayer.updatedAt || ""}|${bbox}|${currentZoom}`;
    if (requestKey === lastRequestKeyRef.current) return;
    lastRequestKeyRef.current = requestKey;

    if (timerRef.current) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(async () => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;

      setLayerRuntime(currentLayer.id, { loading: true, error: "" });

      try {
        const payload = await mapLayerService.getLayerGeoJson(currentLayer, {
          bbox,
          limit: currentLayer.limit || 1500,
        });

        if (requestSeq !== requestSeqRef.current) return;

        const featureCount = Array.isArray(payload?.features) ? payload.features.length : 0;
        setData({ ...payload, __requestKey: requestKey });
        setLayerRuntime(currentLayer.id, { loading: false, error: "", featureCount });
      } catch (error) {
        if (requestSeq !== requestSeqRef.current) return;

        console.warn(`Impossible de charger la couche SIG ${currentLayer.name}.`, error);
        setLayerRuntime(currentLayer.id, { loading: false, error: currentLayer.privateLayer ? "Erreur couche privée" : "Erreur couche SIG" });
      }
    }, 450);
  }, [map, setLayerRuntime]);

  useEffect(() => {
    const handleViewport = () => {
      loadLayer();
    };

    loadLayer();
    map.on("moveend zoomend", handleViewport);

    return () => {
      map.off("moveend zoomend", handleViewport);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      requestSeqRef.current += 1;
    };
  }, [map, loadLayer]);

  useEffect(() => {
    lastRequestKeyRef.current = "";
    setData(null);
    loadLayer();
  }, [layer.id, layer.endpoint, layer.versionKey, layer.updatedAt, layer.visible, loadLayer]);

  const showLabels = Number.isFinite(Number(layer.labelMinZoom)) && zoom >= Number(layer.labelMinZoom);
  const geoJsonKey = `${layer.id}-${layer.versionKey || layer.updatedAt || ""}-${showLabels ? "labels" : "nolabels"}-${data?.__requestKey || ""}-${data?.metadata?.count || 0}`;

  const pointToLayer = useCallback((feature, latlng) => {
    // Leaflet appelle pointToLayer uniquement pour les géométries ponctuelles.
    // On applique donc toujours le style point, même pour une couche mixte ou non typée.
    return L.circleMarker(latlng, { ...getPointStyle(layer, feature), pane: getGeoJsonPane(layer) });
  }, [layer]);

  const onEachFeature = useCallback((feature, featureLayer) => {
    const props = feature?.properties || {};
    const label = props.CCRCA_1 || props.label || props.name || props.type || layer.name;

    if (!isCommuneLayer(layer)) {
      featureLayer.bindPopup(buildPopupHtml(layer, feature), { className: "mapgeo-sig-popup-shell", maxWidth: 240 });
    }

    if (isCommuneLayer(layer) && showLabels && label) {
      featureLayer.bindTooltip(String(label).toUpperCase(), {
        permanent: true,
        direction: "center",
        className: "mapgeo-commune-label",
        opacity: 0.88,
        pane: MANAGED_LAYER_PANES.communeLabels,
        interactive: false,
      });
      return;
    }

    if ((layer.id === "roads" && showLabels) || layer.geometryType === "point") {
      featureLayer.bindTooltip(String(label), {
        sticky: true,
        direction: "top",
        className: layer.geometryType === "point" ? "mapgeo-context-tooltip" : "mapgeo-road-tooltip",
      });
    }
  }, [layer, showLabels]);

  const style = useCallback((feature) => ({ ...getLayerStyle(layer, feature), pane: getGeoJsonPane(layer) }), [layer]);

  if (!data?.features?.length) return null;

  return (
    <GeoJSON
      key={geoJsonKey}
      data={data}
      style={style}
      pointToLayer={pointToLayer}
      onEachFeature={onEachFeature}
      pane={getGeoJsonPane(layer)}
      interactive={!isCommuneLayer(layer)}
      eventHandlers={{
        add: (event) => {
          event.layer?.eachLayer?.((childLayer) => {
            childLayer.options.interactive = !isCommuneLayer(layer);
            if (isCommuneLayer(layer)) childLayer.options.bubblingMouseEvents = false;
          });
          try {
            event.layer?.setZIndex?.(zIndex);
          } catch {
            // Certains layers GeoJSON n'exposent pas setZIndex.
          }
          if (isCommuneLayer(layer)) event.layer?.bringToBack?.();
        },
      }}
    />
  );
}

export default function ManagedMapLayers({ activeBaseLayer, visibleOperationalLayers, setLayerRuntime }) {
  return (
    <>
      <ManagedLayerPaneController />
      {activeBaseLayer?.type === "base" ? renderTileLayer(activeBaseLayer, 100, setLayerRuntime) : null}

      {activeBaseLayer?.type === "base-hybrid" ? (
        <>
          {renderTileLayer(activeBaseLayer, 100, setLayerRuntime)}
          {activeBaseLayer.labelUrl ? (
            <TileLayer
              key={`${activeBaseLayer.id}-labels`}
              url={activeBaseLayer.labelUrl}
              opacity={activeBaseLayer.labelOpacity ?? 0.95}
              zIndex={120}
              attribution={activeBaseLayer.attribution || ""}
              maxZoom={activeBaseLayer.labelMaxZoom ?? activeBaseLayer.maxZoom ?? 22}
              maxNativeZoom={activeBaseLayer.labelMaxNativeZoom ?? 18}
              keepBuffer={activeBaseLayer.labelKeepBuffer ?? 2}
              crossOrigin="anonymous"
              detectRetina={Boolean(activeBaseLayer.labelDetectRetina)}
              updateWhenIdle={activeBaseLayer.labelUpdateWhenIdle ?? true}
              updateWhenZooming={false}
              className="mapgeo-label-tile"
            />
          ) : null}
        </>
      ) : null}

      {activeBaseLayer?.type === "wms" ? renderWmsLayer(activeBaseLayer, 100, setLayerRuntime) : null}

      {visibleOperationalLayers.map((layer, index) => {
        if (!isRenderableOperationalLayer(layer)) return null;
        const zIndex = 210 + index;
        if (isGeoJsonLikeLayer(layer)) {
          return <GeoJsonBboxLayer key={layer.id} layer={layer} zIndex={zIndex} setLayerRuntime={setLayerRuntime} />;
        }
        if (layerKind(layer) === "wms") return renderWmsLayer(layer, zIndex, setLayerRuntime, MANAGED_LAYER_PANES.raster);
        if (isWmsLikeLayer(layer)) {
          return <AuthenticatedTileLayer key={layer.id} layer={layer} zIndex={zIndex} pane={MANAGED_LAYER_PANES.raster} setLayerRuntime={setLayerRuntime} />;
        }
        return null;
      })}
    </>
  );
}
