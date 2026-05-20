import L from "leaflet";
import proj4 from "proj4";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, ScaleControl, Tooltip, useMap } from "react-leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Info,
  LocateFixed,
  Map as MapIcon,
  Ruler,
  Minus,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import {
  DEFAULT_MAP_CENTER,
  SENEGAL_PROJECTED_CRS,
  SENEGAL_PROJECTED_CRS_LABEL,
  computeDistanceBetweenPoints,
  computePerimeterFromPoints,
  formatArea,
  formatDistance,
  geometryAreaM2Projected,
  geometryCentroid,
  geometryToRings,
  latLngPairToProjected,
  normalizeCoordinateValue,
} from "../../../utils/parcelGeometry";
import {
  WGS84_GEOGRAPHIC_CRS,
  normalizeToMultiPolygon,
  projectedGeometryToWgs84,
} from "../../../utils/geometryIo";
import { validateParcelGeometry } from "../../../utils/geometryTopology";
import { parcelToGeoJsonFeature } from "../../../utils/parcelGeoJson";
import { getParcelPathOptions, getParcelSymbology } from "../parcelMapStyles";
import ManagedMapLayers from "../pro/ManagedMapLayers";
import { exportGeometryAsGeoJson, exportMapAsJpeg, exportMapAsPng } from "../pro/mapExport";
import LegendPanel from "../pro/LegendPanel";
import MiniMap from "../pro/MiniMap";
import IdentifyCard from "./IdentifyCard";
import FloatingMapToolbar from "./PortfolioMapToolbar";
import SearchNoResultNotice from "./SearchNoResultNotice";
import MapToolFeedbackPanel, { DraggableMapPanel, PanelMoveHandle } from "./panels/MapFloatingPanels";
import { MapRuntimeObserver, PortfolioViewport } from "./PortfolioViewport";
import useCartographyViewport from "./hooks/useCartographyViewport";
import { USER_LOCATION_FOCUS_ZOOM } from "../../../constants/mapConstants";
import { createParcelBadgeIcon, createSideLabelIcon, formatCoordinate, midpoint, segmentAngleCss } from "./mapUtils";
const INLINE_EDIT_EVENTS = "pm:edit pm:update pm:markerdragstart pm:markerdrag pm:markerdragend pm:dragstart pm:drag pm:dragend pm:vertexadded pm:vertexremoved pm:change pm:snapdrag";
const MEASUREMENT_CLICK_DELAY_MS = 180;
const MEASUREMENT_PAN_CLICK_GUARD_MS = 220;
const SNAP_TOLERANCE_PX = 24; // Augmenté de 18 à 24px pour plus de confort
const EDIT_VERTEX_TOLERANCE_PX = 16;

// Seuil de zoom pour basculer en mode "cluster de centroides".
// En dessous, on remplace les polygones par des cercles colores par statut.
// Au-dessus, on retombe en rendu polygone classique.
const POLYGON_MIN_ZOOM = 9;
const PARCEL_HINT_POINT_MAX_ZOOM = 9;
const CENTROID_RADIUS_BASE = 6;

const createParcelDraftVertexIcon = L.divIcon({
  className: "mapgeo-create-draft-vertex",
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const MAP_PANES = {
  parcels: "mapgeo-parcel-pane",
  labels: "mapgeo-parcel-label-pane",
  edit: "mapgeo-edit-pane",
  measure: "mapgeo-measure-pane",
};
const INLINE_EDIT_STYLE = {
  color: "#2563eb",
  fillColor: "#dbeafe",
  fillOpacity: 0.18,
  opacity: 1,
  weight: 4,
  dashArray: "10 6",
  lineJoin: "round",
  pane: MAP_PANES.edit,
};

const MEASURE_STYLE = {
  line: "#D8942E",
  fill: "#D8942E",

  pointBorder: "#8A4F08",
  pointFill: "#FFF7E6",

  cursorBorder: "#D8942E",
  cursorFill: "#F6B44B",

  snapBorder: "#FACC15",
  snapFill: "#FACC15",

  vertexBorder: "#8A4F08",
  vertexFill: "#FFF7E6",
};

function safeDisableGeomanModes(map) {
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

function isMobileCartographyViewport() {
  if (typeof window === "undefined") return false;

  const width = window.innerWidth || document.documentElement?.clientWidth || 1024;
  const coarsePointer = Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
  const hoverNone = Boolean(window.matchMedia?.("(hover: none)")?.matches);
  const touchPoints = Number(window.navigator?.maxTouchPoints || 0);
  const mobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(window.navigator?.userAgent || "");

  return width < 768 && (coarsePointer || hoverNone || touchPoints > 0 || mobileUserAgent);
}

function stopLeafletPropagation(event) {
  event?.stopPropagation?.();
  const originalEvent = event?.originalEvent || event?.nativeEvent;
  originalEvent?.stopPropagation?.();
  originalEvent?.stopImmediatePropagation?.();
}

function stopLeafletDomEvent(event) {
  const originalEvent = event?.originalEvent || event?.nativeEvent || event;
  if (originalEvent) {
    L.DomEvent.stop(originalEvent);
  }
  stopLeafletPropagation(event);
}

function createUserLocationIcon() {
  return L.divIcon({
    className: "mapgeo-user-location-shell",
    html: '<span class="mapgeo-user-location-marker"><span class="mapgeo-user-location-dot"></span></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function MapPaneController() {
  const map = useMap();

  useEffect(() => {
    if (!map?.createPane) return;

    const panes = [
      [MAP_PANES.parcels, 650, "auto"],
      [MAP_PANES.labels, 680, "auto"],
      [MAP_PANES.edit, 690, "auto"],
      [MAP_PANES.measure, 710, "none"],
    ];

    panes.forEach(([name, zIndex, pointerEvents]) => {
      const pane = map.getPane(name) || map.createPane(name);
      pane.style.zIndex = String(zIndex);
      pane.style.pointerEvents = pointerEvents;
    });

    // Les poignées de sommets Geoman sont rendues dans le markerPane Leaflet natif.
    // Le pane d'édition MapGeo est au-dessus des polygones standards ; on remonte donc
    // markerPane au-dessus de l'édition pour garder les sommets drag-and-drop.
    const markerPane = map.getPane("markerPane");
    if (markerPane) {
      markerPane.style.zIndex = "760";
      markerPane.style.pointerEvents = "auto";
    }
  }, [map]);

  return null;
}

function pointsAreSame(a, b, tolerance = 1e-9) {
  return Array.isArray(a) && Array.isArray(b) && Math.abs(Number(a[0]) - Number(b[0])) <= tolerance && Math.abs(Number(a[1]) - Number(b[1])) <= tolerance;
}

function cloneGeometry(geometry) {
  return geometry ? JSON.parse(JSON.stringify(geometry)) : null;
}

function geometryHistoryKey(geometry) {
  return JSON.stringify(normalizeToMultiPolygon(geometry) || null);
}

function isEditableTextTarget(target) {
  if (!target) return false;
  const tagName = String(target.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target.isContentEditable);
}

function stripMeasurementClosingPoint(points) {
  if (!Array.isArray(points) || points.length <= 1) return Array.isArray(points) ? points : [];
  const cleanPoints = [...points];
  if (pointsAreSame(cleanPoints[0], cleanPoints[cleanPoints.length - 1])) cleanPoints.pop();
  return cleanPoints;
}

function getMeasurementPreviewPoints(draft) {
  const points = Array.isArray(draft?.points) ? draft.points.filter((point) => Array.isArray(point) && point.length >= 2) : [];

  if (draft?.finished || !draft?.cursorPoint) return points;
  const lastPoint = points[points.length - 1];
  if (lastPoint && pointsAreSame(lastPoint, draft.cursorPoint)) return points;
  return [...points, draft.cursorPoint];
}

function distanceAlongPoints(points, closed = false) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const segmentCount = closed && points.length >= 3 ? points.length : points.length - 1;
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    total += computeDistanceBetweenPoints(points[index], points[(index + 1) % points.length]) || 0;
  }
  return total;
}

function polygonGeometryFromLatLngRing(points) {
  const ring = stripMeasurementClosingPoint(points).filter((point) => Array.isArray(point) && point.length >= 2);
  if (ring.length < 3) return null;
  const coordinates = ring.map(latLngPairToProjected).filter(Boolean);
  if (coordinates.length < 3) return null;
  coordinates.push(coordinates[0]);
  return { type: "Polygon", coordinates: [coordinates] };
}

function buildMeasurementDraftSummary(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripMeasurementClosingPoint(previewPoints) : previewPoints;
  const closeSurface = draft?.mode === "surface" && cleanPoints.length >= 3;
  const surfaceGeometry = closeSurface ? polygonGeometryFromLatLngRing(cleanPoints) : null;
  const surface = surfaceGeometry ? geometryAreaM2Projected(surfaceGeometry) : 0;
  const distance = distanceAlongPoints(cleanPoints, closeSurface);

  return {
    distanceLabel: formatDistance(distance),
    surfaceLabel: formatArea(surface),
    perimeterLabel: closeSurface ? formatDistance(distance) : "—",
    pointsCount: cleanPoints.length,
    hasCursorPreview: Boolean(draft?.cursorPoint && !draft?.finished),
  };
}

// Centroide simple d un anneau de points latlng (moyenne arithmetique).
function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    lat += point[0];
    lng += point[1];
    n += 1;
  }
  if (!n) return null;
  return [lat / n, lng / n];
}

/**
 * Decale les side markers de facon constante en pixels
 * quel que soit le zoom.
 */



// Decalage perpendiculaire vers l exterieur du polygone.
// Pour avoir un decalage CONSTANT en pixels ecran quel que soit le zoom,
// on convertit les latlng en pixels via map.project, decale en pixels,
// puis reconvertit en latlng via map.unproject.
//
// Si map n est pas fourni (fallback), on utilise un offset metres tres faible.
function offsetOutside(midPt, segA, segB, centroid, offsetPixels = 14, map = null) {
  if (!Array.isArray(midPt) || !Array.isArray(segA) || !Array.isArray(segB)) return midPt;

  // Si on a une instance map, calcul precis en pixels
  if (map?.project && map?.unproject && map?.getZoom) {
    try {
      const zoom = map.getZoom();
      const midPx = map.project(L.latLng(midPt[0], midPt[1]), zoom);
      const aPx = map.project(L.latLng(segA[0], segA[1]), zoom);
      const bPx = map.project(L.latLng(segB[0], segB[1]), zoom);

      // Vecteur segment en pixels
      const dx = bPx.x - aPx.x;
      const dy = bPx.y - aPx.y;

      // Perpendiculaire
      let nx = -dy;
      let ny = dx;
      const norm = Math.hypot(nx, ny);
      if (norm === 0) return midPt;
      nx /= norm;
      ny /= norm;

      // Determiner exterieur via centroide en pixels
      if (centroid) {
        const cPx = map.project(L.latLng(centroid[0], centroid[1]), zoom);
        const dot = nx * (cPx.x - midPx.x) + ny * (cPx.y - midPx.y);
        if (dot > 0) {
          nx = -nx;
          ny = -ny;
        }
      }

      const offsetPx = L.point(midPx.x + nx * offsetPixels, midPx.y + ny * offsetPixels);
      const offsetLatLng = map.unproject(offsetPx, zoom);
      return [offsetLatLng.lat, offsetLatLng.lng];
    } catch (err) {
      // En cas d echec, fallback metres
    }
  }

  // Fallback : offset en metres (utilise quand map n est pas dispo)
  const dx = segB[1] - segA[1];
  const dy = segB[0] - segA[0];
  let nx = -dy;
  let ny = dx;
  const norm = Math.hypot(nx, ny);
  if (norm === 0) return midPt;
  nx /= norm;
  ny /= norm;

  if (centroid) {
    const dot = nx * (centroid[1] - midPt[1]) + ny * (centroid[0] - midPt[0]);
    if (dot > 0) {
      nx = -nx;
      ny = -ny;
    }
  }

  // Le parametre `offsetPixels` est utilise comme valeur en METRES en mode fallback.
  // L appelant fournit donc directement la distance en metres souhaitee.
  const offsetMeters = Math.max(0.3, offsetPixels);
  const latRad = (midPt[0] * Math.PI) / 180;
  const metersPerDegLng = 111320 * Math.cos(latRad);
  const metersPerDegLat = 111320;
  return [
    midPt[0] + (ny * offsetMeters) / metersPerDegLat,
    midPt[1] + (nx * offsetMeters) / metersPerDegLng,
  ];
}

function isMobileCartographyViewportSafe() {
  try {
    return typeof isMobileCartographyViewport === "function" ? isMobileCartographyViewport() : false;
  } catch {
    return false;
  }
}

function getSideMarkerPixelOptions(map, isMobileOverride = null) {
  const zoom = typeof map?.getZoom === "function" ? map.getZoom() : 18;
  const mobile = typeof isMobileOverride === "boolean" ? isMobileOverride : isMobileCartographyViewportSafe();

  return {
    zoom,
    // Offset volontairement identique desktop/mobile : les dimensions restent
    // à distance constante de la géométrie, seuls les seuils de lisibilité changent.
    offsetPixels: 20,
    minSegmentPixels: mobile ? 44 : 34,
    minZoom: mobile ? 17 : 15,
  };
}

function repositionSideMarkersOutsideInPixels(markers, map, pixels, viewportOptions = {}) {
  if (!Array.isArray(markers) || markers.length === 0) return [];

  if (
    !map ||
    typeof map.latLngToLayerPoint !== "function" ||
    typeof map.layerPointToLatLng !== "function" ||
    typeof map.getZoom !== "function"
  ) {
    return markers.map((marker) => ({ ...marker, visible: true }));
  }

  const options = getSideMarkerPixelOptions(map, viewportOptions.isMobile);
  const offsetPixels = Number.isFinite(pixels) ? pixels : options.offsetPixels;

  return markers.map((marker) => {
    if (!marker?.midPoint || !marker?.segA || !marker?.segB) {
      return { ...marker, visible: false };
    }

    try {
      const midPx = map.latLngToLayerPoint(L.latLng(marker.midPoint[0], marker.midPoint[1]));
      const aPx = map.latLngToLayerPoint(L.latLng(marker.segA[0], marker.segA[1]));
      const bPx = map.latLngToLayerPoint(L.latLng(marker.segB[0], marker.segB[1]));

      const dx = bPx.x - aPx.x;
      const dy = bPx.y - aPx.y;
      const segmentPixels = Math.hypot(dx, dy);

      let nx = -dy;
      let ny = dx;

      const norm = Math.hypot(nx, ny);
      if (!norm) return { ...marker, visible: false };

      nx /= norm;
      ny /= norm;

      if (marker.ringCentroid) {
        const cPx = map.latLngToLayerPoint(L.latLng(marker.ringCentroid[0], marker.ringCentroid[1]));
        const dot = nx * (cPx.x - midPx.x) + ny * (cPx.y - midPx.y);
        if (dot > 0) {
          nx = -nx;
          ny = -ny;
        }
      }

      const labelPx = L.point(midPx.x + nx * offsetPixels, midPx.y + ny * offsetPixels);
      const labelLatLng = map.layerPointToLatLng(labelPx);

      return {
        ...marker,
        point: [labelLatLng.lat, labelLatLng.lng],
        segmentPixels,
        visible: options.zoom >= options.minZoom && segmentPixels >= options.minSegmentPixels,
      };
    } catch {
      return { ...marker, visible: false };
    }
  });
}
















function buildSideMarkersFromRings(rings, tone = "default", closed = true) {
  const markers = [];
  (Array.isArray(rings) ? rings : []).forEach((ring, ringIndex) => {
    const cleanRing = stripMeasurementClosingPoint(ring).filter((point) => Array.isArray(point) && point.length >= 2);
    if (cleanRing.length < 2) return;
    const segmentCount = closed && cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
    // Centroide du polygone pour determiner l exterieur (seulement si ferme)
    const centroid = closed && cleanRing.length >= 3 ? ringCentroid(cleanRing) : null;
    for (let index = 0; index < segmentCount; index += 1) {
      const point = cleanRing[index];
      const nextPoint = cleanRing[(index + 1) % cleanRing.length];
      const distance = computeDistanceBetweenPoints(point, nextPoint);
      if (!Number.isFinite(distance) || distance <= 0) continue;
      const mid = midpoint(point, nextPoint);
      const segA = point;
      const segB = nextPoint;
      markers.push({
        id: `${tone}-side-${ringIndex}-${index}`,
        point: mid,
        midPoint: mid,
        segA,
        segB,
        ringCentroid: centroid,
        label: formatDistance(distance),
        tone,
        angle: segmentAngleCss(segA, segB),
      });
    }
  });
  return markers;
}

function buildGeometryMeasurementOverlay(geometry, tone = "default") {
  const rings = geometryToRings(geometry);
  const sideMarkers = buildSideMarkersFromRings(rings, tone, true);
  const area = geometryAreaM2Projected(geometry);
  const perimeter = rings.reduce((total, ring) => total + distanceAlongPoints(stripMeasurementClosingPoint(ring), true), 0);
  const center = geometryCentroid(geometry) || rings[0]?.[0] || null;

  return {
    sideMarkers,
    areaMarker: center && (area > 0 || perimeter > 0)
      ? {
          id: `${tone}-area`,
          point: center,
          label: formatArea(area),
          subtitle: perimeter > 0 ? `Périmètre ${formatDistance(perimeter)}` : "Surface",
          tone,
        }
      : null,
  };
}

function buildMeasurementDraftOverlay(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripMeasurementClosingPoint(previewPoints) : previewPoints;
  const isSurface = draft?.mode === "surface" && cleanPoints.length >= 3;
  const geometry = isSurface ? polygonGeometryFromLatLngRing(cleanPoints) : null;
  const sideMarkers = buildSideMarkersFromRings([cleanPoints], "measure", isSurface);
  const overlay = geometry ? buildGeometryMeasurementOverlay(geometry, "measure") : { sideMarkers: [], areaMarker: null };

  return {
    sideMarkers,
    areaMarker: overlay.areaMarker,
  };
}

function toLayerPoint(map, point) {
  if (!map || !Array.isArray(point)) return null;
  return map.latLngToLayerPoint(L.latLng(point[0], point[1]));
}

function pixelDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestPointOnSegment(target, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: start, ratio: 0, distance: pixelDistance(target, start) };
  const ratio = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared));
  const point = L.point(start.x + ratio * dx, start.y + ratio * dy);
  return { point, ratio, distance: pixelDistance(target, point) };
}

