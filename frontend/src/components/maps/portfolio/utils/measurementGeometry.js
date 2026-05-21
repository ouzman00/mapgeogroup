import {
  computeDistanceBetweenPoints,
  formatArea,
  formatDistance,
  geometryAreaM2Projected,
  geometryCentroid,
} from "../../../../utils/parcelGeometry";

export function pointsAreSame(a, b, tolerance = 1e-9) {
  return Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

export function cloneGeometry(geometry) {
  return geometry ? JSON.parse(JSON.stringify(geometry)) : null;
}

export function geometryHistoryKey(geometry) {
  return JSON.stringify(geometry || null);
}

export function stripMeasurementClosingPoint(points) {
  if (!Array.isArray(points) || points.length <= 1) return Array.isArray(points) ? points : [];
  const cleanPoints = [...points];
  if (pointsAreSame(cleanPoints[0], cleanPoints[cleanPoints.length - 1])) cleanPoints.pop();
  return cleanPoints;
}

export function getMeasurementPreviewPoints(draft) {
  const points = Array.isArray(draft?.points) ? draft.points.filter((point) => Array.isArray(point) && point.length >= 2) : [];
  if (draft?.finished || !Array.isArray(draft?.cursorPoint)) return points;
  const lastPoint = points[points.length - 1];
  if (lastPoint && pointsAreSame(lastPoint, draft.cursorPoint)) return points;
  return [...points, draft.cursorPoint];
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
  const ring = stripMeasurementClosingPoint(points).filter((point) => Array.isArray(point) && point.length >= 2);
  if (ring.length < 3) return null;
  const coordinates = ring.map(([lat, lng]) => [lng, lat]);
  if (coordinates.length < 3) return null;
  coordinates.push(coordinates[0]);
  return { type: "Polygon", coordinates: [coordinates] };
}

export function buildMeasurementDraftSummary(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripMeasurementClosingPoint(previewPoints) : previewPoints;
  const closeSurface = draft?.mode === "surface" && cleanPoints.length >= 3;
  const surfaceGeometry = closeSurface ? polygonGeometryFromLatLngRing(cleanPoints) : null;
  const surface = surfaceGeometry ? geometryAreaM2Projected(surfaceGeometry) : 0;
  const distance = distanceAlongPoints(cleanPoints, closeSurface);

  return {
    distance,
    distanceLabel: formatDistance(distance),
    surface,
    surfaceLabel: formatArea(surface),
    perimeterLabel: closeSurface ? formatDistance(distance) : "—",
    pointsCount: cleanPoints.length,
  };
}

export function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let latTotal = 0;
  let lngTotal = 0;
  let count = 0;

  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    latTotal += Number(point[0]) || 0;
    lngTotal += Number(point[1]) || 0;
    count += 1;
  }

  return count ? [latTotal / count, lngTotal / count] : null;
}

export function offsetOutside(midPt, segA, segB, centroid, offsetPixels = 14, map = null) {
  if (!midPt || !segA || !segB || !centroid) return midPt;

  if (map?.latLngToLayerPoint && map?.layerPointToLatLng) {
    const mid = map.latLngToLayerPoint(midPt);
    const a = map.latLngToLayerPoint(segA);
    const b = map.latLngToLayerPoint(segB);
    const c = map.latLngToLayerPoint(centroid);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;

    const normalA = { x: -dy / length, y: dx / length };
    const normalB = { x: dy / length, y: -dx / length };

    const testA = { x: mid.x + normalA.x * offsetPixels, y: mid.y + normalA.y * offsetPixels };
    const testB = { x: mid.x + normalB.x * offsetPixels, y: mid.y + normalB.y * offsetPixels };

    const distA = Math.hypot(testA.x - c.x, testA.y - c.y);
    const distB = Math.hypot(testB.x - c.x, testB.y - c.y);
    const chosen = distA >= distB ? testA : testB;
    const latlng = map.layerPointToLatLng(chosen);

    return [latlng.lat, latlng.lng];
  }

  const dx = segB[1] - segA[1];
  const dy = segB[0] - segA[0];
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalA = [-dx / length, dy / length];
  const normalB = [dx / length, -dy / length];

  const testA = [midPt[0] + normalA[0] * 0.00008, midPt[1] + normalA[1] * 0.00008];
  const testB = [midPt[0] + normalB[0] * 0.00008, midPt[1] + normalB[1] * 0.00008];

  const distA = Math.hypot(testA[0] - centroid[0], testA[1] - centroid[1]);
  const distB = Math.hypot(testB[0] - centroid[0], testB[1] - centroid[1]);

  return distA >= distB ? testA : testB;
}

export function repositionSideMarkersOutsideInPixels(markers, map, pixels, viewportOptions = {}) {
  if (!Array.isArray(markers) || markers.length === 0) return [];

  return markers.map((marker) => {
    if (!marker?.point || !marker?.segmentStart || !marker?.segmentEnd || !marker?.centroid) return marker;
    return {
      ...marker,
      point: offsetOutside(marker.point, marker.segmentStart, marker.segmentEnd, marker.centroid, pixels, map),
    };
  });
}

