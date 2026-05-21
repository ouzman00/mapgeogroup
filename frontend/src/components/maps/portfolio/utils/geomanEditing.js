import L from "leaflet";

import { WGS84_GEOGRAPHIC_CRS, normalizeToMultiPolygon } from "../../../../utils/geometryIo";
import { closestPointOnSegment, pixelDistance } from "./measurementGeometry";

export function safeDisableGeomanModes(map) {
  if (!map?.pm) return;
  // disableGlobalDragMode itere sur toutes les couches et plante si
  // une couche n a pas de .pm (tile layers internes). On enveloppe en try.
  try {
    if (map.pm.globalDragModeEnabled?.()) {
      map.pm.disableGlobalDragMode();
    }
  } catch (err) {
    // Ignorer : etat instable, sans consequence pour l app
  }
  try { map.pm.disableDraw?.(); } catch {}
  try { map.pm.disableGlobalEditMode?.(); } catch {}
  try { map.pm.disableGlobalRemovalMode?.(); } catch {}
  try { map.pm.disableGlobalCutMode?.(); } catch {}
  try { map.pm.removeControls?.(); } catch {}
}

export function getEditableRings(layer) {
  const latlngs = layer?.getLatLngs?.() || [];
  if (!Array.isArray(latlngs) || !latlngs.length) return [];
  if (latlngs[0] instanceof L.LatLng) return [latlngs];
  if (Array.isArray(latlngs[0]) && latlngs[0][0] instanceof L.LatLng) return latlngs;
  if (Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0]) && latlngs[0][0][0] instanceof L.LatLng) return latlngs.flat();
  return [];
}

export function findNearestEditableSegment(map, layer, latlng, tolerancePx = 16) {
  if (!map || !latlng) return null;
  const target = map.latLngToLayerPoint(latlng);
  let best = null;

  getEditableRings(layer).forEach((ring) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const segmentCount = ring.length >= 3 ? ring.length : ring.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = map.latLngToLayerPoint(ring[index]);
      const end = map.latLngToLayerPoint(ring[(index + 1) % ring.length]);
      const closest = closestPointOnSegment(target, start, end);
      if (!best || closest.distance < best.distance) {
        best = { distance: closest.distance, ring, insertIndex: index + 1 };
      }
    }
  });

  return best && best.distance <= tolerancePx ? best : null;
}

export function isNearExistingVertex(map, ring, latlng, tolerance = 10) {
  if (!map || !latlng || !Array.isArray(ring)) return false;
  const target = map.latLngToLayerPoint(latlng);
  return ring.some((vertex) => pixelDistance(target, map.latLngToLayerPoint(vertex)) <= tolerance);
}

export function removeNearestEditableVertex(map, layer, latlng, tolerancePx = 16) {
  if (!map || !latlng) return { removed: false };
  const target = map.latLngToLayerPoint(latlng);
  let best = null;

  getEditableRings(layer).forEach((ring) => {
    if (!Array.isArray(ring) || ring.length <= 3) return;
    ring.forEach((vertex, index) => {
      const distance = pixelDistance(target, map.latLngToLayerPoint(vertex));
      if (!best || distance < best.distance) best = { distance, ring, index };
    });
  });

  if (!best || best.distance > tolerancePx || best.ring.length <= 3) return { removed: false };
  best.ring.splice(best.index, 1);
  layer.setLatLngs(layer.getLatLngs());
  layer.redraw?.();
  return { removed: true };
}

export function refreshGeomanLayerEdition(layer, editOptions) {
  layer.pm?.disable?.();
  layer.pm?.enable?.(editOptions);
}

export function ensureGeomanVertexHandlesInteractive(map) {
  const container = map?.getContainer?.();
  if (!container) return;

  const markerPane = map.getPane?.("markerPane");
  if (markerPane) {
    markerPane.style.zIndex = "860";
    markerPane.style.pointerEvents = "auto";
  }

  container
    .querySelectorAll(".leaflet-pm-marker, .leaflet-pm-draggable")
    .forEach((element) => {
      element.classList.add("mapgeo-geoman-edit-handle");
      element.style.pointerEvents = "auto";
      element.style.touchAction = "none";
      element.style.zIndex = "10000";
    });
}

export function scheduleGeomanVertexHandlesRefresh(map) {
  if (typeof requestAnimationFrame !== "function") {
    ensureGeomanVertexHandlesInteractive(map);
    return;
  }

  requestAnimationFrame(() => {
    ensureGeomanVertexHandlesInteractive(map);
    requestAnimationFrame(() => ensureGeomanVertexHandlesInteractive(map));
  });
}

export function isGeomanCutShape(value) {
  const shape = value?.shape || value?.layer?.pm?._shape || value?.pm?._shape || value?.options?.shape;
  return String(shape || "").toLowerCase().includes("cut");
}

export function eachGeomanResultLayer(input, callback) {
  if (!input) return;
  if (Array.isArray(input)) {
    input.forEach((item) => eachGeomanResultLayer(item, callback));
    return;
  }
  if (typeof input.eachLayer === "function") {
    input.eachLayer((layer) => callback(layer));
    return;
  }
  callback(input);
}

export function collectGeometryFromLayerGroup(group) {
  const polygonCoordinates = [];
  group.eachLayer((layer) => {
    if (layer?.__mapgeoIgnoreGeometry || !(layer instanceof L.Polygon) || layer instanceof L.Rectangle || isGeomanCutShape(layer)) return;
    const feature = layer.toGeoJSON?.();
    if (feature?.geometry?.type === "Polygon") polygonCoordinates.push(feature.geometry.coordinates);
    if (feature?.geometry?.type === "MultiPolygon") polygonCoordinates.push(...feature.geometry.coordinates);
  });
  return polygonCoordinates.length
    ? normalizeToMultiPolygon(
        { type: "MultiPolygon", coordinates: polygonCoordinates },
        { sourceCrs: WGS84_GEOGRAPHIC_CRS },
      )
    : null;
}