function findNearestMeasurementSnap(map, point, features = [], measurementPoints = [], options = {}) {
  const fallback = { point, snapped: false, kind: null };
  if (!map || !Array.isArray(point) || point.length < 2) return fallback;
  const tolerance = Number(options.tolerancePx || SNAP_TOLERANCE_PX);
  const target = toLayerPoint(map, point);
  if (!target) return fallback;

  let best = { distance: Infinity, point, kind: null };
  const candidateRings = [];

  (Array.isArray(features) ? features : []).forEach((feature) => {
    (feature?.rings || []).forEach((ring) => candidateRings.push(stripMeasurementClosingPoint(ring)));
  });
  if (Array.isArray(measurementPoints) && measurementPoints.length) {
    candidateRings.push(stripMeasurementClosingPoint(measurementPoints));
  }

  candidateRings.forEach((ring) => {
    const cleanRing = (Array.isArray(ring) ? ring : []).filter((candidate) => Array.isArray(candidate) && candidate.length >= 2);
    cleanRing.forEach((candidate) => {
      const distance = pixelDistance(target, toLayerPoint(map, candidate));
      if (distance < best.distance) best = { distance, point: candidate, kind: "vertex" };
    });

    if (cleanRing.length < 2) return;
    const segmentCount = cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = toLayerPoint(map, cleanRing[index]);
      const end = toLayerPoint(map, cleanRing[(index + 1) % cleanRing.length]);
      if (!start || !end) continue;
      const closest = closestPointOnSegment(target, start, end);
      if (closest.distance < best.distance) {
        const latlng = map.layerPointToLatLng(closest.point);
        best = { distance: closest.distance, point: [latlng.lat, latlng.lng], kind: "segment" };
      }
    }
  });

  return best.distance <= tolerance ? { point: best.point, snapped: true, kind: best.kind } : fallback;
}

function getEditableRings(layer) {
  const latlngs = layer?.getLatLngs?.() || [];
  if (!Array.isArray(latlngs) || !latlngs.length) return [];
  if (latlngs[0] instanceof L.LatLng) return [latlngs];
  if (Array.isArray(latlngs[0]) && latlngs[0][0] instanceof L.LatLng) return latlngs;
  if (Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0]) && latlngs[0][0][0] instanceof L.LatLng) return latlngs.flat();
  return [];
}

function findNearestEditableSegment(map, layer, latlng) {
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

  return best && best.distance <= EDIT_VERTEX_TOLERANCE_PX ? best : null;
}

function isNearExistingVertex(map, ring, latlng, tolerance = 10) {
  if (!map || !latlng || !Array.isArray(ring)) return false;
  const target = map.latLngToLayerPoint(latlng);
  return ring.some((vertex) => pixelDistance(target, map.latLngToLayerPoint(vertex)) <= tolerance);
}

function removeNearestEditableVertex(map, layer, latlng) {
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

  if (!best || best.distance > EDIT_VERTEX_TOLERANCE_PX || best.ring.length <= 3) return { removed: false };
  best.ring.splice(best.index, 1);
  layer.setLatLngs(layer.getLatLngs());
  layer.redraw?.();
  return { removed: true };
}

function refreshGeomanLayerEdition(layer, editOptions) {
  layer.pm?.disable?.();
  layer.pm?.enable?.(editOptions);
}

