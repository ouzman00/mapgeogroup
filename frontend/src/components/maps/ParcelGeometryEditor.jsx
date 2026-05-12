import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { FeatureGroup, GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileUp,
  History,
  Info,
  Lock,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  Unlock,
  XCircle,
} from "lucide-react";
import useGeometryEditLock from "./hooks/useGeometryEditLock";
import {
  DEFAULT_MAP_CENTER,
  geometryCentroidProjected,
  geometryToCoordinateText,
  normalizeCoordinateValue,
  toMultiPolygonGeometry,
} from "../../utils/parcelGeometry";
import {
  GEOMETRY_IMPORT_CRS_OPTIONS,
  WGS84_GEOGRAPHIC_CRS,
  getDefaultSourceCrsForFormat,
  downloadGeometryAsGeoJson,
  normalizeToMultiPolygon,
  projectedGeometryToWgs84,
  parseGeometryByFormat,
} from "../../utils/geometryIo";
import { multiPolygonAreaM2, validateParcelGeometry } from "../../utils/geometryTopology";

const EDIT_STYLE = { color: "#2563EB", fillColor: "#DBEAFE", fillOpacity: 0.22, weight: 3.5, dashArray: "10 6" };
const BEFORE_STYLE = { color: "#B45309", fillColor: "#F59E0B", fillOpacity: 0.08, weight: 2, dashArray: "6 6" };
const SNAP_STYLE = { color: "#059669", fillColor: "#10B981", fillOpacity: 0.06, weight: 2, dashArray: "4 6" };
const EDIT_VERTEX_TOLERANCE_PX = 16;

function ConfirmDialog({ config, onCancel, onConfirm }) {
  if (!config) return null;

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-mapgeo-primary/40 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={config.title}>
      <div className="w-full max-w-md rounded-3xl border border-mapgeo-line bg-white p-6 text-mapgeo-primary shadow-panel">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-700">
            <AlertTriangle size={20} />
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

function cloneGeometry(geometry) {
  if (!geometry) return null;
  return JSON.parse(JSON.stringify(geometry));
}

function geometryKey(geometry) {
  return JSON.stringify(geometry || null);
}

function collectGeometryFromLayerGroup(group) {
  const polygonFeatures = [];

  group.eachLayer((layer) => {
    if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
      const feature = layer.toGeoJSON();
      if (feature?.geometry?.type === "Polygon") {
        polygonFeatures.push(feature.geometry.coordinates);
      }
      if (feature?.geometry?.type === "MultiPolygon") {
        polygonFeatures.push(...feature.geometry.coordinates);
      }
    }
  });

  if (!polygonFeatures.length) return null;
  return normalizeToMultiPolygon(
    { type: "MultiPolygon", coordinates: polygonFeatures },
    { sourceCrs: WGS84_GEOGRAPHIC_CRS },
  );
}

function buildStats(nextGeometry) {
  const geometry = normalizeToMultiPolygon(nextGeometry);
  const center = geometryCentroidProjected(geometry);
  return {
    polygonCount: geometry?.coordinates?.length || 0,
    ringCount: geometry?.coordinates?.reduce((total, polygon) => total + polygon.length, 0) || 0,
    holeCount: geometry?.coordinates?.reduce((total, polygon) => total + Math.max(0, polygon.length - 1), 0) || 0,
    vertexCount:
      geometry?.coordinates?.reduce(
        (total, polygon) =>
          total +
          polygon.reduce((ringTotal, ring) => {
            const ringWithoutClosure = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
              ? ring.slice(0, -1)
              : ring;
            return ringTotal + ringWithoutClosure.length;
          }, 0),
        0,
      ) || 0,
    areaM2: multiPolygonAreaM2(geometry),
    center,
  };
}

function formatArea(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  if (numeric >= 10000) return `${(numeric / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ha`;
  return `${numeric.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m²`;
}

function formatCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(7) : "";
}

function getRingWithoutClosingPoint(ring) {
  if (!Array.isArray(ring)) return [];
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) return ring.slice(0, -1);
  return ring;
}

function pixelDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestPointOnSegment(target, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: start, distance: pixelDistance(target, start) };
  const ratio = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared));
  const point = L.point(start.x + ratio * dx, start.y + ratio * dy);
  return { point, distance: pixelDistance(target, point) };
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
      if (!best || closest.distance < best.distance) best = { distance: closest.distance, ring, insertIndex: index + 1 };
    }
  });

  return best && best.distance <= EDIT_VERTEX_TOLERANCE_PX ? best : null;
}

