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
import { getParcelPathOptions } from "../parcelMapStyles";
import ManagedMapLayers from "../pro/ManagedMapLayers";
import { exportGeometryAsGeoJson, exportMapAsJpeg, exportMapAsPng } from "../pro/mapExport";
import LegendPanel from "../pro/LegendPanel";
import MiniMap from "../pro/MiniMap";
import IdentifyCard from "./IdentifyCard";
import FloatingMapToolbar from "./PortfolioMapToolbar";
import SearchNoResultNotice from "./SearchNoResultNotice";
import { MapRuntimeObserver, PortfolioViewport } from "./PortfolioViewport";
import { USER_LOCATION_FOCUS_ZOOM } from "../../../constants/mapConstants";
import { createParcelBadgeIcon, createSideLabelIcon, formatCoordinate, midpoint } from "./mapUtils";


const INLINE_EDIT_EVENTS = "pm:edit pm:update pm:markerdragend pm:dragend pm:vertexadded pm:vertexremoved pm:change pm:snapdrag";
const MEASUREMENT_CLICK_DELAY_MS = 180;
const MEASUREMENT_PAN_CLICK_GUARD_MS = 220;
const SNAP_TOLERANCE_PX = 24; // Augmenté de 18 à 24px pour plus de confort
const EDIT_VERTEX_TOLERANCE_PX = 16;
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

function isMobileCartographyViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 767px)")?.matches || window.innerWidth < 768;
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
      [MAP_PANES.parcels, 430, "auto"],
      [MAP_PANES.labels, 445, "auto"],
      [MAP_PANES.edit, 470, "auto"],
      [MAP_PANES.measure, 485, "none"],
    ];

    panes.forEach(([name, zIndex, pointerEvents]) => {
      const pane = map.getPane(name) || map.createPane(name);
      pane.style.zIndex = String(zIndex);
      pane.style.pointerEvents = pointerEvents;
    });
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