export function buildSideMarkersFromRings(rings, tone = "default", closed = true) {
  const markers = [];

  (Array.isArray(rings) ? rings : []).forEach((ring, ringIndex) => {
    const cleanRing = stripMeasurementClosingPoint(ring).filter((point) => Array.isArray(point) && point.length >= 2);
    if (cleanRing.length < 2) return;

    const segmentCount = closed && cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
    const centroid = closed && cleanRing.length >= 3 ? ringCentroid(cleanRing) : null;

    for (let index = 0; index < segmentCount; index += 1) {
      const point = cleanRing[index];
      const nextPoint = cleanRing[(index + 1) % cleanRing.length];
      const distance = computeDistanceBetweenPoints(point, nextPoint);
      if (!Number.isFinite(distance) || distance <= 0) continue;

      const midPoint = [(point[0] + nextPoint[0]) / 2, (point[1] + nextPoint[1]) / 2];

      markers.push({
        id: `${tone}-${ringIndex}-${index}`,
        point: centroid ? offsetOutside(midPoint, point, nextPoint, centroid) : midPoint,
        segmentStart: point,
        segmentEnd: nextPoint,
        centroid,
        label: formatDistance(distance),
      });
    }
  });

  return markers;
}

export function buildGeometryMeasurementOverlay(geometry, tone = "default") {
  const rings = geometry?.coordinates
    ? geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
    : [];

  const area = geometryAreaM2Projected(geometry);
  const perimeter = rings.reduce((total, ring) => total + distanceAlongPoints(stripMeasurementClosingPoint(ring), true), 0);
  const center = geometryCentroid(geometry);

  return {
    sideMarkers: buildSideMarkersFromRings(rings, tone, true),
    areaMarker: center && (area > 0 || perimeter > 0)
      ? {
          id: `${tone}-area`,
          point: center,
          label: formatArea(area),
          subtitle: perimeter > 0 ? `Périmètre ${formatDistance(perimeter)}` : "Surface",
        }
      : null,
  };
}

export function buildMeasurementDraftOverlay(draft) {
  const previewPoints = getMeasurementPreviewPoints(draft);
  const cleanPoints = draft?.mode === "surface" ? stripMeasurementClosingPoint(previewPoints) : previewPoints;
  const isSurface = draft?.mode === "surface" && cleanPoints.length >= 3;
  const geometry = isSurface ? polygonGeometryFromLatLngRing(cleanPoints) : null;
  const sideMarkers = buildSideMarkersFromRings([cleanPoints], "measure", isSurface);
  const overlay = geometry ? buildGeometryMeasurementOverlay(geometry, "measure") : { sideMarkers: [], areaMarker: null };

  return {
    sideMarkers: sideMarkers.length ? sideMarkers : overlay.sideMarkers,
    areaMarker: overlay.areaMarker,
  };
}

export function toLayerPoint(map, point) {
  if (!map || !Array.isArray(point) || point.length < 2) return null;
  return map.latLngToLayerPoint([point[0], point[1]]);
}

export function pixelDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function closestPointOnSegment(target, start, end) {
  if (!target || !start || !end) return { point: start, ratio: 0, distance: Infinity };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (!lengthSquared) return { point: start, ratio: 0, distance: pixelDistance(target, start) };

  const ratio = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared));
  const point = { x: start.x + ratio * dx, y: start.y + ratio * dy };

  return { point, ratio, distance: pixelDistance(target, point) };
}

export function findNearestMeasurementSnap(map, point, features = [], measurementPoints = [], options = {}) {
  const fallback = { point, snapped: false, kind: null };
  if (!map || !Array.isArray(point) || point.length < 2) return fallback;

  const tolerance = Number(options.tolerancePx || 24);
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
    if (!cleanRing.length) return;

    cleanRing.forEach((candidate) => {
      const distance = pixelDistance(target, toLayerPoint(map, candidate));
      if (distance < best.distance) best = { distance, point: candidate, kind: "vertex" };
    });

    if (cleanRing.length < 2) return;

    const segmentCount = cleanRing.length >= 3 ? cleanRing.length : cleanRing.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = toLayerPoint(map, cleanRing[index]);
      const end = toLayerPoint(map, cleanRing[(index + 1) % cleanRing.length]);
      const closest = closestPointOnSegment(target, start, end);

      if (closest.distance < best.distance) {
        const latlng = map.layerPointToLatLng(closest.point);
        best = { distance: closest.distance, point: [latlng.lat, latlng.lng], kind: "segment" };
      }
    }
  });

  return best.distance <= tolerance ? { point: best.point, snapped: true, kind: best.kind } : fallback;
}