function isNearExistingVertex(map, ring, latlng, tolerance = 10) {
  if (!map || !latlng || !Array.isArray(ring)) return false;
  const target = map.latLngToLayerPoint(latlng);
  return ring.some((vertex) => pixelDistance(target, map.latLngToLayerPoint(vertex)) <= tolerance);
}

function refreshLayerEdition(layer, editOptions) {
  layer.pm?.disable?.();
  layer.pm?.enable?.(editOptions);
}

function buildVertexRows(geometry) {
  const normalized = normalizeToMultiPolygon(geometry);
  if (!normalized) return [];

  return normalized.coordinates.flatMap((polygon, polygonIndex) =>
    polygon.flatMap((ring, ringIndex) =>
      getRingWithoutClosingPoint(ring).map(([lng, lat], vertexIndex) => ({
        id: `${polygonIndex}-${ringIndex}-${vertexIndex}`,
        polygonIndex,
        ringIndex,
        vertexIndex,
        label: `P${polygonIndex + 1}.${ringIndex + 1}.${vertexIndex + 1}`,
        longitude: lng,
        latitude: lat,
      })),
    ),
  );
}

function updateVertexInGeometry(geometry, selectedVertex, latitude, longitude) {
  const normalized = normalizeToMultiPolygon(geometry);
  if (!normalized || !selectedVertex) return geometry;

  const next = cloneGeometry(normalized);
  const ring = next.coordinates[selectedVertex.polygonIndex]?.[selectedVertex.ringIndex];
  if (!ring) return normalized;

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return normalized;

  ring[selectedVertex.vertexIndex] = [lng, lat];
  if (selectedVertex.vertexIndex === 0 && ring.length > 1) ring[ring.length - 1] = [lng, lat];
  if (selectedVertex.vertexIndex === ring.length - 1) ring[0] = [lng, lat];
  return normalizeToMultiPolygon(next);
}

function appendVertexToPrimaryRing(geometry, latitude, longitude) {
  const normalized = normalizeToMultiPolygon(geometry);
  if (!normalized) return null;

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return normalized;

  const next = cloneGeometry(normalized);
  const ring = next.coordinates[0]?.[0];
  if (!ring) return normalized;

  const insertIndex = Math.max(0, ring.length - 1);
  ring.splice(insertIndex, 0, [lng, lat]);
  ring[ring.length - 1] = ring[0];
  return normalizeToMultiPolygon(next);
}

function getReferenceGeometryCollection(parcel) {
  const values = [
    parcel?.neighbor_geometries,
    parcel?.adjacent_geometries,
    parcel?.overlap_check_geometries,
    parcel?.nearby_parcel_geometries,
    parcel?.cadastre_geometries,
    parcel?.cadastre_geometry,
  ].flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));

  const features = values
    .map((entry, index) => {
      const geometry = normalizeToMultiPolygon(entry?.geometry || entry);
      if (!geometry) return null;
      return { type: "Feature", id: entry?.id || `reference-${index}`, properties: {}, geometry };
    })
    .filter(Boolean);

  return features.length ? { type: "FeatureCollection", features } : null;
}

function distanceOfLatLngs(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return 0;
  return latlngs.reduce((total, current, index) => {
    if (index === 0) return total;
    return total + latlngs[index - 1].distanceTo(current);
  }, 0);
}

function measureWorkingLayer(layer, shape) {
  if (!layer) return "";

  if (shape === "Polygon") {
    const latlngs = layer.getLatLngs?.()?.[0] || [];
    if (latlngs.length < 3) return `${latlngs.length} sommet${latlngs.length > 1 ? "s" : ""}`;
    const ring = latlngs.map((latlng) => [latlng.lng, latlng.lat]);
    ring.push(ring[0]);
    return `Surface en cours : ${formatArea(multiPolygonAreaM2({ type: "MultiPolygon", coordinates: [[ring]] }))}`;
  }

  const latlngs = layer.getLatLngs?.() || [];
  const distance = distanceOfLatLngs(latlngs);
  return `Distance en cours : ${distance.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m`;
}

