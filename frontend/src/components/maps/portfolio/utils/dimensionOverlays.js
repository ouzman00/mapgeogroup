import L from "leaflet";
import {
  computeDistanceBetweenPoints,
  formatArea,
  formatDistance,
  geometryAreaM2Projected,
  geometryCentroid,
  geometryToRings,
  latLngPairToProjected,
} from "../../../../utils/parcelGeometry";
import { midpoint, segmentAngleCss } from "../mapUtils";

export function stripDimensionClosingPoint(points = [], tolerance = 1e-9) {
  if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points : [];
  const first = points[0];
  const last = points[points.length - 1];

  if (
    Array.isArray(first) &&
    Array.isArray(last) &&
    Math.abs(Number(first[0]) - Number(last[0])) <= tolerance &&
    Math.abs(Number(first[1]) - Number(last[1])) <= tolerance
  ) {
    return points.slice(0, -1);
  }

  return points;
}

export function distanceAlongPoints(points, closed = false) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const segmentCount = closed && points.length >= 3 ? points.length : points.length - 1;
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    total += computeDistanceBetweenPoints(points[index], points[(index + 1) % points.length]) || 0;
  }
  return total;
}

export function polygonGeometryFromLatLngRing(points) {
  const ring = stripDimensionClosingPoint(points).filter((point) => Array.isArray(point) && point.length >= 2);
  if (ring.length < 3) return null;
  const coordinates = ring.map(latLngPairToProjected).filter(Boolean);
  if (coordinates.length < 3) return null;
  coordinates.push(coordinates[0]);
  return { type: "Polygon", coordinates: [coordinates] };
}

export function buildMeasurementDraftSummary(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripDimensionClosingPoint(previewPoints) : previewPoints;
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

export function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    lat += Number(point[0]);
    lng += Number(point[1]);
    n += 1;
  }
  if (!n) return null;
  return [lat / n, lng / n];
}

export function sideMarkerViewportOptions(map, viewportOptions = {}) {
  const zoom = typeof map?.getZoom === "function" ? map.getZoom() : 16;
  const mobile = Boolean(viewportOptions.isMobile);

  return {
    zoom,
    offsetPixels: 20,
    minSegmentPixels: mobile ? 44 : 34,
    minZoom: mobile ? 17 : 15,
  };
}

export function repositionSideMarkersOutsideInPixels(markers, map, pixels, viewportOptions = {}) {
  if (!Array.isArray(markers) || markers.length === 0) return [];

  if (
    !map ||
    typeof map.latLngToLayerPoint !== "function" ||
    typeof map.layerPointToLatLng !== "function" ||
    typeof map.getZoom !== "function"
  ) {
    return markers;
  }

  const options = sideMarkerViewportOptions(map, viewportOptions);
  const offsetPixels = Number.isFinite(Number(pixels)) ? Number(pixels) : options.offsetPixels;

  return markers.map((marker) => {
    try {
      const a = marker.segA || marker.a;
      const b = marker.segB || marker.b;
      if (!Array.isArray(a) || !Array.isArray(b)) return { ...marker, visible: false };

      const aPx = map.latLngToLayerPoint(L.latLng(a[0], a[1]));
      const bPx = map.latLngToLayerPoint(L.latLng(b[0], b[1]));
      const midPx = L.point((aPx.x + bPx.x) / 2, (aPx.y + bPx.y) / 2);
      const dx = bPx.x - aPx.x;
      const dy = bPx.y - aPx.y;
      const segmentPixels = Math.sqrt(dx * dx + dy * dy);

      if (!Number.isFinite(segmentPixels) || segmentPixels <= 0) {
        return { ...marker, visible: false };
      }

      let nx = -dy;
      let ny = dx;
      const norm = Math.sqrt(nx * nx + ny * ny) || 1;
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

export function buildSideMarkersFromRings(rings, tone = "default", closed = true) {
  const markers = [];
  (Array.isArray(rings) ? rings : []).forEach((ring, ringIndex) => {
    const cleanRing = stripDimensionClosingPoint(ring).filter((point) => Array.isArray(point) && point.length >= 2);
    if (cleanRing.length < 2) return;
    const segmentCount = closed && cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
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

export function buildGeometryMeasurementOverlay(geometry, tone = "default") {
  const rings = geometryToRings(geometry);
  const sideMarkers = buildSideMarkersFromRings(rings, tone, true);
  const area = geometryAreaM2Projected(geometry);
  const perimeter = rings.reduce((total, ring) => total + distanceAlongPoints(stripDimensionClosingPoint(ring), true), 0);
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

export function getMeasurementPreviewPoints(draft = {}) {
  const points = Array.isArray(draft.points) ? draft.points : [];
  if (draft.finished || !draft.cursorPoint) return points;
  return [...points, draft.cursorPoint];
}

export function buildMeasurementDraftOverlay(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripDimensionClosingPoint(previewPoints) : previewPoints;
  const isSurface = draft?.mode === "surface" && cleanPoints.length >= 3;
  const geometry = isSurface ? polygonGeometryFromLatLngRing(cleanPoints) : null;
  const sideMarkers = buildSideMarkersFromRings([cleanPoints], "measure", isSurface);
  const overlay = geometry ? buildGeometryMeasurementOverlay(geometry, "measure") : { sideMarkers: [], areaMarker: null };

  return {
    sideMarkers,
    areaMarker: overlay.areaMarker,
  };
}
