import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import mapLayerService from "../../../services/mapLayerService";

function getLeafletBbox(map) {
  const bounds = map?.getBounds?.();
  if (!bounds) return "";
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  return [west, south, east, north].map((value) => Number(value).toFixed(7)).join(",");
}

function stopMapEvent(event) {
  if (event?.originalEvent) {
    L.DomEvent.stopPropagation(event.originalEvent);
  }
}

function normalizeClass(value) {
  return String(value || "autre").toLowerCase();
}

function roadStyle(feature) {
  const klass = normalizeClass(feature?.properties?.classification);
  const base = { opacity: 0.68, lineCap: "round", lineJoin: "round", interactive: true };
  if (klass === "route_nationale") return { ...base, color: "#E45757", weight: 3.2 };
  if (klass === "route_regionale") return { ...base, color: "#F59E0B", weight: 2.6 };
  if (klass === "piste") return { ...base, color: "#B7791F", weight: 2.1, dashArray: "7 7" };
  if (klass === "voie_urbaine") return { ...base, color: "#94A3B8", weight: 1.8, opacity: 0.55 };
  return { ...base, color: "#94A3B8", weight: 1.6, opacity: 0.45 };
}

function communeStyle() {
  return {
    color: "#60A5FA",
    weight: 1.2,
    opacity: 0.72,
    fillColor: "#60A5FA",
    fillOpacity: 0.035,
    dashArray: "6 7",
    interactive: true,
  };
}

function pointStyle(layerId, feature) {
  const klass = normalizeClass(feature?.properties?.classification);
  if (layerId === "sanitary-infrastructures") {
    if (klass === "hopital") return { radius: 7, color: "#991B1B", fillColor: "#FEE2E2", weight: 2.4, fillOpacity: 0.95 };
    if (klass === "centre_sante") return { radius: 6.5, color: "#DC2626", fillColor: "#FEE2E2", weight: 2.2, fillOpacity: 0.92 };
    return { radius: 6, color: "#EF4444", fillColor: "#FEE2E2", weight: 2, fillOpacity: 0.9 };
  }
  if (klass === "universite") return { radius: 7, color: "#1D4ED8", fillColor: "#DBEAFE", weight: 2.4, fillOpacity: 0.95 };
  if (klass === "lycee") return { radius: 6.5, color: "#2563EB", fillColor: "#DBEAFE", weight: 2.2, fillOpacity: 0.92 };
  return { radius: 6, color: "#3B82F6", fillColor: "#DBEAFE", weight: 2, fillOpacity: 0.9 };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function popupHtml(layerId, properties = {}) {
  const title = properties.name || properties.label || properties.CCRCA_1 || "Élément SIG";
  const rows = [];
  if (properties.type) rows.push(["Type", properties.type]);
  if (properties.commune) rows.push(["Commune", properties.commune]);
  if (properties.classification && properties.classification !== "autre") rows.push(["Classe", properties.classification]);

  const icon = layerId === "sanitary-infrastructures" ? "✚" : layerId === "school-infrastructures" ? "●" : "";
  return `
    <div class="mapgeo-sig-popup">
      <strong>${icon ? `${icon} ` : ""}${escapeHtml(title)}</strong>
      ${rows.map(([label, value]) => `<span><b>${escapeHtml(label)} :</b> ${escapeHtml(value)}</span>`).join("")}
    </div>
  `;
}

function featureStyle(layer) {
  return (feature) => {
    if (layer.id === "communes") return communeStyle(feature);
    if (layer.id === "roads") return roadStyle(feature);
    return { color: "#123B5D", weight: 1.5, opacity: 0.7, fillOpacity: 0.1 };
  };
}

export default function MapContextGeoJsonLayer({ layer, setLayerRuntime }) {
  const map = useMap();
  const [data, setData] = useState({ type: "FeatureCollection", features: [] });
  const [loadKey, setLoadKey] = useState(0);
  const zoom = map?.getZoom?.() || 0;
  const showLabels = Number.isFinite(Number(layer?.labelMinZoom)) && zoom >= Number(layer.labelMinZoom);

  useEffect(() => {
    if (!map) return undefined;
    let timeoutId = null;
    const scheduleReload = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setLoadKey((value) => value + 1), 280);
    };
    map.on("moveend zoomend", scheduleReload);
    return () => {
      map.off("moveend zoomend", scheduleReload);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [map]);

  useEffect(() => {
    if (!layer?.id || layer.visible === false || layer.zoomVisible === false) return undefined;
    let active = true;
    const bbox = getLeafletBbox(map);
    setLayerRuntime?.(layer.id, { loading: true, error: "" });
    mapLayerService
      .getLayerGeoJson(layer.id, { bbox, limit: layer.maxFeatures || 700 })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setLayerRuntime?.(layer.id, {
          loading: false,
          error: "",
          featureCount: payload?.features?.length || 0,
          truncated: Boolean(payload?.metadata?.truncated),
        });
      })
      .catch((error) => {
        if (!active) return;
        setData({ type: "FeatureCollection", features: [] });
        setLayerRuntime?.(layer.id, {
          loading: false,
          error: error?.response?.data?.detail || "Erreur de chargement",
          featureCount: 0,
        });
      });
    return () => {
      active = false;
    };
  }, [layer?.id, layer?.visible, layer?.zoomVisible, layer?.maxFeatures, map, loadKey, setLayerRuntime]);

  const pointToLayer = useMemo(
    () => (feature, latlng) => L.circleMarker(latlng, pointStyle(layer.id, feature)),
    [layer.id],
  );

  const onEachFeature = (feature, leafletLayer) => {
    const properties = feature?.properties || {};
    leafletLayer.on({ click: stopMapEvent, dblclick: stopMapEvent, contextmenu: stopMapEvent });

    if (layer.id === "communes") {
      const label = properties.CCRCA_1 || properties.label || properties.name;
      if (label) {
        leafletLayer.bindTooltip(escapeHtml(label), {
          permanent: showLabels,
          sticky: !showLabels,
          direction: "center",
          className: showLabels ? "mapgeo-commune-label" : "mapgeo-sig-tooltip",
        });
      }
      return;
    }

    if (layer.id === "roads") {
      const label = properties.name || properties.type || "Route";
      leafletLayer.bindTooltip(escapeHtml(label), { sticky: true, className: "mapgeo-sig-tooltip" });
      return;
    }

    leafletLayer.bindTooltip(escapeHtml(properties.name || properties.label || layer.name), {
      sticky: true,
      className: "mapgeo-sig-tooltip",
    });
    leafletLayer.bindPopup(popupHtml(layer.id, properties), { className: "mapgeo-sig-popup-shell" });
  };

  if (!layer || layer.visible === false || layer.zoomVisible === false) return null;

  return (
    <GeoJSON
      key={`${layer.id}-${loadKey}-${showLabels ? "labels" : "nolabels"}`}
      data={data}
      style={featureStyle(layer)}
      pointToLayer={pointToLayer}
      onEachFeature={onEachFeature}
      interactive
    />
  );
}