function GeometryEditorController({ sourceGeometry, editable, revision, onGeometryDraft, setStats, setSelectedVertex, setMeasure }) {
  const map = useMap();
  const groupRef = useRef(null);
  const sourceGeometryRef = useRef(sourceGeometry);
  const callbacksRef = useRef({ onGeometryDraft, setStats, setSelectedVertex, setMeasure });

  useEffect(() => {
    sourceGeometryRef.current = sourceGeometry;
  }, [sourceGeometry]);

  useEffect(() => {
    callbacksRef.current = { onGeometryDraft, setStats, setSelectedVertex, setMeasure };
  }, [onGeometryDraft, setMeasure, setSelectedVertex, setStats]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;

    map.pm.removeControls();

    const editOptions = {
      allowSelfIntersection: false,
      snappable: true,
      snapDistance: 18,
      snapMiddle: true,
      snapSegment: true,
      preventMarkerRemoval: false,
      removeLayerBelowMinVertexCount: false,
    };

    map.pm.setGlobalOptions({
      continueDrawing: false,
      snappable: true,
      snapDistance: 18,
      snapMiddle: true,
      snapSegment: true,
      allowSelfIntersection: false,
      finishOn: "dblclick",
      templineStyle: { color: "#123B5D" },
      hintlineStyle: { color: "#C7B299", dashArray: "5 5" },
      pathOptions: EDIT_STYLE,
    });

    const syncGeometry = () => {
      const nextGeometry = collectGeometryFromLayerGroup(group);
      callbacksRef.current.setStats(buildStats(nextGeometry));
      callbacksRef.current.onGeometryDraft?.(nextGeometry);
    };

    const loadGeometry = () => {
      group.clearLayers();
      const geometry = normalizeToMultiPolygon(toMultiPolygonGeometry(sourceGeometryRef.current));
      if (!geometry) {
        callbacksRef.current.setStats(buildStats(null));
        callbacksRef.current.setSelectedVertex(null);
        if (!editable) map.setView(DEFAULT_MAP_CENTER, 13, { animate: false });
        return;
      }

      const layer = L.geoJSON(projectedGeometryToWgs84(geometry), {
        style: EDIT_STYLE,
        pmIgnore: !editable,
      });

      layer.eachLayer((featureLayer) => {
        featureLayer.options.pmIgnore = !editable;
        featureLayer.on("click", () => callbacksRef.current.setSelectedVertex(null));
        featureLayer.on("dblclick", (event) => {
          if (!editable) return;
          L.DomEvent.stop(event?.originalEvent || event);
          const latlng = event?.latlng;
          const nearest = findNearestEditableSegment(map, featureLayer, latlng);
          if (!nearest || isNearExistingVertex(map, nearest.ring, latlng)) return;
          nearest.ring.splice(nearest.insertIndex, 0, L.latLng(latlng.lat, latlng.lng));
          featureLayer.setLatLngs(featureLayer.getLatLngs());
          featureLayer.redraw?.();
          refreshLayerEdition(featureLayer, editOptions);
          syncGeometry();
        });
        group.addLayer(featureLayer);
      });

      const bounds = group.getBounds?.();
      if (bounds?.isValid?.()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: false });
      }
      callbacksRef.current.setStats(buildStats(geometry));
    };

    loadGeometry();

    const doubleClickZoomWasEnabled = map.doubleClickZoom?.enabled?.() ?? false;
    if (editable) map.doubleClickZoom?.disable?.();

    if (editable) {
      map.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircle: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: false,
        drawText: false,
        drawPolygon: true,
        cutPolygon: true,
        removalMode: true,
        editMode: true,
        dragMode: false,
        rotateMode: false,
        oneBlock: false,
      });
    }

    const handleCreate = (event) => {
      event.layer.options.pmIgnore = false;
      group.addLayer(event.layer);
      syncGeometry();
    };
    const handleEdit = () => syncGeometry();
    const handleCut = () => syncGeometry();
    const handleRemove = () => syncGeometry();
    const handleDrawStart = (event) => {
      const workingLayer = event.workingLayer;
      const shape = event.shape;
      const refreshMeasure = () => callbacksRef.current.setMeasure(measureWorkingLayer(workingLayer, shape));
      refreshMeasure();
      workingLayer?.on?.("pm:vertexadded pm:vertexremoved pm:snapdrag pm:change", refreshMeasure);
      workingLayer?.on?.("mousemove", refreshMeasure);
    };
    const handleDrawEnd = () => callbacksRef.current.setMeasure("");

    if (editable) {
      map.on("pm:create", handleCreate);
      map.on("pm:edit", handleEdit);
      map.on("pm:cut", handleCut);
      map.on("pm:remove", handleRemove);
      map.on("pm:dragend", handleEdit);
      map.on("pm:drawstart", handleDrawStart);
      map.on("pm:drawend", handleDrawEnd);
    }

    return () => {
      map.off("pm:create", handleCreate);
      map.off("pm:edit", handleEdit);
      map.off("pm:cut", handleCut);
      map.off("pm:remove", handleRemove);
      map.off("pm:dragend", handleEdit);
      map.off("pm:drawstart", handleDrawStart);
      map.off("pm:drawend", handleDrawEnd);
      map.pm.disableDraw?.();
      map.pm.disableGlobalEditMode?.();
      map.pm.disableGlobalRemovalMode?.();
      map.pm.disableGlobalCutMode?.();
      map.pm.removeControls();
      if (doubleClickZoomWasEnabled) map.doubleClickZoom?.enable?.();
    };
  }, [editable, map, revision]);

  return <FeatureGroup ref={groupRef} />;
}