function ensureGeomanVertexHandlesInteractive(map) {
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

function scheduleGeomanVertexHandlesRefresh(map) {
  if (typeof requestAnimationFrame !== "function") {
    ensureGeomanVertexHandlesInteractive(map);
    return;
  }

  requestAnimationFrame(() => {
    ensureGeomanVertexHandlesInteractive(map);
    requestAnimationFrame(() => ensureGeomanVertexHandlesInteractive(map));
  });
}

function keepBoundsVisibleWithoutZoom(map, bounds) {
  if (!map || !bounds?.isValid?.()) return;
  const currentBounds = map.getBounds?.();
  if (!currentBounds?.isValid?.() || currentBounds.contains(bounds)) return;
  map.panInsideBounds?.(bounds, { padding: [42, 42], animate: false });
}

function isGeomanCutShape(value) {
  const shape = value?.shape || value?.layer?.pm?._shape || value?.pm?._shape || value?.options?.shape;
  return String(shape || "").toLowerCase().includes("cut");
}

function eachGeomanResultLayer(input, callback) {
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

function collectGeometryFromLayerGroup(group) {
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

function UserLocationLayer({ enabled, onError, onDisable }) {
  const map = useMap();
  const [fix, setFix] = useState(null);
  const onErrorRef = useRef(onError);
  const onDisableRef = useRef(onDisable);

  useEffect(() => {
    onErrorRef.current = onError;
    onDisableRef.current = onDisable;
  }, [onError, onDisable]);

  useEffect(() => {
    if (!enabled || !map) {
      setFix(null);
      return undefined;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation || !map.locate) {
      onDisableRef.current?.();
      onErrorRef.current?.("Localisation indisponible");
      return undefined;
    }

    const handleFound = (event) => {
      onErrorRef.current?.("");
      setFix({
        latlng: [event.latlng.lat, event.latlng.lng],
        accuracy: Number.isFinite(event.accuracy) ? event.accuracy : null,
        timestamp: Date.now(),
      });
    };

    const handleError = () => {
      setFix(null);
      onDisableRef.current?.();
      onErrorRef.current?.("Localisation indisponible");
    };

    map.on("locationfound", handleFound);
    map.on("locationerror", handleError);
    map.locate({
      watch: true,
      setView: false,
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 1500,
    });

    return () => {
      map.off("locationfound", handleFound);
      map.off("locationerror", handleError);
      map.stopLocate?.();
    };
  }, [enabled, map]);

  if (!enabled || !fix?.latlng) return null;

  return (
    <>
      <Marker position={fix.latlng} icon={createUserLocationIcon()} interactive={false}>
        <Tooltip direction="top" offset={[0, -14]} permanent>
          Votre localisation
        </Tooltip>
      </Marker>
    </>
  );
}

function MapControlStack({ map, locationEnabled, onToggleLocation, onLocationError }) {
  const disabled = !map;
  const buttonClass = "mapgeo-action-button grid h-11 w-11 place-items-center border-b border-white/10 text-white/80 last:border-b-0 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35";
  const locationButtonClass = `${buttonClass} ${locationEnabled ? "bg-mapgeo-primary/90 text-white shadow-[inset_0_0_0_1px_rgba(199,178,153,0.45)]" : ""}`;

  const locateUser = () => {
    if (!map) return;

    if (locationEnabled) {
      onToggleLocation?.(false);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation || !map.locate) {
      onLocationError?.("Localisation indisponible");
      return;
    }

    const handleFound = (event) => {
      onLocationError?.("");
      map.flyTo(event.latlng, Math.max(map.getZoom(), USER_LOCATION_FOCUS_ZOOM), {
        animate: true,
        duration: 0.35,
      });
      onToggleLocation?.(true);
    };

    const handleError = () => {
      onToggleLocation?.(false);
      onLocationError?.("Localisation indisponible");
    };

    map.once("locationfound", handleFound);
    map.once("locationerror", handleError);
    map.locate({
      watch: false,
      setView: false,
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 1500,
    });
  };

  const overlayEventProps = {
    onPointerDown: stopLeafletPropagation,
    onMouseDown: stopLeafletPropagation,
    onClick: stopLeafletPropagation,
    onDoubleClick: stopLeafletPropagation,
    onContextMenu: stopLeafletPropagation,
  };

  return (
    <div {...overlayEventProps} className="mapgeo-map-control-stack mapgeo-export-hidden mapgeo-popover-enter absolute right-3 top-[112px] z-[920] overflow-hidden rounded-2xl border border-white/10 bg-[#07111b]/80 shadow-[0_20px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:left-5 sm:right-auto sm:top-1/2 sm:-translate-y-1/2">
      <button type="button" disabled={disabled} onClick={() => map?.zoomIn(1, { animate: true })} className={`${buttonClass} mapgeo-zoom-button`} title="Zoom avant" aria-label="Zoom avant"><Plus size={20} /></button>
      <button type="button" disabled={disabled} onClick={() => map?.zoomOut(1, { animate: true })} className={`${buttonClass} mapgeo-zoom-button`} title="Zoom arrière" aria-label="Zoom arrière"><Minus size={20} /></button>
      <button type="button" disabled={disabled} onClick={locateUser} className={`${locationButtonClass} mapgeo-location-button`} title={locationEnabled ? "Désactiver la localisation" : "Me localiser"} aria-label={locationEnabled ? "Désactiver la localisation" : "Me localiser"}><LocateFixed size={19} /></button>
    </div>
  );
}


function formatActiveMapFilters(filters = {}) {
  const labels = [];
  if (filters.owner_client_code) labels.push(`client ${filters.owner_client_code}`);
  if (filters.status) labels.push(`statut ${filters.status}`);
  if (filters.commune) labels.push(`commune ${filters.commune}`);
  if (filters.period) labels.push(`période ${filters.period}`);
  if (filters.q) labels.push(`recherche ${filters.q}`);
  return labels.join(" · ");
}

function ViewportSampleNotice({ summary }) {
  if (!summary?.bbox) return null;

  const loaded = Number(summary.loaded || 0);
  const total = Number(summary.total || loaded);
  const limit = Number(summary.limit || 500);
  const hasLimit = total > loaded || loaded >= limit;
  const filtersLabel = formatActiveMapFilters(summary.filters);

  return (
    <div className="mapgeo-viewport-notice mapgeo-export-hidden absolute left-1/2 top-3 z-[925] max-w-[min(720px,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#07111b]/78 px-3 py-2 text-xs font-semibold leading-5 text-white/78 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      Carte : emprise courante · {loaded.toLocaleString("fr-FR")} affichée{loaded > 1 ? "s" : ""}{Number.isFinite(total) && total !== loaded ? ` / ${total.toLocaleString("fr-FR")}` : ""}.
      {hasLimit ? ` Limite ${limit.toLocaleString("fr-FR")} atteinte : zoomez ou filtrez pour affiner.` : ""}
      {filtersLabel ? ` Filtres actifs : ${filtersLabel}.` : ""}
    </div>
  );
}

function formatCoordinateSystemLabel(coordinateSystem) {
  if (coordinateSystem === SENEGAL_PROJECTED_CRS) return `EPSG:32628 - ${SENEGAL_PROJECTED_CRS_LABEL}`;
  if (coordinateSystem === "EPSG:4326") return "EPSG:4326 - WGS 84";
  if (coordinateSystem === "EPSG:3857") return "EPSG:3857 - Web Mercator";
  return coordinateSystem || "EPSG:4326";
}

function formatCursorPosition(cursorPosition, coordinateSystem) {
  if (!cursorPosition) return { xLabel: "—", yLabel: "—" };
  const [lat, lng] = cursorPosition;

  if (coordinateSystem === SENEGAL_PROJECTED_CRS) {
    try {
      const [x, y] = proj4("EPSG:4326", SENEGAL_PROJECTED_CRS, [lng, lat]);
      return {
        xLabel: `${Math.round(x).toLocaleString("fr-FR")} m E`,
        yLabel: `${Math.round(y).toLocaleString("fr-FR")} m N`,
      };
    } catch {
      return { xLabel: "—", yLabel: "—" };
    }
  }

  if (coordinateSystem === "EPSG:3857") {
    try {
      const [x, y] = proj4("EPSG:4326", "EPSG:3857", [lng, lat]);
      return {
        xLabel: `${Math.round(x).toLocaleString("fr-FR")} m`,
        yLabel: `${Math.round(y).toLocaleString("fr-FR")} m`,
      };
    } catch {
      return { xLabel: "—", yLabel: "—" };
    }
  }

  return {
    xLabel: `${formatCoordinate(lng)}°`,
    yLabel: `${formatCoordinate(lat)}°`,
  };
}

function formatSyncDate(features) {
  const timestamps = (Array.isArray(features) ? features : [])
    .flatMap((feature) => [
      feature?.parcel?.synced_at,
      feature?.parcel?.sync_at,
      feature?.parcel?.updated_at,
      feature?.parcel?.geometry_updated_at,
      feature?.parcel?.created_at,
    ])
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return null;

  return new Date(Math.max(...timestamps)).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MapStatusBar({ cursorPosition, coordinateSystem, features }) {
  const coordinates = formatCursorPosition(cursorPosition, coordinateSystem);
  const syncDate = formatSyncDate(features);

  return (
    <div className="mapgeo-export-hidden mapgeo-overlay-panel absolute bottom-1 left-3 z-[910] hidden w-fit max-w-[calc(100%-1.5rem)] rounded-2xl border border-white/10 bg-[#07111b]/70 px-3 py-2 text-xs font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:block md:bottom-2 md:left-4 md:max-w-[680px] lg:max-w-[760px]">
      <div className="flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden">
        <span className="inline-flex min-w-0 max-w-[21rem] shrink items-center gap-2 text-white">
          <MapIcon size={14} className="shrink-0 text-white/80" />
          <span className="truncate">
            {formatCoordinateSystemLabel(coordinateSystem)}
          </span>
        </span>

        <span className="hidden h-4 w-px shrink-0 bg-white/20 sm:inline-block" />

        <span className="min-w-[8.75rem] shrink-0 whitespace-nowrap font-mono tabular-nums text-white/90">
          X : {coordinates.xLabel}
        </span>

        <span className="min-w-[8.75rem] shrink-0 whitespace-nowrap font-mono tabular-nums text-white/90">
          Y : {coordinates.yLabel}
        </span>

        {syncDate ? (
          <>
            <span className="hidden h-4 w-px shrink-0 bg-white/20 sm:inline-block" />

            <span className="inline-flex min-w-[13.5rem] shrink-0 items-center gap-2 whitespace-nowrap font-mono tabular-nums text-white/90">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-mapgeo-sand/90 shadow-soft" />
              Synchronisé : {syncDate}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function NorthArrow({ bearing = 0, onReset = null }) {
  const overlayEventProps = {
    onPointerDown: stopLeafletPropagation,
    onMouseDown: stopLeafletPropagation,
    onClick: (event) => {
      stopLeafletPropagation(event);
      onReset?.();
    },
    onDoubleClick: stopLeafletPropagation,
    onContextMenu: stopLeafletPropagation,
  };

  const normalizedBearing = Number.isFinite(Number(bearing)) ? Number(bearing) : 0;

  return (
    <button
      type="button"
      {...overlayEventProps}
      className="mapgeo-export-hidden mapgeo-overlay-panel mapgeo-north-arrow pointer-events-auto absolute right-4 top-4 z-[935] flex h-[72px] w-[54px] flex-col items-center justify-center rounded-[16px] border border-white/10 bg-[#07111b]/70 px-1.5 py-1.5 text-white shadow-[0_14px_38px_rgba(0,0,0,0.20)] backdrop-blur-xl"
      title="Revenir au nord"
      aria-label="Revenir au nord"
    >
      <span className="mapgeo-north-label text-[11px] font-black leading-none tracking-[0.24em] text-white/80">N</span>
      <svg
        className="mt-1 h-12 w-10 text-white/80 transition-transform duration-150 ease-out"
        viewBox="0 0 40 52"
        aria-hidden="true"
        focusable="false"
        style={{ transform: `rotate(${-normalizedBearing}deg)` }}
      >
        <path d="M20 3L31 46L20 38L9 46L20 3Z" fill="currentColor" opacity="0.92" />
        <path d="M20 12L25.8 35.5L20 31.6V12Z" fill="#07111b" opacity="0.34" />
        <path d="M20 12L14.2 35.5L20 31.6V12Z" fill="white" opacity="0.22" />
        <path d="M20 3L31 46L20 38L9 46L20 3Z" fill="none" stroke="white" strokeOpacity="0.34" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {Math.abs(normalizedBearing) > 0.5 ? (
        <span className="mt-0.5 text-[9px] font-black tabular-nums text-white/55">
          {Math.round(normalizedBearing)}°
        </span>
      ) : null}
    </button>
  );
}

const DEFAULT_VERTEX_DISPLAY_OPTIONS = {
  sommets: true,
  dimensions: true,
};

function buildMeasurementSummary(activeFeature) {
  if (!activeFeature?.rings?.length) return null;
  const vertexCount = activeFeature.rings.reduce((total, ring) => total + ring.length, 0);
  return {
    perimeter: activeFeature.perimeterLabel || "—",
    area: activeFeature.areaLabel || "—",
    vertexCount,
    sideCount: vertexCount,
  };
}

function getFeatureRenderKey(feature, prefix = "feature") {
  const revision = feature?.parcel?._local_geometry_revision || feature?.parcel?.geometry_updated_at || feature?.parcel?.updated_at || "";
  const ringSignature = (feature?.rings || [])
    .map((ring) => {
      const first = ring[0] || [];
      const middle = ring[Math.floor(ring.length / 2)] || [];
      return `${ring.length}:${first[0] || ""},${first[1] || ""}:${middle[0] || ""},${middle[1] || ""}`;
    })
    .join("|");

  return `${prefix}-${feature?.id || "parcel"}-${revision}-${ringSignature}`;
}

function getSnapKindLabel(kind) {
  if (kind === "measurement") return "point de mesure";
  if (kind === "vertex") return "sommet";
  if (kind === "segment") return "segment";
  return "auto";
}

function MeasurementOverlay({ draft }) {
  const points = draft?.points || [];
  const previewPoints = getMeasurementPreviewPoints(draft);

  if (!previewPoints.length) return null;

  const isMobileMeasureOverlay = isMobileCartographyViewport();
  const isSurface = draft.mode === "surface";
  const polygonPoints = isSurface
    ? stripMeasurementClosingPoint(previewPoints)
    : previewPoints;

  const lastFixedPoint = points[points.length - 1];

  const hasCursorPreview = Boolean(
    draft?.cursorPoint &&
      !draft?.finished &&
      (!lastFixedPoint || !pointsAreSame(lastFixedPoint, draft.cursorPoint)),
  );

  const cursorTooltip = points.length ? "Point suivant" : "Premier point";

  return (
    <>
      {isSurface && polygonPoints.length >= 3 ? (
        <Polygon
          positions={polygonPoints}
          pane={MAP_PANES.measure}
          pathOptions={{
            color: MEASURE_STYLE.line,
            fillColor: MEASURE_STYLE.fill,
            fillOpacity: 0.12,
            opacity: 1,
            weight: 3.2,
            dashArray: "7 6",
            lineJoin: "round",
          }}
          interactive={false}
        />
      ) : null}

      {previewPoints.length >= 2 ? (
        <Polyline
          positions={previewPoints}
          pane={MAP_PANES.measure}
          pathOptions={{
            color: MEASURE_STYLE.line,
            opacity: 1,
            weight: 3.6,
            dashArray: "8 6",
            lineJoin: "round",
          }}
          interactive={false}
        />
      ) : null}

      {points.map((point, index) => (
        <CircleMarker
          key={`measure-point-${index}`}
          center={point}
          pane={MAP_PANES.measure}
          radius={6}
          pathOptions={{
            color: MEASURE_STYLE.pointBorder,
            fillColor: MEASURE_STYLE.pointFill,
            fillOpacity: 0.96,
            opacity: 1,
            weight: 2.5,
          }}
          interactive={false}
        />
      ))}

      {hasCursorPreview ? (
        <CircleMarker
          center={draft.cursorPoint}
          pane={MAP_PANES.measure}
          radius={7}
          pathOptions={{
            color: MEASURE_STYLE.cursorBorder,
            fillColor: MEASURE_STYLE.cursorFill,
            fillOpacity: 0.78,
            opacity: 1,
            weight: 2.4,
          }}
          interactive={false}
        >
          <Tooltip direction="top" permanent>
            {cursorTooltip}
          </Tooltip>
        </CircleMarker>
      ) : null}

      {draft?.snapPoint && !draft?.finished && !isMobileMeasureOverlay ? (
        <CircleMarker
          center={draft.snapPoint}
          pane={MAP_PANES.measure}
          radius={10}
          pathOptions={{
            color: MEASURE_STYLE.snapBorder,
            fillColor: MEASURE_STYLE.snapFill,
            fillOpacity: 0.22,
            opacity: 1,
            weight: 2.8,
            dashArray: "3 3",
          }}
          interactive={false}
        >
          <Tooltip direction="top" permanent>
            Accrochage {getSnapKindLabel(draft.snapKind)}
          </Tooltip>
        </CircleMarker>
      ) : null}
    </>
  );
}

function InlineParcelEditLayer({ activeFeature, editing, geometry, onGeometryChange, onGeometryGetterChange, deleteVertexMode, geometryReloadKey }) {
  const map = useMap();
  const groupRef = useRef(null);
  const animationFrameRef = useRef(null);
  const geometryRef = useRef(geometry);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const onGeometryGetterChangeRef = useRef(onGeometryGetterChange);
  const deleteVertexModeRef = useRef(Boolean(deleteVertexMode));
  const reloadGeometryRef = useRef(null);
  const hoveredLatLngRef = useRef(null);
  const layerEditOptionsRef = useRef({
    allowSelfIntersection: false,
    snappable: true,
    snapDistance: 24,
    snapMiddle: true,
    snapSegment: true,
    draggable: false,
    preventMarkerRemoval: false,
    removeLayerBelowMinVertexCount: false,
    panes: {
      vertexPane: "markerPane",
      markerPane: "markerPane",
      layerPane: MAP_PANES.edit,
    },
  });

  useEffect(() => {
    geometryRef.current = geometry;
    onGeometryChangeRef.current = onGeometryChange;
    onGeometryGetterChangeRef.current = onGeometryGetterChange;
  }, [geometry, onGeometryChange, onGeometryGetterChange]);

  useEffect(() => {
    deleteVertexModeRef.current = Boolean(deleteVertexMode);
  }, [deleteVertexMode]);

  useEffect(() => {
    if (!editing || !activeFeature) return undefined;

    const group = L.featureGroup().addTo(map);
    groupRef.current = group;
    onGeometryGetterChangeRef.current?.(() => collectGeometryFromLayerGroup(group));
    const editRenderer = L.svg({ pane: MAP_PANES.edit, padding: 0.2 });
    const editOptions = layerEditOptionsRef.current;

    // Protection defensive : Geoman plante parfois en appelant disableLayerDrag()
    // sur des couches Leaflet internes sans .pm. On verifie + try/catch.
    safeDisableGeomanModes(map);

    const syncNow = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      onGeometryChangeRef.current?.(collectGeometryFromLayerGroup(group));
    };

    const scheduleSync = () => {
      scheduleGeomanVertexHandlesRefresh(map);
      if (animationFrameRef.current) return;
      animationFrameRef.current = requestAnimationFrame(syncNow);
    };

    const cleanupEditableLayer = (layer) => {
      layer.off?.(INLINE_EDIT_EVENTS, scheduleSync);
      if (layer.__mapgeoAddVertexHandler) layer.off?.("dblclick", layer.__mapgeoAddVertexHandler);
      if (layer.__mapgeoDeleteVertexHandler) layer.off?.("contextmenu", layer.__mapgeoDeleteVertexHandler);
      layer.__mapgeoAddVertexHandler = null;
      layer.__mapgeoDeleteVertexHandler = null;
      layer.__mapgeoInlineEditRegistered = false;
      layer.pm?.disable?.();
    };

    const removeVertexNear = (latlng, preferredLayer = null) => {
      if (!latlng) return false;
      let changedLayer = null;

      const tryLayer = (layer) => {
        if (changedLayer || layer?.__mapgeoIgnoreGeometry || !(layer instanceof L.Polygon) || layer instanceof L.Rectangle) return;
        const result = removeNearestEditableVertex(map, layer, latlng);
        if (result?.removed) changedLayer = layer;
      };

      if (preferredLayer) tryLayer(preferredLayer);
      if (!changedLayer) group.eachLayer(tryLayer);
      if (!changedLayer) return false;

      refreshGeomanLayerEdition(changedLayer, editOptions);
      syncNow();
      return true;
    };

    const insertVertexOnSegment = (layer, event) => {
      if (deleteVertexModeRef.current) return;
      stopLeafletDomEvent(event);

      const latlng = event?.latlng;
      const nearest = findNearestEditableSegment(map, layer, latlng);
      if (!nearest || isNearExistingVertex(map, nearest.ring, latlng)) return;

      nearest.ring.splice(nearest.insertIndex, 0, L.latLng(latlng.lat, latlng.lng));
      layer.setLatLngs(layer.getLatLngs());
      layer.redraw?.();
      refreshGeomanLayerEdition(layer, editOptions);
      syncNow();
    };

    const registerEditableLayer = (layer) => {
      if (!layer || isGeomanCutShape(layer) || !(layer instanceof L.Polygon) || layer instanceof L.Rectangle) {
        layer?.remove?.();
        return;
      }

      layer.__mapgeoIgnoreGeometry = false;
      if (!group.hasLayer(layer)) group.addLayer(layer);
      layer.options.pmIgnore = false;
      layer.options.pane = MAP_PANES.edit;
      layer.options.renderer = editRenderer;
      layer.options.interactive = true;
      layer.options.bubblingMouseEvents = false;
      layer.setStyle?.({ ...INLINE_EDIT_STYLE, renderer: editRenderer });

      // Geoman doit réinitialiser la couche après modification de pmIgnore/pane.
      // Sans cela, les sommets peuvent être visibles mais non déplaçables.
      try {
        L.PM?.reInitLayer?.(layer);
      } catch (error) {
        console.warn("Impossible de réinitialiser la couche Geoman.", error);
      }

      layer.pm?.enable?.(editOptions);
      // NB : on n appelle PAS layer.pm.disableLayerDrag() : cette methode
      // desactive aussi le drag des markers de sommet sur Geoman 2.19,
      // ce qui empeche l edition. Le drag du polygone entier est deja
      // desactive via editOptions.draggable=false.
      scheduleGeomanVertexHandlesRefresh(map);

      if (layer.__mapgeoInlineEditRegistered) return;
      layer.__mapgeoInlineEditRegistered = true;
      const addVertexHandler = (event) => insertVertexOnSegment(layer, event);
      const deleteVertexHandler = (event) => {
        if (!deleteVertexModeRef.current) return;
        stopLeafletDomEvent(event);
        removeVertexNear(event?.latlng, layer);
      };
      layer.__mapgeoAddVertexHandler = addVertexHandler;
      layer.__mapgeoDeleteVertexHandler = deleteVertexHandler;
      layer.on("dblclick", addVertexHandler);
      // Suppression de sommet via clic droit / appui contextuel uniquement.
      // On évite un handler click sur la couche, qui peut intercepter le drag des sommets Geoman.
      layer.on("contextmenu", deleteVertexHandler);
      layer.on(INLINE_EDIT_EVENTS, scheduleSync);
    };

    const loadGeometryIntoGroup = (nextGeometry, { keepVisible = false, sync = true } = {}) => {
      const layers = [];
      group.eachLayer((layer) => layers.push(layer));
      layers.forEach(cleanupEditableLayer);
      group.clearLayers();

      const source = normalizeToMultiPolygon(nextGeometry === undefined ? activeFeature.parcel?.geometry : nextGeometry);
      const sourceForLeaflet = projectedGeometryToWgs84(source);
      if (sourceForLeaflet) {
        L.geoJSON(sourceForLeaflet, {
          pane: MAP_PANES.edit,
          renderer: editRenderer,
          interactive: true,
          style: { ...INLINE_EDIT_STYLE, renderer: editRenderer },
          pmIgnore: false,
        }).eachLayer((layer) => {
          registerEditableLayer(layer);
        });

        if (keepVisible) keepBoundsVisibleWithoutZoom(map, group.getBounds());
      }

      if (sync) syncNow();
    };

    reloadGeometryRef.current = (nextGeometry) => {
      loadGeometryIntoGroup(nextGeometry, { keepVisible: false, sync: false });
      scheduleGeomanVertexHandlesRefresh(map);
    };
    loadGeometryIntoGroup(geometryRef.current || activeFeature.parcel?.geometry, { keepVisible: true, sync: true });
    scheduleGeomanVertexHandlesRefresh(map);

    map.pm?.setGlobalOptions?.({
      continueDrawing: false,
      snappable: true,
      snapDistance: 24,
      snapMiddle: true,
      snapSegment: true,
      allowSelfIntersection: false,
      finishOn: "dblclick",
      templineStyle: { color: "#2563eb", weight: 3, pane: MAP_PANES.edit },
      hintlineStyle: { color: "#2563eb", dashArray: "6 6", weight: 2, pane: MAP_PANES.edit },
      pathOptions: INLINE_EDIT_STYLE,
    });
    // La barre d’outils native Geoman crée un petit panneau flottant à droite
    // et peut se dupliquer visuellement avec les contrôles MapGeo. Les outils
    // d’édition restent pilotés par la couche et le panneau compact maison.
    map.pm?.removeControls?.();

    const doubleClickZoomWasEnabled = map.doubleClickZoom?.enabled?.() ?? false;
    map.doubleClickZoom?.enable?.();

    const handleCreate = (event) => {
      stopLeafletDomEvent(event);
      if (isGeomanCutShape(event)) {
        event?.layer?.remove?.();
        return;
      }
      registerEditableLayer(event.layer);
      syncNow();
    };

    const handleRemove = (event) => {
      if (event?.layer) {
        event.layer.__mapgeoIgnoreGeometry = true;
        if (group.hasLayer(event.layer)) group.removeLayer(event.layer);
      }
      syncNow();
    };

    const handleCut = (event) => {
      if (event?.layer) {
        event.layer.__mapgeoIgnoreGeometry = true;
        if (group.hasLayer(event.layer)) group.removeLayer(event.layer);
      }

      eachGeomanResultLayer(event?.resultingLayers || event?.layers || event?.resultingLayer, registerEditableLayer);
      event?.cutLayer?.remove?.();

      syncNow();
    };

    const handleSync = () => scheduleSync();
    const handleGeomanDragStart = () => {
      try { map.dragging?.disable?.(); } catch {}
      scheduleGeomanVertexHandlesRefresh(map);
    };
    const handleGeomanDragEnd = () => {
      try { map.dragging?.enable?.(); } catch {}
      scheduleSync();
    };
    const handleMouseMove = (event) => {
      hoveredLatLngRef.current = event?.latlng || null;
    };
    const handleMouseOut = () => {
      hoveredLatLngRef.current = null;
    };
    const handleKeyDown = (event) => {
      if (!deleteVertexModeRef.current || isEditableTextTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!removeVertexNear(hoveredLatLngRef.current)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    map.on("pm:create", handleCreate);
    map.on("pm:remove", handleRemove);
    map.on("pm:cut", handleCut);
    map.on("pm:markerdragstart pm:dragstart", handleGeomanDragStart);
    map.on("pm:markerdragend pm:dragend", handleGeomanDragEnd);
    map.on("mousemove", handleMouseMove);
    map.on("mouseout", handleMouseOut);
    map.on(INLINE_EDIT_EVENTS, handleSync);
    group.on(INLINE_EDIT_EVENTS, handleSync);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      reloadGeometryRef.current = null;
      hoveredLatLngRef.current = null;
      map.off("pm:create", handleCreate);
      map.off("pm:remove", handleRemove);
      map.off("pm:cut", handleCut);
      map.off("pm:markerdragstart pm:dragstart", handleGeomanDragStart);
      map.off("pm:markerdragend pm:dragend", handleGeomanDragEnd);
      try { map.dragging?.enable?.(); } catch {}
      map.off("mousemove", handleMouseMove);
      map.off("mouseout", handleMouseOut);
      map.off(INLINE_EDIT_EVENTS, handleSync);
      group.off(INLINE_EDIT_EVENTS, handleSync);
      window.removeEventListener("keydown", handleKeyDown);
      onGeometryGetterChangeRef.current?.(null);
      group.eachLayer(cleanupEditableLayer);
      safeDisableGeomanModes(map);
      if (doubleClickZoomWasEnabled) map.doubleClickZoom?.enable?.();
      group.remove();
      groupRef.current = null;
    };
  }, [activeFeature?.id, editing, map]);

  useEffect(() => {
    if (!editing || !reloadGeometryRef.current) return;
    reloadGeometryRef.current(geometry);
  }, [editing, geometryReloadKey]);

  return null;
}

function InlineParcelEditPanel({ activeFeature, form, setForm, geometry, saving, message, validationResult, deleteVertexMode, setDeleteVertexMode, canUndo, canRedo, onUndo, onRedo, onClose, onSave, canArchiveParcels = false, onDeleteParcel }) {
  if (!activeFeature) return null;
  const rings = geometryToRings(geometry);
  const vertexCount = rings.reduce((total, ring) => total + ring.length, 0);
  const area = geometryAreaM2Projected(geometry);
  const perimeter = rings.reduce((total, ring) => total + (computePerimeterFromPoints(ring) || 0), 0);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <DraggableMapPanel
      className="mapgeo-mobile-tool-panel mapgeo-geometry-panel mapgeo-export-hidden mapgeo-panel-enter pointer-events-auto absolute bottom-3 left-3 right-3 top-auto z-[950] max-h-[55%] overflow-y-auto rounded-[20px] border border-white/10 bg-[#07111b]/94 p-3 text-white shadow-[0_24px_72px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:left-4 sm:right-auto sm:top-[92px] sm:bottom-auto sm:max-h-[calc(100%-260px)] sm:w-[320px] sm:max-w-[calc(100%-2rem)]"
      ariaLabel="Déplacer le panneau d’édition"
    >
      {({ dragHandleProps, resetPosition }) => (
        <>
          <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} />
          <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-mapgeo-sand/60">Édition active</p>
          <h3 className="mt-1 truncate text-base font-extrabold">{form.reference || activeFeature.parcel?.reference || "Parcelle"}</h3>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-45" title="Fermer l’édition">
          <X size={17} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2"><span className="block text-white/40">Surface</span><strong className="text-sm">{area ? formatArea(area) : "—"}</strong></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2"><span className="block text-white/40">Périmètre</span><strong className="text-sm">{perimeter ? formatDistance(perimeter) : "—"}</strong></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2"><span className="block text-white/40">Anneaux</span><strong className="text-sm">{rings.length}</strong></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2"><span className="block text-white/40">Sommets</span><strong className="text-sm">{vertexCount}</strong></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo || saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-xs font-extrabold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
          title="Revenir à l’étape précédente (Ctrl/Cmd + Z)"
        >
          <Undo2 size={15} /> Retour
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo || saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-xs font-extrabold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
          title="Rétablir l’étape suivante (Ctrl/Cmd + Y)"
        >
          <Redo2 size={15} /> Refaire
        </button>
      </div>

      {validationResult?.issues?.length ? (
        <div className={`mt-3 rounded-2xl border px-3 py-2 text-[11px] font-semibold leading-5 ${validationResult.status === "blocking" ? "border-mapgeo-sand/40 bg-mapgeo-sand/15 text-mapgeo-ivory" : validationResult.status === "warning" ? "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-ivory" : "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-ivory"}`}>
          <p className="mb-1 font-black uppercase tracking-[0.14em]">Contrôle géométrique</p>
          <ul className="list-disc space-y-1 pl-4">
            {validationResult.issues.slice(0, 3).map((entry) => (
              <li key={`${entry.level}-${entry.code}`}>{entry.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 rounded-2xl border border-mapgeo-sand/30 bg-mapgeo-sand/10 px-3 py-2 text-[11px] font-semibold leading-4 text-mapgeo-ivory/85">
        Édition géométrique uniquement : déplacer les sommets, double-cliquer sur un segment pour en ajouter un, puis enregistrer.
      </div>

      <label className="mt-3 block text-[11px] font-bold text-white/60">Motif de modification géométrique
        <textarea value={form.geometry_change_reason} onChange={(event) => update("geometry_change_reason", event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.065] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-mapgeo-sand/60" placeholder="Ex. Correction terrain, import SIG vérifié, ajustement sommet…" />
      </label>

      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={() => setDeleteVertexMode((current) => !current)}
          disabled={!rings.length || saving}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 ${
            deleteVertexMode
              ? "border-mapgeo-sand/50 bg-mapgeo-sand/20 text-mapgeo-ivory shadow-soft"
              : "border-white/10 bg-white/[0.045] text-white/75 hover:bg-white/10"
          }`}
          title="Activer le mode suppression de sommet"
        >
          <Trash2 size={15} /> {deleteVertexMode ? "Suppression de sommet active" : "Effacer un sommet"}
        </button>
        {deleteVertexMode ? (
          <div className="rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-[11px] font-semibold leading-4 text-mapgeo-ivory/80">
            Cliquez sur un sommet pour le supprimer. Sur ordinateur, tu peux aussi survoler un sommet puis appuyer sur Suppr ou Retour arrière. Minimum 3 sommets.
          </div>
        ) : null}
      </div>

      {canArchiveParcels ? (
        <div className="mt-3 rounded-2xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 p-2">
          <button
            type="button"
            onClick={onDeleteParcel}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/15 px-3 py-2.5 text-xs font-extrabold text-mapgeo-ivory transition hover:bg-mapgeo-sand/20 disabled:cursor-not-allowed disabled:opacity-45"
            title="Archiver cette parcelle sans supprimer ses données"
          >
            <Trash2 size={15} /> Archiver la parcelle
          </button>
        </div>
      ) : null}

      {message ? <p className="mt-3 rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">{message}</p> : null}

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={onSave} disabled={saving || !rings.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-mapgeo-primary px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-mapgeo-sand disabled:cursor-not-allowed disabled:opacity-55">
          <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm font-bold text-white/70 transition hover:bg-white/10 disabled:opacity-55">
          Annuler
        </button>
      </div>
        </>
      )}
    </DraggableMapPanel>
  );
}

function ConfirmDialog({ config, onCancel, onConfirm }) {
  if (!config) return null;

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-mapgeo-primary/40 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={config.title}>
      <div className="w-full max-w-md rounded-3xl border border-mapgeo-line bg-white p-6 text-mapgeo-primary shadow-panel">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-700">
            <Info size={20} />
          </span>
          <div>
            <h3 className="text-lg font-extrabold">{config.title}</h3>
            <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">{config.message}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory">Annuler</button>
          <button type="button" onClick={onConfirm} className="rounded-2xl border border-red-200 bg-red-600 px-4 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-red-700">{config.confirmLabel || "Confirmer"}</button>
        </div>
      </div>
    </div>
  );
}

function buildInlineEditForm(activeFeature) {
  const parcel = activeFeature?.parcel || {};
  return {
    reference: parcel.reference || "",
    geometry_change_reason: "",
  };
}

function prepareGeometryForApi(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates) && geometry.coordinates.length === 1) {
    return { type: "Polygon", coordinates: geometry.coordinates[0] };
  }
  return geometry;
}

export default function PortfolioMapShell({
  mapContainerRef,
  map,
  setMap,
  mapZoom = 16,
  setMapZoom,
  activeFeature,
  viewportFeatures,
  displayedFeatures,
  filteredFeatures,
  searchTerm,
  viewMode,
  showLegend,
  showVertices,
  showMeasurements,
  layerState,
  activeBaseLayer,
  visibleExternalLayers,
  parcelLayerVisible,
  showLabels,
  labelsAreVisible,
  setShowLabels,
  legendFeatures,
  cursorPosition,
  setCursorPosition,
  identifyState,
  setIdentifyState,
  viewportRequest,
  coordinateSystem,
  onFeatureSelection,
  setShowLegend,
  setShowVertices,
  setShowMeasurements,
  setShowPrintDialog,
  onClearSearch,
  canManageParcels = false,
  canArchiveParcels = false,
  onSaveParcelEdit,
  onDeleteParcel,
  editRequestKey = 0,
  viewportSummary = null,
  createParcelPreviewGeometry = null,
  createParcelDrawingActive = false,
  onCreateGeometryDrawn,
  onCancelCreateGeometryDrawing,
  onInlineEditStateChange,
}) {
  const [activeCommand, setActiveCommand] = useState(null);
  const [measurementDraft, setMeasurementDraft] = useState({ mode: "distance", points: [], cursorPoint: null, snapPoint: null, snapKind: null, finished: false });
  const [createParcelDraftPoints, setCreateParcelDraftPoints] = useState([]);
  const [createParcelDraftCursorPoint, setCreateParcelDraftCursorPoint] = useState(null);
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [deleteVertexMode, setDeleteVertexMode] = useState(false);
  const [userLocationEnabled, setUserLocationEnabled] = useState(false);
  const [userLocationMessage, setUserLocationMessage] = useState("");

  // AUTO_CLEAR_USER_LOCATION_MESSAGE
  useEffect(() => {
    if (!userLocationMessage) return undefined;

    const timeoutId = window.setTimeout(() => {
      setUserLocationMessage("");
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [userLocationMessage]);
  const [hoveredFeatureId, setHoveredFeatureId] = useState(null);
  const [vertexDisplayOptions, setVertexDisplayOptions] = useState(DEFAULT_VERTEX_DISPLAY_OPTIONS);
  const [editGeometry, setEditGeometry] = useState(null);
  const editGeometryRef = useRef(null);
  const editGeometryGetterRef = useRef(null);
  const [editHistory, setEditHistory] = useState([]);
  const [editHistoryIndex, setEditHistoryIndex] = useState(-1);
  const [editLayerResetKey, setEditLayerResetKey] = useState(0);
  const [editForm, setEditForm] = useState(() => buildInlineEditForm(activeFeature));
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [confirmConfig, setConfirmConfig] = useState(null);
  const previousEditRequestKeyRef = useRef(editRequestKey);
  const editHistoryIndexRef = useRef(-1);
  const measurementClickTimerRef = useRef(null);
  const lastMeasurementPanAtRef = useRef(0);
  const createParcelVertexDragActiveRef = useRef(false);
  const { isMobile: isMobileCartography } = useCartographyViewport();
  const measurementSummary = useMemo(() => buildMeasurementSummary(activeFeature), [activeFeature]);
  const measurementDraftSummary = useMemo(() => buildMeasurementDraftSummary(measurementDraft), [measurementDraft]);
  const createParcelPreviewRings = useMemo(
    () => (createParcelPreviewGeometry ? geometryToRings(createParcelPreviewGeometry) : []),
    [createParcelPreviewGeometry],
  );
  const createParcelDraftMeasurement = useMemo(
    () => ({
      mode: "surface",
      points: createParcelDraftPoints,
      cursorPoint: createParcelDraftCursorPoint,
      snapPoint: null,
      snapKind: null,
      finished: false,
    }),
    [createParcelDraftPoints, createParcelDraftCursorPoint],
  );

  const createParcelDraftPreviewPoints = useMemo(
    () => getMeasurementPreviewPoints(createParcelDraftMeasurement),
    [createParcelDraftMeasurement],
  );

  const createParcelDraftGeometry = useMemo(
    () => (createParcelDraftPoints.length >= 3 ? polygonGeometryFromLatLngRing(createParcelDraftPoints) : null),
    [createParcelDraftPoints],
  );

  const createParcelDraftOverlay = useMemo(() => {
    const overlay = buildMeasurementDraftOverlay(createParcelDraftMeasurement);

    return Object.assign({}, overlay, {
      sideMarkers: repositionSideMarkersOutsideInPixels(
        overlay.sideMarkers,
        map,
        undefined,
        { isMobile: isMobileCartography },
      ),
    });
  }, [createParcelDraftMeasurement, map, mapZoom, isMobileCartography]);

  const finishCreateParcelDrawing = useCallback(() => {
    if (!createParcelDraftGeometry) return;

    onCreateGeometryDrawn?.(createParcelDraftGeometry);
    setCreateParcelDraftPoints([]);
    setCreateParcelDraftCursorPoint(null);
  }, [createParcelDraftGeometry, onCreateGeometryDrawn]);

  const cancelCreateParcelDrawing = useCallback(() => {
    setCreateParcelDraftPoints([]);
    setCreateParcelDraftCursorPoint(null);
    onCancelCreateGeometryDrawing?.();
  }, [onCancelCreateGeometryDrawing]);

  const removeLastCreateParcelDraftPoint = useCallback(() => {
    setCreateParcelDraftPoints((current) => current.slice(0, -1));
  }, []);

  const updateCreateParcelDraftPoint = useCallback((index, nextPoint) => {
    if (!Array.isArray(nextPoint) || nextPoint.length < 2) return;

    setCreateParcelDraftPoints((current) => {
      if (index < 0 || index >= current.length) return current;

      return current.map((point, pointIndex) => (
        pointIndex === index ? nextPoint : point
      ));
    });
  }, []);

  useEffect(() => {
    if (!createParcelDrawingActive) {
      setCreateParcelDraftPoints([]);
      setCreateParcelDraftCursorPoint(null);
    }
  }, [createParcelDrawingActive]);

  useEffect(() => {
    if (!map || !createParcelDrawingActive) return undefined;

    const wasEnabled = map.doubleClickZoom?.enabled?.();
    map.doubleClickZoom?.disable?.();

    const handleCreateParcelDrawingKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelCreateParcelDrawing();
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeLastCreateParcelDraftPoint();
        return;
      }

      if (event.key === "Enter" && createParcelDraftGeometry) {
        event.preventDefault();
        finishCreateParcelDrawing();
      }
    };

    window.addEventListener("keydown", handleCreateParcelDrawingKeyDown);

    return () => {
      window.removeEventListener("keydown", handleCreateParcelDrawingKeyDown);
      if (wasEnabled) map.doubleClickZoom?.enable?.();
      createParcelVertexDragActiveRef.current = false;
    };
  }, [map, createParcelDrawingActive, cancelCreateParcelDrawing, finishCreateParcelDrawing, removeLastCreateParcelDraftPoint, createParcelDraftGeometry]);

  const editMeasurementOverlay = useMemo(() => {
    const overlay = buildGeometryMeasurementOverlay(editGeometry, "edit");
    return Object.assign({}, overlay, {
      sideMarkers: repositionSideMarkersOutsideInPixels(overlay.sideMarkers, map, undefined, { isMobile: isMobileCartography }),
    });
  }, [editGeometry, map, mapZoom, isMobileCartography]);
  const editValidation = useMemo(() => (inlineEditOpen ? validateParcelGeometry(editGeometry, activeFeature?.parcel || {}) : null), [activeFeature, editGeometry, inlineEditOpen]);

  useEffect(() => {
    onInlineEditStateChange?.(inlineEditOpen);
  }, [inlineEditOpen, onInlineEditStateChange]);

  useEffect(() => {
    if (!map || !createParcelPreviewRings.length) return;

    const bounds = L.latLngBounds(createParcelPreviewRings.flat());
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 19 });
    }
  }, [map, createParcelPreviewRings]);

  useEffect(() => {
    editGeometryRef.current = editGeometry;
  }, [editGeometry]);
  const selectedMeasurementOverlay = useMemo(() => {
    const overlay = buildGeometryMeasurementOverlay(activeFeature?.parcel?.geometry, "measure");
    return Object.assign({}, overlay, {
      sideMarkers: repositionSideMarkersOutsideInPixels(overlay.sideMarkers, map, undefined, { isMobile: isMobileCartography }),
    });
  }, [activeFeature, map, mapZoom, isMobileCartography]);
  const measurementDraftOverlay = useMemo(() => {
    const overlay = buildMeasurementDraftOverlay(measurementDraft);
    return Object.assign({}, overlay, {
      sideMarkers: repositionSideMarkersOutsideInPixels(overlay.sideMarkers, map, undefined, { isMobile: isMobileCartography }),
    });
  }, [measurementDraft, map, mapZoom, isMobileCartography]);
  const labelFeatures = useMemo(() => {
    const isValidFeature = (feature) =>
      feature?.rings?.length > 0 &&
      Array.isArray(feature.center) &&
      feature.center.length === 2 &&
      Number.isFinite(Number(feature.center[0])) &&
      Number.isFinite(Number(feature.center[1]));

    const withGeometry = displayedFeatures.filter(isValidFeature);

    if (viewMode === "selection") {
      if (!activeFeature?.id) return [];
      return withGeometry.filter(
        (feature) => String(feature.id) === String(activeFeature.id),
      );
    }

    // On force l inclusion de la parcelle active meme si elle n est pas
    // dans le viewport actuel (utilisateur a dezoomée fortement).
    // Sans ca, le badge disparait et l utilisateur perd la parcelle de vue.
    if (activeFeature && isValidFeature(activeFeature)) {
      const alreadyPresent = withGeometry.some(
        (f) => String(f.id) === String(activeFeature.id),
      );
      if (!alreadyPresent) {
        return [activeFeature, ...withGeometry];
      }
    }

    return withGeometry;
  }, [displayedFeatures, viewMode, activeFeature]);

  useEffect(() => {
    setMeasurementDraft((current) => ({ ...current, points: [], cursorPoint: null, snapPoint: null, snapKind: null, finished: false }));
  }, [activeFeature?.id]);

  const clearPendingMeasurementClick = useCallback(() => {
    if (!measurementClickTimerRef.current) return;
    window.clearTimeout(measurementClickTimerRef.current);
    measurementClickTimerRef.current = null;
  }, []);

  useEffect(() => () => clearPendingMeasurementClick(), [clearPendingMeasurementClick]);

  useEffect(() => {
    const container = map?.getContainer?.();
    if (!map || !showMeasurements) {
      container?.classList?.remove("mapgeo-measure-mode");
      clearPendingMeasurementClick();
      return undefined;
    }

    container?.classList?.add("mapgeo-measure-mode");
    map.dragging?.enable?.();
    map.doubleClickZoom?.enable?.();

    return () => {
      container?.classList?.remove("mapgeo-measure-mode");
      map.doubleClickZoom?.enable?.();
      clearPendingMeasurementClick();
    };
  }, [clearPendingMeasurementClick, map, showMeasurements]);

  useEffect(() => {
    if (showMeasurements) setIdentifyState(null);
  }, [showMeasurements, setIdentifyState]);


  // MOBILE_MEASURE_CENTER_PREVIEW_EFFECT_FINAL
  // Mobile: preview line follows the center reticle without adding points by touch.
  useEffect(() => {
    if (!map || !showMeasurements) return undefined;
    if (!isMobileCartography) return undefined;

    let frame = null;
    let lastMovePreviewAt = 0;
    const MOVE_PREVIEW_THROTTLE_MS = 80;

    const syncCenterPreview = () => {
      frame = null;

      const center = map.getCenter?.();
      if (!center) return;

      const point = [center.lat, center.lng];

      setMeasurementDraft((current) => {
        if (!current || current.finished) return current;

        // No preview line before the first validated point.
        if (!Array.isArray(current.points) || current.points.length < 1) return current;

        if (
          current.cursorPoint &&
          pointsAreSame(current.cursorPoint, point) &&
          !current.snapPoint &&
          !current.snapKind
        ) {
          return current;
        }

        return {
          ...current,
          cursorPoint: point,
          snapPoint: null,
          snapKind: null,
        };
      });
    };

    const scheduleSync = () => {
      const now = Date.now();
      if (now - lastMovePreviewAt < MOVE_PREVIEW_THROTTLE_MS) return;
      lastMovePreviewAt = now;

      if (frame !== null) return;
      frame = window.requestAnimationFrame(syncCenterPreview);
    };

    const forceSync = () => {
      lastMovePreviewAt = 0;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      syncCenterPreview();
    };

    forceSync();

    map.on("move", scheduleSync);
    map.on("moveend", forceSync);
    map.on("zoomend", forceSync);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      map.off("move", scheduleSync);
      map.off("moveend", forceSync);
      map.off("zoomend", forceSync);
    };
  }, [map, showMeasurements, setMeasurementDraft, isMobileCartography]);

  const resolveMeasurementPoint = useCallback((point, options = {}) => {
    const draftPoints = options.measurementPoints || measurementDraft.points || [];
    const measurementPoints = draftPoints.filter((_, index) => index !== draftPoints.length - 1);
    // Inclut la parcelle active même si elle n'est pas dans displayedFeatures (viewport hors écran)
    const snapFeatures = activeFeature
      ? [activeFeature, ...displayedFeatures.filter((f) => f.id !== activeFeature.id)]
      : displayedFeatures;
    return findNearestMeasurementSnap(map, point, snapFeatures, measurementPoints, options);
  }, [map, displayedFeatures, activeFeature, measurementDraft.points]);

  const finishMeasurementDraft = useCallback(() => {
    if (!showMeasurements) return;
    clearPendingMeasurementClick();
    setMeasurementDraft((current) => {
      const points = current?.points || [];
      if (!points.length) return { ...current, cursorPoint: null, snapPoint: null, snapKind: null, finished: false };
      const cleanPoints = current?.mode === "surface" ? stripMeasurementClosingPoint(points) : points;
      return { ...current, points: cleanPoints, cursorPoint: null, snapPoint: null, snapKind: null, finished: true };
    });
  }, [clearPendingMeasurementClick, showMeasurements]);

  const appendMeasurementPoint = useCallback((point, snap = null) => {
    if (!Array.isArray(point) || point.length < 2) return;
    setMeasurementDraft((current) => {
      const points = current?.points || [];
      const snapPoint = snap?.snapped ? point : null;
      const snapKind = snap?.snapped ? snap.kind : null;
      if (current?.finished) {
        return { ...current, points: [point], cursorPoint: point, snapPoint, snapKind, finished: false };
      }

      const lastPoint = points[points.length - 1];
      const isDuplicate = lastPoint && pointsAreSame(lastPoint, point);
      const closesSurfaceOnFirstPoint = current?.mode === "surface" && points.length >= 3 && pointsAreSame(points[0], point);

      if (closesSurfaceOnFirstPoint) {
        return { ...current, points: stripMeasurementClosingPoint(points), cursorPoint: null, snapPoint: null, snapKind: null, finished: true };
      }

      if (isDuplicate) {
        return { ...current, cursorPoint: point, snapPoint, snapKind, finished: false };
      }

      return { ...current, points: [...points, point], cursorPoint: point, snapPoint, snapKind, finished: false };
    });
  }, []);

  const queueMeasurementPoint = useCallback((point) => {
    if (!showMeasurements || !Array.isArray(point) || point.length < 2) return;

    clearPendingMeasurementClick();

    const snap = resolveMeasurementPoint(point);
    appendMeasurementPoint(snap.point, snap);
  }, [appendMeasurementPoint, clearPendingMeasurementClick, resolveMeasurementPoint, showMeasurements]);

  const shouldIgnoreMeasurementClickAfterPan = useCallback(() => (
    Date.now() - lastMeasurementPanAtRef.current < MEASUREMENT_PAN_CLICK_GUARD_MS
  ), []);

  const toggleVertexDisplayOption = useCallback((key) => {
    setVertexDisplayOptions((current) => ({
      ...current,
      [key]: current[key] === false,
    }));
  }, []);

  useEffect(() => {
    editHistoryIndexRef.current = editHistoryIndex;
  }, [editHistoryIndex]);

  const resetInlineEditHistory = useCallback((nextGeometry) => {
    const normalized = normalizeToMultiPolygon(nextGeometry);
    setEditHistory([cloneGeometry(normalized)]);
    setEditHistoryIndex(0);
    editHistoryIndexRef.current = 0;
  }, []);

  const recordInlineGeometryChange = useCallback((nextGeometry) => {
    const normalized = normalizeToMultiPolygon(nextGeometry);
    editGeometryRef.current = normalized;
    setEditGeometry(normalized);
    setEditHistory((current) => {
      const safeIndex = Math.min(Math.max(editHistoryIndexRef.current, -1), current.length - 1);
      const branch = safeIndex >= 0 ? current.slice(0, safeIndex + 1) : [];
      const lastGeometry = branch[branch.length - 1];

      if (geometryHistoryKey(lastGeometry) === geometryHistoryKey(normalized)) return current;

      const nextHistory = [...branch, cloneGeometry(normalized)].slice(-60);
      const nextIndex = nextHistory.length - 1;
      editHistoryIndexRef.current = nextIndex;
      setEditHistoryIndex(nextIndex);
      return nextHistory;
    });
  }, []);

  const restoreInlineGeometry = useCallback((nextIndex) => {
    if (editSaving || nextIndex < 0 || nextIndex >= editHistory.length) return;
    const restoredGeometry = cloneGeometry(editHistory[nextIndex]);
    editGeometryRef.current = restoredGeometry;
    setEditGeometry(restoredGeometry);
    setEditHistoryIndex(nextIndex);
    editHistoryIndexRef.current = nextIndex;
    setEditLayerResetKey((current) => current + 1);
    setEditMessage("");
  }, [editHistory, editSaving]);

  const undoInlineEdit = useCallback(() => {
    restoreInlineGeometry(editHistoryIndex - 1);
  }, [editHistoryIndex, restoreInlineGeometry]);

  const redoInlineEdit = useCallback(() => {
    restoreInlineGeometry(editHistoryIndex + 1);
  }, [editHistoryIndex, restoreInlineGeometry]);

  useEffect(() => {
    if (!inlineEditOpen) return undefined;

    const handleKeyDown = (event) => {
      if (isEditableTextTarget(event.target)) return;
      const key = String(event.key || "").toLowerCase();
      const wantsUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
      const wantsRedo = ((event.ctrlKey || event.metaKey) && key === "y") || ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "z");

      if (!wantsUndo && !wantsRedo) return;
      event.preventDefault?.();
      if (wantsRedo) redoInlineEdit();
      else undoInlineEdit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inlineEditOpen, redoInlineEdit, undoInlineEdit]);

  const handleParcelLayerClick = useCallback((feature, event, fallbackPoint = null) => {
    stopLeafletPropagation(event);
    if (!feature || (inlineEditOpen && !showMeasurements)) return;

    if (showMeasurements) {
      setActiveCommand(null);
      setIdentifyState(null);

      if (event?.originalEvent?.detail > 1 || shouldIgnoreMeasurementClickAfterPan()) {
        clearPendingMeasurementClick();
        return;
      }

      const latlng = event?.latlng;
      const point = latlng ? [latlng.lat, latlng.lng] : fallbackPoint || feature.center;
      if (!point) return;
      queueMeasurementPoint(point);
      return;
    }

    onFeatureSelection(feature);
  }, [clearPendingMeasurementClick, inlineEditOpen, onFeatureSelection, queueMeasurementPoint, setIdentifyState, shouldIgnoreMeasurementClickAfterPan, showMeasurements]);

  const startInlineEdit = useCallback((featureOverride = null) => {
    const featureToEdit = featureOverride || activeFeature;
    if (!canManageParcels || !featureToEdit) return;
    const initialGeometry = normalizeToMultiPolygon(featureToEdit.parcel?.geometry);
    setShowMeasurements(false);
    setShowVertices(false);
    setActiveCommand((current) => (current === "base" || current === "export" ? "tools" : current || "tools"));
    setIdentifyState(null);
    editGeometryRef.current = initialGeometry;
    setEditGeometry(initialGeometry);
    resetInlineEditHistory(initialGeometry);
    setEditLayerResetKey((current) => current + 1);
    setEditForm(buildInlineEditForm(featureToEdit));
    setEditMessage("");
    setDeleteVertexMode(false);
    setInlineEditOpen(true);
  }, [activeFeature, canManageParcels, resetInlineEditHistory, setIdentifyState, setShowMeasurements, setShowVertices]);

  

  const handleParcelLayerDoubleClick = useCallback((feature, event) => {
  stopLeafletDomEvent(event);
  if (!feature || inlineEditOpen) return;

  if (showMeasurements) {
    clearPendingMeasurementClick();
    return;
  }

  // Double-clic = sélection uniquement.
  // L'édition géométrique doit s'ouvrir uniquement via le bouton dédié.
  onFeatureSelection(feature);
}, [clearPendingMeasurementClick, inlineEditOpen, onFeatureSelection, showMeasurements]);


    useEffect(() => {
        if (!canManageParcels) return;
        if (!editRequestKey || editRequestKey === previousEditRequestKeyRef.current) return;

        previousEditRequestKeyRef.current = editRequestKey;
        startInlineEdit();
      }, [canManageParcels, editRequestKey, startInlineEdit]);
    
    useEffect(() => {
        if (canManageParcels) return;

        setInlineEditOpen(false);
        setDeleteVertexMode(false);
        setEditMessage("");
        setEditHistory([]);
        setEditHistoryIndex(-1);
        editHistoryIndexRef.current = -1;
      }, [canManageParcels]);

  const closeInlineEdit = useCallback(() => {
    if (editSaving) return;
    setInlineEditOpen(false);
    setDeleteVertexMode(false);
    setEditMessage("");
    setEditHistory([]);
    setEditHistoryIndex(-1);
    editHistoryIndexRef.current = -1;
  }, [editSaving]);


  useEffect(() => {
    if (!showMeasurements || !inlineEditOpen) return;
    closeInlineEdit();
  }, [closeInlineEdit, inlineEditOpen, showMeasurements]);


  const handleExportPng = async () => {
    setShowLegend(false);
    setShowMeasurements(false);
    setShowVertices(false);
    setActiveCommand(null);
    await exportMapAsPng(mapContainerRef.current, activeFeature?.parcel?.reference ? `Carte ${activeFeature.parcel.reference}` : "Carte SIG");
  };

  const handleExportJpeg = async () => {
    setShowLegend(false);
    setShowMeasurements(false);
    setShowVertices(false);
    setActiveCommand(null);
    await exportMapAsJpeg(mapContainerRef.current, activeFeature?.parcel?.reference ? `Carte ${activeFeature.parcel.reference}` : "Carte SIG");
  };

  const handleExportGeoJson = () => {
    if (!activeFeature?.parcel?.geometry) return;
    setActiveCommand(null);
    exportGeometryAsGeoJson(
      activeFeature.geojson || parcelToGeoJsonFeature(activeFeature.parcel),
      activeFeature.parcel.reference || "parcelle",
    );
  };

  const handleSaveInlineEdit = async () => {
    if (!canManageParcels || !activeFeature?.id) return;
    const liveGeometry = typeof editGeometryGetterRef.current === "function" ? editGeometryGetterRef.current() : editGeometryRef.current;
    const normalized = normalizeToMultiPolygon(liveGeometry || editGeometryRef.current || editGeometry);
    if (geometryHistoryKey(normalized) !== geometryHistoryKey(editGeometryRef.current)) {
      editGeometryRef.current = normalized;
      setEditGeometry(normalized);
    }
    if (!normalized) {
      setEditMessage("La géométrie doit contenir au moins un polygone valide avant l’enregistrement.");
      return;
    }
    const geometryChangeReason = editForm.geometry_change_reason?.trim() || "Correction cartographique depuis l’interface admin";

    const validation = validateParcelGeometry(normalized, activeFeature.parcel || {});
    const blockingIssues = validation.issues?.filter((entry) => entry.level === "blocking") || [];
    if (blockingIssues.length) {
      setEditMessage(`Enregistrement bloqué : ${blockingIssues.slice(0, 2).map((entry) => entry.message).join(" ")}`);
      return;
    }

    const geometryTimestamp = activeFeature.parcel?.geometry_updated_at || null;
    const apiGeometry = prepareGeometryForApi(normalized);

    const payload = {
      geometry: apiGeometry,
      expected_geometry_updated_at: geometryTimestamp,
      geometry_change_reason: geometryChangeReason,
    };

    setEditSaving(true);
    setEditMessage("");
    try {
      await onSaveParcelEdit?.(activeFeature.id, payload);
      setDeleteVertexMode(false);
      setInlineEditOpen(false);
      setEditHistory([]);
      setEditHistoryIndex(-1);
      editHistoryIndexRef.current = -1;
    } catch (error) {
      setEditMessage(error?.response?.data?.detail || error?.message || "Impossible d’enregistrer les modifications de la parcelle.");
    } finally {
      setEditSaving(false);
    }
  };

  const archiveInlineParcel = async () => {
    setEditSaving(true);
    setEditMessage("");
    try {
      await onDeleteParcel?.(activeFeature.id);
      setDeleteVertexMode(false);
      setInlineEditOpen(false);
      setEditHistory([]);
      setEditHistoryIndex(-1);
      editHistoryIndexRef.current = -1;
    } catch (error) {
      setEditMessage(error?.response?.data?.detail || error?.message || "Impossible de supprimer cette parcelle.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteInlineParcel = () => {
    if (!canManageParcels || !activeFeature?.id || editSaving) return;
    const reference = editForm.reference || activeFeature.parcel?.reference || "cette parcelle";
    setConfirmConfig({
      title: "Archiver cette parcelle ?",
      message: `La parcelle « ${reference} » disparaîtra des listes actives, mais ses géométries, documents et historiques seront conservés.`,
      confirmLabel: "Archiver",
      onConfirm: () => {
        setConfirmConfig(null);
        archiveInlineParcel();
      },
    });
  };

  return (
    <section className="mapgeo-portfolio-shell order-1 relative min-h-[560px] min-w-0 overflow-hidden rounded-[18px] border border-white/10 bg-[#08131d] shadow-[0_24px_90px_rgba(0,0,0,0.32)] lg:order-2 lg:min-h-0">
      <div ref={mapContainerRef} className="mapgeo-printable-map relative h-full min-h-[560px] overflow-hidden rounded-[18px] bg-[#0a111a] lg:min-h-0">
        <MapContainer preferCanvas center={activeFeature?.center || DEFAULT_MAP_CENTER} zoom={16} minZoom={2} maxZoom={22} doubleClickZoom={true} className={`h-full w-full ${showMeasurements ? "mapgeo-measure-mode" : ""} ${createParcelDrawingActive ? "mapgeo-create-draw-mode" : ""}`} zoomControl={false}>
          <MapPaneController />

          <PortfolioViewport mode={viewMode} activeFeature={activeFeature} features={viewportFeatures} onMapReady={setMap} viewportRequest={viewportRequest} onZoomChange={setMapZoom} />
          <MapRuntimeObserver
            measurementActive={showMeasurements}
            onMouseMove={(point) => {
              setCursorPosition(point);

              if (createParcelDrawingActive) {
                if (!createParcelVertexDragActiveRef.current) {
                  setCreateParcelDraftCursorPoint(point || null);
                }
                return;
              }

              if (showMeasurements) {
                // Mobile : le toucher écran ne doit ni créer, ni déplacer, ni prévisualiser un point.
                if (isMobileCartography) return;

                if (!point) {
                  setMeasurementDraft((current) => (current?.finished ? current : { ...current, cursorPoint: null, snapPoint: null, snapKind: null }));
                  return;
                }

                const snap = resolveMeasurementPoint(point);
                setMeasurementDraft((current) => (
                  current?.finished
                    ? current
                    : { ...current, cursorPoint: snap.point, snapPoint: snap.snapped ? snap.point : null, snapKind: snap.snapped ? snap.kind : null }
                ));
              }
            }}
            onMapClick={(point, event) => {
              if (createParcelDrawingActive) {
                if (!point) return;
                setActiveCommand(null);
                setIdentifyState(null);
                setCreateParcelDraftCursorPoint(null);
                setCreateParcelDraftPoints((current) => [...current, point]);
                return;
              }

              if (showMeasurements) {
                if (inlineEditOpen) closeInlineEdit();
                setActiveCommand(null);
                setIdentifyState(null);

                if (event?.originalEvent?.detail > 1 || shouldIgnoreMeasurementClickAfterPan()) {
                  clearPendingMeasurementClick();
                  return;
                }
                queueMeasurementPoint(point);
                return;
              }

              if (inlineEditOpen) return;
              setActiveCommand(null);
              setIdentifyState(null);
            }}
            onMapDoubleClick={() => {
              if (createParcelDrawingActive) {
                finishCreateParcelDrawing();
                return;
              }

              if (showMeasurements) {
                clearPendingMeasurementClick();
                finishMeasurementDraft();
              }
            }}
            onMapDragStart={() => {
              if (showMeasurements) clearPendingMeasurementClick();
            }}
            onMapDragEnd={() => {
              if (showMeasurements) lastMeasurementPanAtRef.current = Date.now();
            }}
            onMapContextMenu={() => {
              if (createParcelDrawingActive) {
                if (createParcelDraftGeometry) {
                  finishCreateParcelDrawing();
                } else {
                  cancelCreateParcelDrawing();
                }
                return;
              }

              if (showMeasurements) finishMeasurementDraft();
            }}
          />
          <ScaleControl position="bottomleft" metric imperial={false} />
          <UserLocationLayer
            enabled={userLocationEnabled}
            onError={setUserLocationMessage}
            onDisable={() => setUserLocationEnabled(false)}
          />

          <ManagedMapLayers
            activeBaseLayer={activeBaseLayer}
            visibleOperationalLayers={visibleExternalLayers}
            setLayerRuntime={layerState.setLayerRuntime}
          />

          {createParcelDrawingActive ? (
            <>
              {createParcelDraftPreviewPoints.length >= 2 ? (
                <Polyline
                  key="create-parcel-draft-line"
                  positions={createParcelDraftPreviewPoints}
                  pane={MAP_PANES.edit}
                  pathOptions={{
                    color: "#FACC15",
                    opacity: 1,
                    weight: 4,
                    dashArray: "8 6",
                  }}
                  interactive={false}
                />
              ) : null}
              {createParcelDraftPreviewPoints.length >= 3 ? (
                <Polygon
                  key="create-parcel-draft"
                  positions={createParcelDraftPreviewPoints}
                  pane={MAP_PANES.edit}
                  smoothFactor={0}
                  pathOptions={{
                    color: "#FACC15",
                    fillColor: "#FACC15",
                    fillOpacity: 0.12,
                    opacity: 1,
                    weight: 3,
                    dashArray: "8 6",
                  }}
                  interactive={false}
                />
              ) : null}
              {createParcelDraftPoints.map((point, index) => (
                <Marker
                  key={`create-parcel-draft-point-${index}`}
                  position={point}
                  pane={MAP_PANES.edit}
                  icon={createParcelDraftVertexIcon}
                  draggable
                  eventHandlers={{
                    dragstart: () => {
                      createParcelVertexDragActiveRef.current = true;
                      setCreateParcelDraftCursorPoint(null);
                    },
                    dragend: (event) => {
                      const latlng = event.target?.getLatLng?.();
                      createParcelVertexDragActiveRef.current = false;
                      if (!latlng) return;
                      updateCreateParcelDraftPoint(index, [latlng.lat, latlng.lng]);
                    },
                    contextmenu: (event) => {
                      event.originalEvent?.preventDefault?.();
                      event.originalEvent?.stopPropagation?.();

                      if (createParcelDraftGeometry) {
                        finishCreateParcelDrawing();
                      } else {
                        cancelCreateParcelDrawing();
                      }
                    },
                  }}
                />
              ))}
              {createParcelDraftCursorPoint ? (
                <CircleMarker
                  key="create-parcel-draft-cursor"
                  center={createParcelDraftCursorPoint}
                  pane={MAP_PANES.edit}
                  radius={4}
                  pathOptions={{
                    color: "#FACC15",
                    fillColor: "#07111b",
                    fillOpacity: 0.9,
                    opacity: 1,
                    weight: 2,
                    dashArray: "3 3",
                  }}
                  interactive={false}
                />
              ) : null}
              {createParcelDraftOverlay.sideMarkers.filter((item) => item.visible !== false).map((item) => (
                <Marker
                  key={`create-draft-side-${item.id}`}
                  position={item.point}
                  pane={MAP_PANES.measure}
                  icon={createSideLabelIcon(item.label, item.tone, item.angle || 0)}
                  interactive={false}
                />
              ))}
              {createParcelDraftOverlay.areaMarker ? (
                <CircleMarker
                  key="create-draft-area-label"
                  center={createParcelDraftOverlay.areaMarker.point}
                  pane={MAP_PANES.measure}
                  radius={1}
                  pathOptions={{ opacity: 0, fillOpacity: 0 }}
                  interactive={false}
                >
                  <Tooltip direction="center" permanent opacity={0.96} className="mapgeo-parcel-tooltip">
                    <strong>{createParcelDraftOverlay.areaMarker.label}</strong>
                    <span>{createParcelDraftOverlay.areaMarker.subtitle}</span>
                  </Tooltip>
                </CircleMarker>
              ) : null}
            </>
          ) : null}

          {createParcelPreviewRings.length ? (
            <Polygon
              key="create-parcel-preview"
              positions={createParcelPreviewRings}
              pane={MAP_PANES.edit}
              smoothFactor={0}
              pathOptions={{
                color: "#FACC15",
                fillColor: "#FACC15",
                fillOpacity: 0.18,
                opacity: 1,
                weight: 4,
                dashArray: "8 6",
              }}
              interactive={false}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.96} permanent>
                Aperçu nouvelle parcelle
              </Tooltip>
            </Polygon>
          ) : null}

          {parcelLayerVisible ? (() => {
            // On itere sur displayedFeatures + on garantit que activeFeature
            // est presente meme si elle est hors viewport (pour ne jamais la perdre).
            const featuresToRender = (() => {
              if (!activeFeature) return displayedFeatures;
              const alreadyIn = displayedFeatures.some(
                (f) => String(f.id) === String(activeFeature.id),
              );
              return alreadyIn ? displayedFeatures : [activeFeature, ...displayedFeatures];
            })();

            return featuresToRender.map((feature) => {
            const isActive = String(feature.id) === String(activeFeature?.id);
            if (inlineEditOpen && isActive) return null;
            if (!feature.rings.length) return null;

            const renderOptions = {
              active: isActive,
              hovered: String(feature.id) === String(hoveredFeatureId),
              hasDocuments: feature.documents.length > 0,
              editing: inlineEditOpen && isActive,
              geometryError: Boolean(feature.geometryWarning),
            };

            // Parcelle active à très bas zoom : point distinctif discret,
            // sans anneau blanc agressif sur le fond satellite.
            if (mapZoom < POLYGON_MIN_ZOOM && isActive && feature.center) {
              const symbology = getParcelSymbology(feature.parcel, renderOptions);
              return (
                <CircleMarker
                  key={getFeatureRenderKey(feature, "active-marker")}
                  center={feature.center}
                  pane={MAP_PANES.parcels}
                  radius={8}
                  pathOptions={{
                    color: symbology.color || "#123B5D",
                    fillColor: symbology.fillColor || symbology.color,
                    fillOpacity: 0.92,
                    opacity: 0.96,
                    weight: 2.2,
                  }}
                  eventHandlers={{
                    click: (event) => handleParcelLayerClick(feature, event, feature.center),
                    dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                  }}
                />
              );
            }

            // Bas zoom non-active : centroide colore standard.
            if (mapZoom < POLYGON_MIN_ZOOM && !isActive && feature.center) {
              const symbology = getParcelSymbology(feature.parcel, renderOptions);
              const radius = renderOptions.hovered ? CENTROID_RADIUS_BASE + 3 : CENTROID_RADIUS_BASE;
              return (
                <CircleMarker
                  key={getFeatureRenderKey(feature, "centroid")}
                  center={feature.center}
                  pane={MAP_PANES.parcels}
                  radius={radius}
                  pathOptions={{
                    color: symbology.color,
                    fillColor: symbology.fillColor,
                    fillOpacity: 0.85,
                    opacity: 1,
                    weight: 2,
                  }}
                  eventHandlers={{
                    click: (event) => handleParcelLayerClick(feature, event, feature.center),
                    dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                    mouseover: () => setHoveredFeatureId(feature.id),
                    mouseout: () => setHoveredFeatureId(null),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -4]} opacity={0.96} className="mapgeo-parcel-tooltip"><strong>{feature.parcel.reference}</strong><span>{feature.statusLabel}</span></Tooltip>
                </CircleMarker>
              );
            }

            return (
              <Polygon
                key={getFeatureRenderKey(feature, "polygon")}
                positions={feature.positions}
                pane={MAP_PANES.parcels}
                smoothFactor={0}
                pathOptions={getParcelPathOptions(feature.parcel, renderOptions)}
                eventHandlers={{
                  click: (event) => handleParcelLayerClick(feature, event),
                  dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                  mouseover: () => setHoveredFeatureId(feature.id),
                  mouseout: () => setHoveredFeatureId(null),
                }}
              >
                <Tooltip direction="top" offset={[0, -4]} opacity={0.96} className="mapgeo-parcel-tooltip">
                  <strong>{feature.parcel.reference}</strong>
                  <span>{feature.statusLabel}</span>
                </Tooltip>
              </Polygon>
            );
          });
          })() : null}

          {parcelLayerVisible && mapZoom >= POLYGON_MIN_ZOOM && mapZoom < PARCEL_HINT_POINT_MAX_ZOOM
            ? displayedFeatures
                .filter((feature) => feature?.center && feature?.rings?.length)
                .map((feature) => {
                  const isActive = String(feature.id) === String(activeFeature?.id);
                  const hovered = String(feature.id) === String(hoveredFeatureId);
                  const symbology = getParcelSymbology(feature.parcel, {
                    active: isActive,
                    hovered,
                    hasDocuments: Array.isArray(feature.documents) && feature.documents.length > 0,
                    geometryError: Boolean(feature.geometryWarning),
                  });

                  return (
                    <CircleMarker
                      key={`parcel-centroid-hint-${feature.id}`}
                      center={feature.center}
                      pane={MAP_PANES.labels}
                      radius={isActive ? 6.2 : hovered ? 5.4 : 4.2}
                      pathOptions={{
                        color: isActive
                          ? "rgba(255,255,255,0.72)"
                          : hovered
                            ? symbology.color || "#123B5D"
                            : "rgba(18,59,93,0.42)",
                        fillColor: symbology.fillColor || symbology.color || "#FACC15",
                        fillOpacity: isActive ? 0.88 : hovered ? 0.78 : 0.68,
                        opacity: isActive ? 0.94 : hovered ? 0.84 : 0.76,
                        weight: isActive ? 1.4 : hovered ? 1.7 : 1.1,
                      }}
                      eventHandlers={{
                        click: (event) => handleParcelLayerClick(feature, event, feature.center),
                        dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                        mouseover: () => setHoveredFeatureId(feature.id),
                        mouseout: () => setHoveredFeatureId(null),
                      }}
                    />
                  );
                })
            : null}

          {labelsAreVisible
            ? labelFeatures.map((feature) => (
                <Marker
                  key={getFeatureRenderKey(feature, "label")}
                  position={feature.center}
                  pane={MAP_PANES.labels}
                  icon={createParcelBadgeIcon(
                    feature.parcel.reference,
                    feature.statusLabel,
                    String(feature.id) === String(activeFeature?.id),
                  )}
                  interactive={!showMeasurements}
                  eventHandlers={showMeasurements ? undefined : {
                    click: (event) => handleParcelLayerClick(feature, event, feature.center),
                    dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                  }}
                />
              ))
            : null}

            {showMeasurements ? <MeasurementOverlay draft={measurementDraft} /> : null}

            {showVertices && vertexDisplayOptions.sommets !== false && activeFeature?.rings?.length
              ? activeFeature.rings.flatMap((ring, ringIndex) =>
                  ring.map((point, index) => (
                    <CircleMarker
                      key={`vertex-${ringIndex}-${index}`}
                      center={point}
                      pane={MAP_PANES.measure}
                      radius={3}
                      pathOptions={{
                        color: "#FFFFFF",
                        fillColor: "#FFFFFF",
                        fillOpacity: 1,
                        opacity: 1,
                        weight: 0,
                      }}
                      interactive={false}
                    >
                      <Tooltip direction="top" permanent className="mapgeo-vertex-tooltip">
                        {activeFeature.rings.length > 1
                          ? `P${ringIndex + 1}-V${index + 1}`
                          : `V${index + 1}`}
                      </Tooltip>
                    </CircleMarker>
                  )),
                )
              : null}

            {showVertices && vertexDisplayOptions.dimensions !== false
              ? selectedMeasurementOverlay.sideMarkers.filter((item) => item.visible !== false).map((item) => (
                  <Marker
                    key={`selected-${item.id}`}
                    position={item.point}
                    pane={MAP_PANES.measure}
                    icon={createSideLabelIcon(item.label, item.tone, item.angle || 0)}
                    interactive={false}
                  />
                ))
              : null}

            {showMeasurements
              ? measurementDraftOverlay.sideMarkers.filter((item) => item.visible !== false).map((item) => (
                  <Marker
                    key={item.id}
                    position={item.point}
                    pane={MAP_PANES.measure}
                    icon={createSideLabelIcon(item.label, item.tone, item.angle || 0)}
                    interactive={false}
                  />
                ))
              : null}


          <InlineParcelEditLayer
            activeFeature={activeFeature}
            editing={inlineEditOpen}
            geometry={editGeometry}
            onGeometryChange={recordInlineGeometryChange}
            onGeometryGetterChange={(getter) => { editGeometryGetterRef.current = getter; }}
            deleteVertexMode={deleteVertexMode}
            geometryReloadKey={editLayerResetKey}
          />

          {inlineEditOpen
          ? editMeasurementOverlay.sideMarkers.filter((item) => item.visible !== false).map((item) => (
              <Marker
                key={item.id}
                position={item.point}
                pane={MAP_PANES.measure}
                icon={createSideLabelIcon(item.label, item.tone, item.angle || 0)}
                interactive={false}
              />
            ))
          : null}

        </MapContainer>

        <FloatingMapToolbar
          activeCommand={activeCommand}
          showLegend={showLegend}
          showLabels={showLabels}
          showMeasurements={showMeasurements}
          showVertices={showVertices}
          inlineEditActive={inlineEditOpen}
          activeFeature={activeFeature}
          canManageParcels={canManageParcels}
          activeBaseLayerId={layerState.activeBaseLayerId}
          baseLayers={layerState.baseLayers}
          onBaseSelect={layerState.setBaseLayer}
          setActiveCommand={setActiveCommand}
          setShowLegend={setShowLegend}
          setShowLabels={setShowLabels}
          setShowMeasurements={setShowMeasurements}
          setShowVertices={setShowVertices}
          onStartEdit={canManageParcels ? startInlineEdit : undefined}
          onStopEdit={closeInlineEdit}
          onOpenExportOptions={() => setShowPrintDialog(true)}
          onExportPng={handleExportPng}
          onExportJpeg={handleExportJpeg}
          onExportGeoJson={handleExportGeoJson}
        />

        <MapControlStack
          map={map}
          locationEnabled={userLocationEnabled}
          onToggleLocation={(nextEnabled) => setUserLocationEnabled((current) => (typeof nextEnabled === "boolean" ? nextEnabled : !current))}
          onLocationError={setUserLocationMessage}
        />
        {userLocationMessage ? (
          <div className="mapgeo-export-hidden absolute right-3 top-[172px] z-[930] max-w-[260px] rounded-2xl border border-mapgeo-sand/30 bg-[#07111b]/88 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur sm:left-5 sm:right-auto sm:top-[calc(50%+88px)]">
            {userLocationMessage}
          </div>
        ) : null}
        <NorthArrow />
        <MapStatusBar cursorPosition={cursorPosition} coordinateSystem={coordinateSystem} features={displayedFeatures} />
        <ViewportSampleNotice summary={viewportSummary} />

        {createParcelDrawingActive ? (
          <div
            className="mapgeo-create-draw-mobile-actions mapgeo-export-hidden pointer-events-auto absolute bottom-3 left-3 right-3 z-[960] rounded-2xl border border-mapgeo-sand/35 bg-[#07111b]/92 p-2.5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:hidden"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <p className="text-[11px] font-bold leading-4 text-white/65">
              Place les sommets sur la carte. Double-tape, Entrée ou Terminer pour valider.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={finishCreateParcelDrawing}
                disabled={!createParcelDraftGeometry}
                className="rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/15 px-3 py-2 text-xs font-extrabold text-mapgeo-ivory transition hover:bg-mapgeo-sand/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Terminer
              </button>
              <button
                type="button"
                onClick={removeLastCreateParcelDraftPoint}
                disabled={!createParcelDraftPoints.length}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={cancelCreateParcelDrawing}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition hover:bg-white/10"
              >
                Annuler
              </button>
              <span className="ml-auto text-[11px] font-bold text-white/45">{createParcelDraftPoints.length} sommet{createParcelDraftPoints.length > 1 ? "s" : ""}</span>
            </div>
          </div>
        ) : null}

        {map ? <MiniMap parentMap={map} activeBaseLayer={activeBaseLayer} /> : null}
        <LegendPanel
          open={showLegend}
          features={legendFeatures}
          activeLayers={layerState.operationalLayers}
          activeBaseLayer={activeBaseLayer}
          onToggleLayer={layerState.toggleLayer}
        />

        {searchTerm.trim() && !filteredFeatures.length ? (
          <SearchNoResultNotice searchTerm={searchTerm} onClearSearch={onClearSearch} />
        ) : null}

        <MapToolFeedbackPanel
          map={map}
          showMeasurements={showMeasurements}
          showVertices={showVertices}
          activeFeature={activeFeature}
          measurementSummary={measurementSummary}
          measurementDraft={measurementDraft}
          measurementDraftSummary={measurementDraftSummary}
          isMobileMeasurePanel={isMobileCartography}
          setMeasurementDraft={setMeasurementDraft}
          setShowMeasurements={setShowMeasurements}
          setShowVertices={setShowVertices}
          vertexDisplayOptions={vertexDisplayOptions}
          onToggleVertexDisplay={toggleVertexDisplayOption}
          onFinishMeasurement={finishMeasurementDraft}
        />

        {canManageParcels && inlineEditOpen ? (
            <InlineParcelEditPanel
            activeFeature={activeFeature}
            form={editForm}
            setForm={setEditForm}
            geometry={editGeometry}
            saving={editSaving}
            message={editMessage}
            validationResult={editValidation}
            deleteVertexMode={deleteVertexMode}
            setDeleteVertexMode={setDeleteVertexMode}
            canUndo={editHistoryIndex > 0}
            canRedo={editHistoryIndex >= 0 && editHistoryIndex < editHistory.length - 1}
            onUndo={undoInlineEdit}
            onRedo={redoInlineEdit}
            onClose={closeInlineEdit}
            onSave={handleSaveInlineEdit}
            canArchiveParcels={canArchiveParcels}
            onDeleteParcel={canArchiveParcels ? handleDeleteInlineParcel : undefined}
          />
        ) : null}

        <ConfirmDialog config={confirmConfig} onCancel={() => setConfirmConfig(null)} onConfirm={() => confirmConfig?.onConfirm?.()} />
      </div>
    </section>
  );
}