function buildSideMarkersFromRings(rings, tone = "default", closed = true) {
  const markers = [];
  (Array.isArray(rings) ? rings : []).forEach((ring, ringIndex) => {
    const cleanRing = stripMeasurementClosingPoint(ring).filter((point) => Array.isArray(point) && point.length >= 2);
    if (cleanRing.length < 2) return;
    const segmentCount = closed && cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const point = cleanRing[index];
      const nextPoint = cleanRing[(index + 1) % cleanRing.length];
      const distance = computeDistanceBetweenPoints(point, nextPoint);
      if (!Number.isFinite(distance) || distance <= 0) continue;
      markers.push({
        id: `${tone}-side-${ringIndex}-${index}`,
        point: midpoint(point, nextPoint),
        label: formatDistance(distance),
        tone,
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

function DraggableMapPanel({ children, className, initialOffset = { x: 0, y: 0 }, ariaLabel = "Déplacer le panneau" }) {
  const panelRef = useRef(null);
  const dragStateRef = useRef(null);
  const [offset, setOffset] = useState(initialOffset);

  const getSafeOffset = useCallback((nextOffset) => {
    if (typeof window === "undefined") return nextOffset;
    const panel = panelRef.current;
    if (!panel) return nextOffset;

    const rect = panel.getBoundingClientRect();
    const margin = 12;
    const minX = margin - rect.left + offset.x;
    const maxX = window.innerWidth - margin - rect.right + offset.x;
    const minY = margin - rect.top + offset.y;
    const maxY = window.innerHeight - margin - rect.bottom + offset.y;

    return {
      x: Math.min(Math.max(nextOffset.x, minX), maxX),
      y: Math.min(Math.max(nextOffset.y, minY), maxY),
    };
  }, [offset.x, offset.y]);

  const stopPanelEvent = (event) => stopLeafletPropagation(event);
  const resetPosition = useCallback(() => setOffset(initialOffset), [initialOffset]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      event.preventDefault?.();
      stopLeafletPropagation(event);
      setOffset(getSafeOffset({
        x: dragState.origin.x + event.clientX - dragState.startX,
        y: dragState.origin.y + event.clientY - dragState.startY,
      }));
    };

    const stopDragging = (event) => {
      if (!dragStateRef.current || (event?.pointerId !== undefined && dragStateRef.current.pointerId !== event.pointerId)) return;
      stopLeafletPropagation(event);
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [getSafeOffset]);

  useEffect(() => {
    const keepPanelVisible = () => setOffset((current) => getSafeOffset(current));
    window.addEventListener("resize", keepPanelVisible);
    return () => window.removeEventListener("resize", keepPanelVisible);
  }, [getSafeOffset]);

  const moveByKeyboard = (event) => {
    const step = event.shiftKey ? 32 : 12;
    const deltas = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };

    if (event.key === "Escape") {
      event.preventDefault?.();
      resetPosition();
      return;
    }

    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault?.();
    setOffset((current) => getSafeOffset({ x: current.x + delta.x, y: current.y + delta.y }));
  };

  const dragHandleProps = {
    role: "button",
    tabIndex: 0,
    "aria-label": ariaLabel,
    onPointerDown: (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault?.();
      stopLeafletPropagation(event);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: offset,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerUp: (event) => {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        stopLeafletPropagation(event);
        dragStateRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    onPointerCancel: () => {
      dragStateRef.current = null;
    },
    onKeyDown: moveByKeyboard,
    style: { touchAction: "none", userSelect: "none" },
  };

  return (
    <div
      ref={panelRef}
      className={className}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      onPointerDown={stopPanelEvent}
      onMouseDown={stopPanelEvent}
      onClick={stopPanelEvent}
      onDoubleClick={stopPanelEvent}
      onContextMenu={stopPanelEvent}
    >
      {typeof children === "function" ? children({ dragHandleProps, resetPosition }) : children}
    </div>
  );
}

function PanelMoveHandle({ dragHandleProps, onReset, onClose, closeLabel = "Fermer" }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
      <button
        type="button"
        {...dragHandleProps}
        className="inline-flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/40 transition hover:bg-white/[0.06] active:cursor-grabbing"
        title="Déplacer le panneau"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/26" />
        Déplacer
      </button>
      <button type="button" onClick={onReset} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white" title="Réinitialiser la position">
        <Undo2 size={13} />
      </button>
      {onClose ? (
        <button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white" title={closeLabel}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
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
      onErrorRef.current?.("Localisation indisponible sur ce navigateur.");
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
      onErrorRef.current?.("Localisation refusée ou indisponible. La carte n’a pas été déplacée.");
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
      onLocationError?.("Localisation indisponible sur ce navigateur.");
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
      onLocationError?.("Localisation refusée ou indisponible. La carte n’a pas été déplacée.");
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

function NorthArrow() {
  const overlayEventProps = {
    onPointerDown: stopLeafletPropagation,
    onMouseDown: stopLeafletPropagation,
    onClick: stopLeafletPropagation,
    onDoubleClick: stopLeafletPropagation,
    onContextMenu: stopLeafletPropagation,
  };

  return (
    <div
        {...overlayEventProps}
        className="mapgeo-export-hidden mapgeo-overlay-panel mapgeo-north-arrow pointer-events-auto absolute right-4 top-4 z-[935] hidden h-[72px] w-[54px] flex-col items-center justify-center rounded-[16px] border border-white/10 bg-[#07111b]/70 px-1.5 py-1.5 text-white shadow-[0_14px_38px_rgba(0,0,0,0.20)] backdrop-blur-xl md:flex"
        title="Nord"
        aria-label="Flèche nord"
      >
      <span className="mapgeo-north-label text-[11px] font-black leading-none tracking-[0.24em] text-white/80">N</span>
      <svg className="mt-1 h-12 w-10 text-white/80" viewBox="0 0 40 52" aria-hidden="true" focusable="false">
        <path d="M20 3L31 46L20 38L9 46L20 3Z" fill="currentColor" opacity="0.92" />
        <path d="M20 12L25.8 35.5L20 31.6V12Z" fill="#07111b" opacity="0.34" />
        <path d="M20 12L14.2 35.5L20 31.6V12Z" fill="white" opacity="0.22" />
        <path d="M20 3L31 46L20 38L9 46L20 3Z" fill="none" stroke="white" strokeOpacity="0.34" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
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

      {hasCursorPreview && !isMobileMeasureOverlay ? (
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

function MeasurementToolPanel({ open, map, measurementDraft, setMeasurementDraft, onClose, onFinish }) {
  if (!open) return null;

  const draftSummary = buildMeasurementDraftSummary(measurementDraft);

  const setMode = (mode) => setMeasurementDraft((current) => ({
    mode,
    points: current?.mode === mode ? current.points : [],
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const addPointFromCenter = () => {
    if (!map) return;

    const center = map.getCenter();
    setMeasurementDraft((current) => ({
      mode: current?.mode || "distance",
      points: [...(current?.points || []), [center.lat, center.lng]],
      cursorPoint: null,
      snapPoint: null,
      snapKind: null,
      finished: false,
    }));
  };

  const undoPoint = () => setMeasurementDraft((current) => ({
    ...current,
    points: (current?.points || []).slice(0, -1),
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const resetPoints = () => setMeasurementDraft((current) => ({
    ...current,
    points: [],
    cursorPoint: null,
    snapPoint: null,
    snapKind: null,
    finished: false,
  }));

  const pointCount = measurementDraft?.points?.length || 0;

  return (
    <>
      <div className="mapgeo-measure-center-reticle" aria-hidden="true">
        <span />
      </div>

      <DraggableMapPanel
        className="mapgeo-mobile-tool-panel mapgeo-measure-panel mapgeo-export-hidden mapgeo-panel-enter absolute bottom-3 left-3 right-3 top-auto z-[950] max-h-[45%] overflow-y-auto rounded-[18px] border border-white/10 bg-[#07111b]/96 p-3 text-white shadow-[0_22px_68px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[300px] sm:max-w-[calc(100%-2rem)] sm:max-h-[calc(100%-160px)]"
        ariaLabel="Déplacer le bloc Mesures"
      >
        {({ dragHandleProps, resetPosition }) => (
          <>
            <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} onClose={onClose} closeLabel="Fermer les mesures" />

            <div className="mapgeo-mobile-measure-header flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Ruler size={16} className="text-mapgeo-sand" />
                <h3 className="truncate text-sm font-extrabold">Mesurer</h3>
              </div>
              <span className="rounded-full bg-mapgeo-sand/20 px-2 py-0.5 text-[10px] font-bold text-mapgeo-sand">
                {pointCount} pt{pointCount > 1 ? "s" : ""}
              </span>
            </div>

            <p className="mapgeo-measure-help mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold leading-5 text-white/55">
              Centrez la carte sur le point, puis ajoutez-le.
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("distance")} className={`rounded-xl px-3 py-2 text-xs font-extrabold transition ${measurementDraft.mode === "distance" ? "bg-mapgeo-primary text-white" : "bg-white/[0.055] text-white/70 hover:bg-white/10"}`}>
                Distance
              </button>
              <button type="button" onClick={() => setMode("surface")} className={`rounded-xl px-3 py-2 text-xs font-extrabold transition ${measurementDraft.mode === "surface" ? "bg-mapgeo-primary text-white" : "bg-white/[0.055] text-white/70 hover:bg-white/10"}`}>
                Surface
              </button>
            </div>

            <div className="mt-2 grid gap-1.5">
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Distance</span>
                <strong className="text-right text-white">{draftSummary.distanceLabel}</strong>
              </div>
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Surface</span>
                <strong className="text-right text-white">{draftSummary.surfaceLabel}</strong>
              </div>
              <div className="mapgeo-measure-result-row flex justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5">
                <span className="text-white/60">Périmètre</span>
                <strong className="text-right text-white">{draftSummary.perimeterLabel}</strong>
              </div>
            </div>

            <div className="mapgeo-measure-actions mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={addPointFromCenter} className="inline-flex items-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/15 px-3 py-2 text-xs font-bold text-mapgeo-ivory hover:bg-mapgeo-sand/25">
                <Plus size={14} /> Ajouter
              </button>
              <button type="button" onClick={onFinish} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-3 py-2 text-xs font-bold text-mapgeo-ivory hover:bg-mapgeo-sand/20 disabled:cursor-not-allowed disabled:opacity-35">
                <Check size={14} /> Terminer
              </button>
              <button type="button" onClick={undoPoint} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">
                <Undo2 size={14} /> Annuler
              </button>
              <button type="button" onClick={resetPoints} disabled={!pointCount} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">
                <Trash2 size={14} /> Vider
              </button>
            </div>
          </>
        )}
      </DraggableMapPanel>
    </>
  );
}


function VertexToolPanel({ open, activeFeature, measurementSummary, displayOptions = DEFAULT_VERTEX_DISPLAY_OPTIONS, onToggleDisplay, onClose, shiftLeft = false }) {
  if (!open) return null;

  const hasGeometry = Boolean(activeFeature?.rings?.length);
  const rows = [
    { key: "sommets", label: "Sommets", value: measurementSummary?.vertexCount || 0 },
    { key: "dimensions", label: "Dimensions", value: measurementSummary?.sideCount ? `${measurementSummary.sideCount} côtés` : "—" },
  ];

  return (
    <DraggableMapPanel
      className="mapgeo-mobile-tool-panel mapgeo-vertices-panel mapgeo-export-hidden mapgeo-panel-enter absolute bottom-3 left-3 right-3 top-auto z-[949] max-h-[45%] overflow-y-auto rounded-[18px] border border-white/10 bg-[#07111b]/96 p-3 text-white shadow-[0_22px_68px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[270px] sm:max-w-[calc(100%-2rem)] sm:max-h-[calc(100%-160px)]"
      initialOffset={shiftLeft ? { x: -316, y: 0 } : { x: 0, y: 0 }}
      ariaLabel="Déplacer le bloc Sommets"
    >
      {({ dragHandleProps, resetPosition }) => (
        <>
          <PanelMoveHandle dragHandleProps={dragHandleProps} onReset={resetPosition} onClose={onClose} closeLabel="Fermer les sommets" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Info size={16} className="text-mapgeo-sand" />
              <h3 className="truncate text-sm font-extrabold">Sommets</h3>
            </div>
            <span className="rounded-full bg-mapgeo-sand/20 px-2 py-0.5 text-[10px] font-bold text-mapgeo-sand">Actif</span>
          </div>
          {hasGeometry ? (
            <>
              <div className="mt-2 grid gap-1.5 text-sm">
                {rows.map((row) => {
                  const active = displayOptions[row.key] !== false;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => onToggleDisplay?.(row.key)}
                      className={`flex justify-between gap-3 rounded-xl border px-3 py-1.5 text-left transition ${active ? "border-mapgeo-sand/40 bg-white/[0.075] text-white" : "border-white/10 bg-white/[0.025] text-white/40"}`}
                      aria-pressed={active}
                      title={active ? `Masquer ${row.label.toLowerCase()}` : `Afficher ${row.label.toLowerCase()}`}
                    >
                      <span className="text-white/60">{row.label}</span>
                      <strong className="text-right text-white">{row.value}</strong>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold leading-5 text-white/50">
Activez les éléments à afficher sur la carte.
              </p>
            </>
          ) : (
            <p className="mt-2 rounded-xl border border-mapgeo-sand/35 bg-mapgeo-sand/15 px-3 py-2 text-xs font-semibold leading-5 text-mapgeo-ivory">
              Sélectionnez une parcelle contenant un polygone.
            </p>
          )}
        </>
      )}
    </DraggableMapPanel>
  );
}

function MapToolFeedbackPanel({ map, showMeasurements, showVertices, activeFeature, measurementSummary, measurementDraft, setMeasurementDraft, setShowMeasurements, setShowVertices, vertexDisplayOptions, onToggleVertexDisplay, onFinishMeasurement }) {
  if (!showMeasurements && !showVertices) return null;

  return (
    <>
      <MeasurementToolPanel
        open={showMeasurements}
        map={map}
        measurementDraft={measurementDraft}
        setMeasurementDraft={setMeasurementDraft}
        onClose={() => setShowMeasurements(false)}
        onFinish={onFinishMeasurement}
      />
      <VertexToolPanel
        key={showMeasurements ? "vertices-with-measure" : "vertices-only"}
        open={showVertices}
        activeFeature={activeFeature}
        measurementSummary={measurementSummary}
        displayOptions={vertexDisplayOptions}
        onToggleDisplay={onToggleVertexDisplay}
        onClose={() => setShowVertices(false)}
        shiftLeft={showMeasurements}
      />
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
    preventMarkerRemoval: false,
    removeLayerBelowMinVertexCount: false,
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
    const editOptions = layerEditOptionsRef.current;

    map.pm?.disableDraw?.();
    map.pm?.disableGlobalEditMode?.();
    map.pm?.disableGlobalRemovalMode?.();
    map.pm?.disableGlobalDragMode?.();
    map.pm?.disableGlobalCutMode?.();
    map.pm?.removeControls?.();

    const syncNow = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      onGeometryChangeRef.current?.(collectGeometryFromLayerGroup(group));
    };

    const scheduleSync = () => {
      if (animationFrameRef.current) return;
      animationFrameRef.current = requestAnimationFrame(syncNow);
    };

    const cleanupEditableLayer = (layer) => {
      layer.off?.(INLINE_EDIT_EVENTS, scheduleSync);
      if (layer.__mapgeoAddVertexHandler) layer.off?.("dblclick", layer.__mapgeoAddVertexHandler);
      if (layer.__mapgeoDeleteVertexHandler) layer.off?.("click", layer.__mapgeoDeleteVertexHandler);
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
      layer.options.bubblingMouseEvents = false;
      layer.setStyle?.(INLINE_EDIT_STYLE);
      layer.pm?.enable?.(editOptions);

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
      layer.on("click", deleteVertexHandler);
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
          style: INLINE_EDIT_STYLE,
          pmIgnore: false,
        }).eachLayer((layer) => {
          registerEditableLayer(layer);
        });

        if (keepVisible) keepBoundsVisibleWithoutZoom(map, group.getBounds());
      }

      if (sync) syncNow();
    };

    reloadGeometryRef.current = (nextGeometry) => loadGeometryIntoGroup(nextGeometry, { keepVisible: false, sync: false });
    loadGeometryIntoGroup(geometryRef.current || activeFeature.parcel?.geometry, { keepVisible: true, sync: true });

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
    map.doubleClickZoom?.disable?.();

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
      map.off("mousemove", handleMouseMove);
      map.off("mouseout", handleMouseOut);
      map.off(INLINE_EDIT_EVENTS, handleSync);
      group.off(INLINE_EDIT_EVENTS, handleSync);
      window.removeEventListener("keydown", handleKeyDown);
      onGeometryGetterChangeRef.current?.(null);
      group.eachLayer(cleanupEditableLayer);
      map.pm?.disableDraw?.();
      map.pm?.disableGlobalEditMode?.();
      map.pm?.disableGlobalRemovalMode?.();
      map.pm?.disableGlobalDragMode?.();
      map.pm?.disableGlobalCutMode?.();
      map.pm?.removeControls?.();
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
  onInlineEditStateChange,
}) {
  const [activeCommand, setActiveCommand] = useState(null);
  const [measurementDraft, setMeasurementDraft] = useState({ mode: "distance", points: [], cursorPoint: null, snapPoint: null, snapKind: null, finished: false });
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [deleteVertexMode, setDeleteVertexMode] = useState(false);
  const [userLocationEnabled, setUserLocationEnabled] = useState(false);
  const [userLocationMessage, setUserLocationMessage] = useState("");
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
  const measurementSummary = useMemo(() => buildMeasurementSummary(activeFeature), [activeFeature]);
  const editMeasurementOverlay = useMemo(() => buildGeometryMeasurementOverlay(editGeometry, "edit"), [editGeometry]);
  const editValidation = useMemo(() => (inlineEditOpen ? validateParcelGeometry(editGeometry, activeFeature?.parcel || {}) : null), [activeFeature, editGeometry, inlineEditOpen]);

  useEffect(() => {
    onInlineEditStateChange?.(inlineEditOpen);
  }, [inlineEditOpen, onInlineEditStateChange]);

  useEffect(() => {
    editGeometryRef.current = editGeometry;
  }, [editGeometry]);
  const selectedMeasurementOverlay = useMemo(() => buildGeometryMeasurementOverlay(activeFeature?.parcel?.geometry, "measure"), [activeFeature]);
  const measurementDraftOverlay = useMemo(() => buildMeasurementDraftOverlay(measurementDraft), [measurementDraft]);
  const labelFeatures = useMemo(() => {
    const withGeometry = displayedFeatures.filter(
      (feature) =>
        feature?.rings?.length > 0 &&
        Array.isArray(feature.center) &&
        feature.center.length === 2 &&
        Number.isFinite(Number(feature.center[0])) &&
        Number.isFinite(Number(feature.center[1])),
    );

    if (viewMode === "selection") {
      if (!activeFeature?.id) return [];

      return withGeometry.filter(
        (feature) => String(feature.id) === String(activeFeature.id),
      );
    }

    return withGeometry;
  }, [displayedFeatures, viewMode, activeFeature?.id]);

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
    map.doubleClickZoom?.disable?.();

    return () => {
      container?.classList?.remove("mapgeo-measure-mode");
      map.doubleClickZoom?.disable?.();
      clearPendingMeasurementClick();
    };
  }, [clearPendingMeasurementClick, map, showMeasurements]);

  useEffect(() => {
    if (showMeasurements) setIdentifyState(null);
  }, [showMeasurements, setIdentifyState]);


  // MOBILE_MEASURE_CENTER_PREVIEW_EFFECT_FINAL
  // Sur téléphone, le trait de mesure suit le réticule central pendant le déplacement de la carte.
  useEffect(() => {
    if (!map || !showMeasurements) return undefined;
    if (!isMobileCartographyViewport()) return undefined;

    const syncCenterPreview = () => {
      const center = map.getCenter?.();
      if (!center) return;

      const point = [center.lat, center.lng];

      setMeasurementDraft((current) => {
        if (!current || current.finished) return current;

        return {
          ...current,
          cursorPoint: point,
          snapPoint: null,
          snapKind: null,
        };
      });
    };

    // Mobile: do not update the measurement line while the user touches or drags the map.
    // The measurement changes only when the user presses Ajouter.
    return undefined;
  }, [map, showMeasurements, setMeasurementDraft]);

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
    if (isMobileCartographyViewport()) {
      clearPendingMeasurementClick();
      return;
    }

    if (!showMeasurements || !Array.isArray(point) || point.length < 2) return;
    clearPendingMeasurementClick();
    measurementClickTimerRef.current = window.setTimeout(() => {
      const snap = resolveMeasurementPoint(point);
      appendMeasurementPoint(snap.point, snap);
      measurementClickTimerRef.current = null;
    }, MEASUREMENT_CLICK_DELAY_MS);
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
    if (!feature || inlineEditOpen) return;

    setActiveCommand(null);

    if (showMeasurements) {
      setIdentifyState(null);

      // Mobile: points are added only with the Ajouter button.
      if (isMobileCartographyViewport()) {
        clearPendingMeasurementClick();
        return;
      }

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
        <MapContainer center={activeFeature?.center || DEFAULT_MAP_CENTER} zoom={16} minZoom={2} maxZoom={22} doubleClickZoom={false} className={`h-full w-full ${showMeasurements ? "mapgeo-measure-mode" : ""}`} zoomControl={false}>
          <MapPaneController />
          <PortfolioViewport mode={viewMode} activeFeature={activeFeature} features={viewportFeatures} onMapReady={setMap} viewportRequest={viewportRequest} onZoomChange={setMapZoom} />
          <MapRuntimeObserver
            onMouseMove={(point) => {
              setCursorPosition(point);

              if (showMeasurements) {
                // Mobile : le toucher écran ne doit ni créer, ni déplacer, ni prévisualiser un point.
                if (isMobileCartographyViewport()) return;

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
              if (inlineEditOpen) return;
              setActiveCommand(null);
              if (showMeasurements) {
                setIdentifyState(null);

                // Mobile: points are added only with the Ajouter button.
                if (isMobileCartographyViewport()) {
                  clearPendingMeasurementClick();
                  return;
                }

                if (event?.originalEvent?.detail > 1 || shouldIgnoreMeasurementClickAfterPan()) {
                  clearPendingMeasurementClick();
                  return;
                }
                queueMeasurementPoint(point);
                return;
              }
              setIdentifyState(null);
            }}
            onMapDoubleClick={() => {
              if (!inlineEditOpen && showMeasurements) clearPendingMeasurementClick();
            }}
            onMapDragStart={() => {
              if (!inlineEditOpen && showMeasurements) clearPendingMeasurementClick();
            }}
            onMapDragEnd={() => {
              if (!inlineEditOpen && showMeasurements) lastMeasurementPanAtRef.current = Date.now();
            }}
            onMapContextMenu={() => {
              if (!inlineEditOpen && showMeasurements) finishMeasurementDraft();
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

          {parcelLayerVisible ? displayedFeatures.map((feature) => {
            const isActive = String(feature.id) === String(activeFeature?.id);
            if (inlineEditOpen && isActive) return null;
            return feature.rings.length ? (
              <Polygon
                key={getFeatureRenderKey(feature, "polygon")}
                positions={feature.positions}
                pane={MAP_PANES.parcels}
                pathOptions={getParcelPathOptions(feature.parcel, {
                  active: isActive,
                  hovered: String(feature.id) === String(hoveredFeatureId),
                  hasDocuments: feature.documents.length > 0,
                  editing: inlineEditOpen && isActive,
                  geometryError: Boolean(feature.geometryWarning),
                })}
                eventHandlers={{
                  click: (event) => handleParcelLayerClick(feature, event),
                  dblclick: (event) => handleParcelLayerDoubleClick(feature, event),
                  mouseover: () => setHoveredFeatureId(feature.id),
                  mouseout: () => setHoveredFeatureId(null),
                }}
              >
                <Tooltip sticky>
                  {feature.parcel.reference} · {feature.statusLabel}
                </Tooltip>
              </Polygon>
            ) : null;
          }) : null}

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
                      radius={7}
                      pathOptions={{
                        color: MEASURE_STYLE.vertexBorder,
                        fillColor: MEASURE_STYLE.vertexFill,
                        fillOpacity: 0.96,
                        opacity: 1,
                        weight: 2.5,
                      }}
                      interactive={false}
                    >
                      <Tooltip direction="top" permanent>
                        {activeFeature.rings.length > 1
                          ? `P${ringIndex + 1}-V${index + 1}`
                          : `V${index + 1}`}
                      </Tooltip>
                    </CircleMarker>
                  )),
                )
              : null}

            {showVertices && vertexDisplayOptions.dimensions !== false
              ? selectedMeasurementOverlay.sideMarkers.map((item) => (
                  <Marker
                    key={`selected-${item.id}`}
                    position={item.point}
                    pane={MAP_PANES.measure}
                    icon={createSideLabelIcon(item.label, item.tone)}
                    interactive={false}
                  />
                ))
              : null}

            {showMeasurements
              ? measurementDraftOverlay.sideMarkers.map((item) => (
                  <Marker
                    key={item.id}
                    position={item.point}
                    pane={MAP_PANES.measure}
                    icon={createSideLabelIcon(item.label, item.tone)}
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
          ? editMeasurementOverlay.sideMarkers.map((item) => (
              <Marker
                key={item.id}
                position={item.point}
                pane={MAP_PANES.measure}
                icon={createSideLabelIcon(item.label, item.tone)}
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