function ReferenceGeometryLayer({ parcel, visible }) {
  const map = useMap();
  const collection = useMemo(() => getReferenceGeometryCollection(parcel), [parcel]);

  useEffect(() => {
    if (!collection || !visible) return undefined;

    const layer = L.geoJSON(projectedGeometryToWgs84(collection), {
      style: SNAP_STYLE,
      interactive: false,
      pmIgnore: false,
    }).addTo(map);

    layer.eachLayer((featureLayer) => {
      featureLayer.options.pmIgnore = false;
    });

    return () => layer.remove();
  }, [collection, map, visible]);

  return null;
}

function StatusBadge({ status }) {
  const config = {
    valid: { label: "Valide", icon: CheckCircle2, className: "bg-mapgeo-primary/6 text-mapgeo-primary border-mapgeo-line" },
    warning: { label: "Avertissement", icon: AlertTriangle, className: "bg-mapgeo-sand/10 text-mapgeo-primary border-mapgeo-sand/40" },
    blocking: { label: "Bloquant", icon: XCircle, className: "bg-mapgeo-sand/10 text-mapgeo-primary border-mapgeo-sand/40" },
  }[status || "blocking"];

  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${config.className}`}>
      <Icon size={14} /> {config.label}
    </span>
  );
}

function IssueList({ validation }) {
  const items = validation?.issues || [];
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`${item.code}-${index}`}
          className={`rounded-2xl border px-3 py-2 text-sm ${
            item.level === "blocking"
              ? "border-mapgeo-sand/40 bg-mapgeo-sand/10 text-mapgeo-primary"
              : item.level === "warning"
                ? "border-mapgeo-sand/40 bg-mapgeo-sand/10 text-mapgeo-primary"
                : "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary"
          }`}
        >
          <div className="font-semibold">{item.message}</div>
          {item.details ? <div className="mt-1 text-xs opacity-80">{item.details}</div> : null}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-mapgeo-secondary/60">{label}</div>
      <div className="mt-2 break-all text-xl font-bold text-mapgeo-primary">{value}</div>
    </div>
  );
}

export default function ParcelGeometryEditor({ parcel, onGeometryChange }) {
  const [revision, setRevision] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [workingGeometry, setWorkingGeometry] = useState(() => normalizeToMultiPolygon(parcel?.geometry));
  const [committedGeometry, setCommittedGeometry] = useState(() => normalizeToMultiPolygon(parcel?.geometry));
  const [stats, setStats] = useState(() => buildStats(parcel?.geometry));
  const [reason, setReason] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [confirmConfig, setConfirmConfig] = useState(null);
  const [measure, setMeasure] = useState("");
  const [showSnapGuides, setShowSnapGuides] = useState(true);
  const [showBeforeAfter, setShowBeforeAfter] = useState(true);
  const [importFormat, setImportFormat] = useState("geojson");
  const [importSourceCrs, setImportSourceCrs] = useState(() => getDefaultSourceCrsForFormat("geojson"));
  const [importText, setImportText] = useState("");
  const [selectedVertex, setSelectedVertex] = useState(null);
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [history, setHistory] = useState(() => [normalizeToMultiPolygon(parcel?.geometry)]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const initialGeometry = useMemo(() => normalizeToMultiPolygon(parcel?.geometry), [parcel?.id, parcel?.geometry]);
  const validation = useMemo(() => validateParcelGeometry(workingGeometry, parcel), [parcel, workingGeometry]);
  const vertexRows = useMemo(() => buildVertexRows(workingGeometry), [workingGeometry]);
  const lockState = useGeometryEditLock(parcel?.id || parcel?.reference || "new", true);

  const hasBlockingErrors = validation.status === "blocking";
  const isDirty = geometryKey(workingGeometry) !== geometryKey(committedGeometry);
  const isClearingGeometry = !workingGeometry && Boolean(committedGeometry);
  const canCommit = isEditing && isDirty && reason.trim().length >= 3 && (isClearingGeometry || !hasBlockingErrors) && !lockState.isLockedByOther;

  useEffect(() => {
    const normalized = normalizeToMultiPolygon(parcel?.geometry);
    setWorkingGeometry(normalized);
    setCommittedGeometry(normalized);
    setStats(buildStats(normalized));
    setReason("");
    setEditorMessage("");
    setSelectedVertex(null);
    setManualLatitude("");
    setManualLongitude("");
    setIsEditing(false);
    setHistory([normalized]);
    setHistoryIndex(0);
    setRevision((current) => current + 1);
  }, [parcel?.id, parcel?.geometry]);

  const pushHistory = useCallback((nextGeometry) => {
    setHistory((current) => {
      const nextHistory = current.slice(0, historyIndex + 1);
      if (geometryKey(nextHistory[nextHistory.length - 1]) === geometryKey(nextGeometry)) return current;
      nextHistory.push(cloneGeometry(nextGeometry));
      return nextHistory.slice(-40);
    });
    setHistoryIndex((current) => Math.min(current + 1, 39));
  }, [historyIndex]);

  const applyGeometry = useCallback((nextGeometry, { record = true, reloadMap = true } = {}) => {
    const normalized = normalizeToMultiPolygon(nextGeometry);
    setWorkingGeometry(normalized);
    setStats(buildStats(normalized));
    setEditorMessage("");
    if (record) pushHistory(normalized);
    if (reloadMap) setRevision((current) => current + 1);
  }, [pushHistory]);

  const handleGeometryDraft = useCallback((nextGeometry) => {
    const normalized = normalizeToMultiPolygon(nextGeometry);
    setWorkingGeometry(normalized);
    setStats(buildStats(normalized));
    setEditorMessage("");
    pushHistory(normalized);
  }, [pushHistory]);

  const requestConfirmation = (config, onConfirm) => {
    setConfirmConfig({
      ...config,
      onConfirm: () => {
        setConfirmConfig(null);
        onConfirm?.();
      },
    });
  };

  const enableEditing = () => {
    const lockResult = lockState.acquireLock();
    if (!lockResult.ok) {
      setEditorMessage("Cette parcelle est verrouillée : un autre utilisateur est déjà en édition.");
      return;
    }
    setIsEditing(true);
    setEditorMessage("Édition activée. Les modifications ne seront transmises au formulaire qu'après validation et confirmation.");
  };

  const cancelEditing = () => {
    const resetDraft = () => {
      setWorkingGeometry(committedGeometry);
      setStats(buildStats(committedGeometry));
      setSelectedVertex(null);
      setIsEditing(false);
      setEditorMessage("");
      setRevision((current) => current + 1);
      lockState.releaseLock();
    };

    if (isDirty) {
      requestConfirmation({ title: "Abandonner les modifications ?", message: "Les modifications géométriques non validées seront perdues.", confirmLabel: "Abandonner" }, resetDraft);
      return;
    }

    resetDraft();
  };

  const clearGeometry = () => {
    if (!isEditing) return;
    requestConfirmation(
      { title: "Vider la géométrie ?", message: "La géométrie en cours sera vidée. La suppression définitive ne sera appliquée qu'après l'enregistrement de la parcelle.", confirmLabel: "Vider" },
      () => applyGeometry(null),
    );
  };

  const reloadCommittedGeometry = () => {
    if (!isEditing) return;
    applyGeometry(committedGeometry);
  };

  const undo = () => {
    if (!isEditing || historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    applyGeometry(history[nextIndex], { record: false });
  };

  const redo = () => {
    if (!isEditing || historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    applyGeometry(history[nextIndex], { record: false });
  };

  const commitGeometry = () => {
    const nextValidation = validateParcelGeometry(workingGeometry, parcel);
    const clearingGeometry = !workingGeometry && Boolean(committedGeometry);
    if (!clearingGeometry && nextValidation.status === "blocking") {
      setEditorMessage("Sauvegarde impossible : corrige les erreurs topologiques bloquantes.");
      return;
    }
    if (reason.trim().length < 3) {
      setEditorMessage("Le motif de modification est obligatoire avant toute sauvegarde géométrique.");
      return;
    }
    requestConfirmation(
      {
        title: clearingGeometry ? "Supprimer la géométrie ?" : "Valider la géométrie ?",
        message: clearingGeometry
          ? "La suppression de géométrie sera transmise au formulaire. Elle ne sera persistée qu'après l'enregistrement de la parcelle."
          : "La géométrie contrôlée sera transmise au formulaire. Elle ne sera persistée qu'après l'enregistrement de la parcelle.",
        confirmLabel: clearingGeometry ? "Supprimer" : "Valider",
      },
      () => {
        const normalized = clearingGeometry ? null : (nextValidation.normalizedGeometry || normalizeToMultiPolygon(workingGeometry));
        const center = geometryCentroidProjected(normalized);
        onGeometryChange?.({
          geometry: normalized,
          coordinates_text: normalized ? geometryToCoordinateText(normalized) : "",
          latitude: normalized && center ? Number(normalizeCoordinateValue(center[0])) : "",
          longitude: normalized && center ? Number(normalizeCoordinateValue(center[1])) : "",
          centroid_northing: normalized && center ? Number(normalizeCoordinateValue(center[0])) : "",
          centroid_easting: normalized && center ? Number(normalizeCoordinateValue(center[1])) : "",
          geometry_change_reason: reason.trim(),
          expected_geometry_updated_at: parcel?.geometry_updated_at || null,
        });

        setCommittedGeometry(normalized);
        setWorkingGeometry(normalized);
        setHistory([normalized]);
        setHistoryIndex(0);
        setIsEditing(false);
        setEditorMessage(normalized ? "Géométrie validée et transmise au formulaire. Clique ensuite sur Enregistrer pour persister la parcelle." : "Suppression de géométrie transmise au formulaire. Clique ensuite sur Enregistrer pour persister la parcelle.");
        setRevision((current) => current + 1);
        lockState.releaseLock();
      },
    );
  };

  const importGeometry = () => {
    if (!isEditing) return;
    try {
      const parsed = parseGeometryByFormat(importText, importFormat, { sourceCrs: importSourceCrs });
      applyGeometry(parsed);
      setImportText("");
      const crsLabel = importSourceCrs === WGS84_GEOGRAPHIC_CRS ? "longitude/latitude" : "X/Y EPSG:32628";
      setEditorMessage(`Géométrie importée depuis ${crsLabel}. Elle doit encore passer la validation avant sauvegarde.`);
    } catch (error) {
      setEditorMessage(error.message || "Import impossible.");
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const extension = file.name.split(".").pop()?.toLowerCase();
    const guessedFormat = extension === "kml" ? "kml" : extension === "wkt" ? "wkt" : extension === "csv" ? "csv" : "geojson";
    setImportFormat(guessedFormat);
    setImportSourceCrs(getDefaultSourceCrsForFormat(guessedFormat));
    setImportText(text);
    event.target.value = "";
  };

  const selectVertex = (row) => {
    setSelectedVertex(row);
    setManualLatitude(formatCoordinate(row.latitude));
    setManualLongitude(formatCoordinate(row.longitude));
  };

  const moveSelectedVertex = () => {
    if (!isEditing || !selectedVertex) return;
    const next = updateVertexInGeometry(workingGeometry, selectedVertex, manualLatitude, manualLongitude);
    applyGeometry(next);
  };

  const addManualVertex = () => {
    if (!isEditing) return;
    const next = appendVertexToPrimaryRing(workingGeometry, manualLatitude, manualLongitude);
    if (!next) {
      setEditorMessage("Dessine ou importe d'abord un polygone avant d'ajouter un sommet manuel.");
      return;
    }
    applyGeometry(next);
  };

  return (
    <section className="mb-6 rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-mapgeo-secondary/60">Édition cadastrale sécurisée</p>
          <h3 className="mt-2 text-2xl font-bold text-mapgeo-primary">Éditeur MultiPolygon professionnel</h3>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-mapgeo-secondary/75">
            Lecture seule par défaut, verrouillage d'édition, snapping, historique, import/export et validation topologique avant transmission au formulaire.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {!isEditing ? (
            <button
              type="button"
              onClick={enableEditing}
              disabled={lockState.isLockedByOther}
              className="inline-flex items-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Unlock size={18} /> Activer l'édition
            </button>
          ) : (
            <>
              <button type="button" onClick={commitGeometry} disabled={!canCommit} className="inline-flex items-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                <Save size={18} /> Valider la géométrie
              </button>
              <button type="button" onClick={cancelEditing} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-4 py-3 font-semibold text-mapgeo-primary">
                <Lock size={18} /> Quitter l'édition
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-5">
        <StatCard label="Polygones" value={stats.polygonCount} />
        <StatCard label="Anneaux" value={stats.ringCount} />
        <StatCard label="Trous" value={stats.holeCount} />
        <StatCard label="Sommets" value={stats.vertexCount} />
        <StatCard label="Surface SIG" value={formatArea(stats.areaM2)} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/30 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <StatusBadge status={validation.status} />
                {isEditing ? <span className="rounded-full bg-mapgeo-sand/15 px-3 py-1 text-xs font-bold text-mapgeo-primary">Édition active</span> : <span className="rounded-full bg-mapgeo-ivory px-3 py-1 text-xs font-bold text-mapgeo-secondary/75">Lecture seule</span>}
              </div>
              <p className="mt-2 text-sm text-mapgeo-secondary/75">
                {lockState.isLockedByOther
                  ? "Parcelle verrouillée par une autre session. L'édition est désactivée."
                  : lockState.isOwnedByMe
                    ? "Verrou actif sur cette session. Les autres sessions locales ne peuvent pas modifier cette parcelle."
                    : "Aucune modification possible tant que l'édition n'est pas activée."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={undo} disabled={!isEditing || historyIndex <= 0} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <Undo2 size={16} /> Annuler
              </button>
              <button type="button" onClick={redo} disabled={!isEditing || historyIndex >= history.length - 1} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <Redo2 size={16} /> Rétablir
              </button>
              <button type="button" onClick={reloadCommittedGeometry} disabled={!isEditing} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <RotateCcw size={16} /> Recharger
              </button>
              <button type="button" onClick={clearGeometry} disabled={!isEditing} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-sand/40 bg-white px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <Trash2 size={16} /> Vider
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-mapgeo-line bg-white p-4">
          <label className="mb-2 block text-sm font-bold text-mapgeo-primary">Motif de modification obligatoire</label>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!isEditing}
            placeholder="Ex. correction topo, bornage, fusion, division, mise à jour terrain"
            className="w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55"
          />
          {isEditing && reason.trim().length < 3 ? <p className="mt-2 text-xs font-semibold text-mapgeo-primary">Le motif est requis avant sauvegarde.</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="relative overflow-hidden rounded-3xl border border-mapgeo-line">
            <MapContainer center={DEFAULT_MAP_CENTER} zoom={13} className="h-[38rem] w-full" scrollWheelZoom>
              <TileLayer attribution='&copy; OpenStreetMap contributors &copy; CARTO' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />

              {showBeforeAfter && initialGeometry ? <GeoJSON key={`before-${parcel?.id || "new"}-${revision}`} data={projectedGeometryToWgs84(initialGeometry)} style={BEFORE_STYLE} /> : null}

              <ReferenceGeometryLayer parcel={parcel} visible={isEditing && showSnapGuides} />

              <GeometryEditorController
                sourceGeometry={workingGeometry}
                editable={isEditing && !lockState.isLockedByOther}
                revision={revision}
                onGeometryDraft={handleGeometryDraft}
                setStats={setStats}
                setSelectedVertex={setSelectedVertex}
                setMeasure={setMeasure}
              />
            </MapContainer>

            <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-2xl border border-white/70 bg-white/95 px-4 py-3 text-xs font-semibold text-mapgeo-primary shadow-soft">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-6 rounded-full border border-[#B45309] bg-[#F59E0B]/20" /> Avant</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-6 rounded-full border border-[#123B5D] bg-[#C7B299]/25" /> Après / travail</span>
                {measure ? <span className="text-mapgeo-primary">{measure}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => setShowBeforeAfter((current) => !current)} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-semibold text-mapgeo-primary">
              <History size={16} /> Historique avant/après
            </button>
            <button type="button" onClick={() => setShowSnapGuides((current) => !current)} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-semibold text-mapgeo-primary">
              <MousePointer2 size={16} /> Snapping voisins/cadastre
            </button>
            <button type="button" onClick={() => downloadGeometryAsGeoJson(workingGeometry, `${parcel?.reference || "parcelle"}-geometry.geojson`)} disabled={!workingGeometry} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
              <Download size={16} /> Export GeoJSON
            </button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-mapgeo-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-mapgeo-primary" />
              <h4 className="font-bold text-mapgeo-primary">Validation topologique</h4>
            </div>
            <IssueList validation={validation} />
          </div>

          <div className="rounded-3xl border border-mapgeo-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileUp size={18} className="text-mapgeo-primary" />
              <h4 className="font-bold text-mapgeo-primary">Import SIG</h4>
            </div>
            <div className="flex gap-2">
              <select value={importFormat} onChange={(event) => { const nextFormat = event.target.value; setImportFormat(nextFormat); setImportSourceCrs(getDefaultSourceCrsForFormat(nextFormat)); }} disabled={!isEditing} className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-sm disabled:opacity-50">
                <option value="geojson">GeoJSON</option>
                <option value="csv">CSV X/Y</option>
                <option value="kml">KML</option>
                <option value="wkt">WKT</option>
              </select>
              <select value={importSourceCrs} onChange={(event) => setImportSourceCrs(event.target.value)} disabled={!isEditing || importFormat === "kml"} className="min-w-0 flex-1 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-sm disabled:opacity-50">
                {GEOMETRY_IMPORT_CRS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-mapgeo-line px-3 py-2 text-sm font-semibold text-mapgeo-primary">
                Fichier
                <input type="file" accept=".json,.geojson,.csv,.kml,.wkt,text/csv,application/geo+json" onChange={importFile} disabled={!isEditing} className="hidden" />
              </label>
            </div>
            <p className="mt-2 text-xs leading-5 text-mapgeo-secondary/70">
              Format rapide : colle x,y;x,y;x,y directement (ex. 287802,1633540;287820,1633548;287810,1633520), la détection est automatique. GeoJSON, KML et WKT sont aussi acceptés. Coordonnées en mètres EPSG:32628 par défaut.
            </p>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              disabled={!isEditing}
              rows={5}
              placeholder="Format simple : x,y;x,y;x,y (ex. 287802,1633540;287820,1633548;287810,1633520) — GeoJSON, KML, WKT aussi acceptés"
              className="mt-3 w-full rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-xs outline-none disabled:opacity-50"
            />
            <button type="button" onClick={importGeometry} disabled={!isEditing || !importText.trim()} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45">
              <FileUp size={16} /> Importer et contrôler
            </button>
          </div>

          <div className="rounded-3xl border border-mapgeo-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Eye size={18} className="text-mapgeo-primary" />
              <h4 className="font-bold text-mapgeo-primary">Sommet sélectionné</h4>
            </div>
            {selectedVertex ? (
              <p className="mb-3 rounded-2xl bg-mapgeo-ivory/60 px-3 py-2 text-sm font-semibold text-mapgeo-primary">
                {selectedVertex.label} · Y {formatCoordinate(selectedVertex.latitude)} m · X {formatCoordinate(selectedVertex.longitude)} m
              </p>
            ) : (
              <p className="mb-3 text-sm text-mapgeo-secondary/70">Sélectionne un sommet dans la liste pour le déplacer précisément.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.0000001" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} disabled={!isEditing} placeholder="Y / Northing (m)" className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-sm outline-none disabled:opacity-50" />
              <input type="number" step="0.0000001" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} disabled={!isEditing} placeholder="X / Easting (m)" className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-3 py-2 text-sm outline-none disabled:opacity-50" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={moveSelectedVertex} disabled={!isEditing || !selectedVertex} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <MousePointer2 size={15} /> Déplacer
              </button>
              <button type="button" onClick={addManualVertex} disabled={!isEditing} className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line px-3 py-2 text-sm font-semibold text-mapgeo-primary disabled:opacity-40">
                <Plus size={15} /> Ajouter au contour
              </button>
            </div>
            <div className="mt-3 max-h-52 overflow-auto rounded-2xl border border-mapgeo-line">
              {vertexRows.length ? (
                vertexRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectVertex(row)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-mapgeo-line px-3 py-2 text-left text-xs last:border-b-0 ${selectedVertex?.id === row.id ? "bg-mapgeo-primary text-white" : "bg-white text-mapgeo-secondary hover:bg-mapgeo-ivory/50"}`}
                  >
                    <span className="font-bold">{row.label}</span>
                    <span>{formatCoordinate(row.latitude)}, {formatCoordinate(row.longitude)}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-mapgeo-secondary/60">Aucun sommet disponible.</div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {editorMessage ? (
        <div className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 px-4 py-3 text-sm font-semibold text-mapgeo-primary">
          <Info size={16} className="mr-2 inline" /> {editorMessage}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/30 p-4 text-sm leading-6 text-mapgeo-secondary/80">
        L'éditeur reste en lecture seule tant que l'édition n'est pas activée. Les outils Geoman conservent le dessin, l'édition, la suppression, la coupe et la sortie MultiPolygon. Les erreurs bloquantes empêchent la validation, les avertissements demandent une vérification métier, et le motif est obligatoire pour tracer l'historique foncier.
      </div>

      <ConfirmDialog config={confirmConfig} onCancel={() => setConfirmConfig(null)} onConfirm={() => confirmConfig?.onConfirm?.()} />
    </section>
  );
}
