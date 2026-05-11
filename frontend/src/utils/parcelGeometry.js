import proj4 from "proj4";

export const DEFAULT_MAP_CENTER = [14.7167, -17.4677];
export const SENEGAL_PROJECTED_CRS = "EPSG:32628";
export const SENEGAL_PROJECTED_CRS_LABEL = "WGS 84 / UTM zone 28N - Sénégal";

proj4.defs(
  SENEGAL_PROJECTED_CRS,
  "+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs +type=crs",
);

export function senegalProjectedToLngLat(x, y) {
  const east = Number(x);
  const north = Number(y);

  if (!Number.isFinite(east) || !Number.isFinite(north)) return null;

  try {
    const [lng, lat] = proj4(SENEGAL_PROJECTED_CRS, "EPSG:4326", [east, north]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
  } catch {
    return null;
  }
}

export function lngLatToSenegalProjected(lng, lat) {
  const longitude = Number(lng);
  const latitude = Number(lat);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  try {
    const [x, y] = proj4("EPSG:4326", SENEGAL_PROJECTED_CRS, [longitude, latitude]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  } catch {
    return null;
  }
}

export function projectedPairToLatLng(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lngLat = senegalProjectedToLngLat(pair[0], pair[1]);
  return lngLat ? [lngLat[1], lngLat[0]] : null;
}

export function latLngPairToProjected(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const [lat, lng] = pair.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return lngLatToSenegalProjected(lng, lat);
}

export function normalizeCoordinateValue(value, decimals = 3) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return "";

  return numericValue
    .toFixed(decimals)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function closeProjectedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ring || [];
  const points = ring
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([x, y]) => [Number(x), Number(y)])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 3) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function stripClosingProjectedPoint(ring) {
  if (!Array.isArray(ring) || ring.length <= 1) return Array.isArray(ring) ? ring : [];
  const points = [...ring];
  const first = points[0];
  const last = points[points.length - 1];
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) points.pop();
  return points;
}

function normalizeProjectedPolygonRings(polygonCoordinates) {
  if (!Array.isArray(polygonCoordinates)) return [];
  return polygonCoordinates
    .map(closeProjectedRing)
    .filter((ring) => ring.length >= 4);
}

export function geometryToProjectedPolygons(geometry) {
  if (!geometry?.type || !geometry?.coordinates) return [];

  if (geometry.type === "Polygon") {
    const rings = normalizeProjectedPolygonRings(geometry.coordinates);
    return rings.length ? [rings] : [];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map(normalizeProjectedPolygonRings)
      .filter((polygon) => polygon.length > 0);
  }

  return [];
}

export function geometryToProjectedRings(geometry) {
  return geometryToProjectedPolygons(geometry).flatMap((polygon) => polygon.map((ring) => [...ring]));
}

function projectedRingToLeaflet(ring) {
  return (Array.isArray(ring) ? ring : [])
    .map(projectedPairToLatLng)
    .filter(Boolean);
}

export function geometryToLeafletPositions(geometry) {
  const polygons = geometryToProjectedPolygons(geometry);

  if (geometry?.type === "Polygon") {
    return polygons[0]?.map(projectedRingToLeaflet).filter((ring) => ring.length >= 3) || [];
  }

  if (geometry?.type === "MultiPolygon") {
    return polygons
      .map((polygon) => polygon.map(projectedRingToLeaflet).filter((ring) => ring.length >= 3))
      .filter((polygon) => polygon.length > 0);
  }

  return [];
}

export function geometryToRings(geometry) {
  return geometryToProjectedRings(geometry)
    .map(stripClosingProjectedPoint)
    .map(projectedRingToLeaflet)
    .filter((ring) => ring.length >= 3);
}

export function geometryToLatLngs(geometry) {
  return geometryToRings(geometry).flat();
}

export function geometryToPolygons(geometry) {
  return geometryToLeafletPositions(geometry);
}

function ringAreaProjectedM2(ring) {
  const points = stripClosingProjectedPoint(ring);
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringLengthProjectedM(ring, closed = true) {
  const points = closed ? stripClosingProjectedPoint(ring) : ring;
  if (!Array.isArray(points) || points.length < 2) return 0;
  const segmentCount = closed && points.length >= 3 ? points.length : points.length - 1;
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    total += Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1));
  }
  return total;
}

export function polygonAreaM2Projected(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return 0;
  const [outerRing, ...holes] = polygon;
  const outerArea = Math.abs(ringAreaProjectedM2(outerRing));
  const holesArea = holes.reduce((sum, ring) => sum + Math.abs(ringAreaProjectedM2(ring)), 0);
  return Math.max(0, outerArea - holesArea);
}

export function geometryAreaM2Projected(geometry) {
  return geometryToProjectedPolygons(geometry).reduce((sum, polygon) => sum + polygonAreaM2Projected(polygon), 0);
}

export function geometryPerimeterMProjected(geometry) {
  return geometryToProjectedPolygons(geometry).reduce((total, polygon) => {
    const [outerRing, ...holes] = polygon;
    return total + ringLengthProjectedM(outerRing, true) + holes.reduce((sum, ring) => sum + ringLengthProjectedM(ring, true), 0);
  }, 0);
}

export function geometryToCoordinateText(geometry) {
  const primaryRing = geometryToProjectedRings(geometry)[0] || [];

  return stripClosingProjectedPoint(primaryRing)
    .map(([x, y]) => `${normalizeCoordinateValue(x)},${normalizeCoordinateValue(y)}`)
    .join("; ");
}

export function pointsToPolygonGeometry(points) {
  const validPoints = points
    .map((point) => {
      const x = point.x ?? point.lng ?? point.longitude;
      const y = point.y ?? point.lat ?? point.latitude;
      return [Number(x), Number(y)];
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  if (validPoints.length < 3) return null;

  return {
    type: "Polygon",
    coordinates: [closeProjectedRing(validPoints)],
  };
}

export function toMultiPolygonGeometry(geometry) {
  if (!geometry || !geometry.type) return null;
  if (geometry.type === "MultiPolygon") return geometry;
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
  }
  return null;
}

function projectedRingCentroid(ring) {
  const points = stripClosingProjectedPoint(ring);
  if (!Array.isArray(points) || points.length < 3) return null;

  const closed = [...points, points[0]];
  let areaTwice = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < closed.length - 1; index += 1) {
    const [x1, y1] = closed[index];
    const [x2, y2] = closed[index + 1];
    const cross = x1 * y2 - x2 * y1;
    areaTwice += cross;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }

  if (Math.abs(areaTwice) < 1e-9) {
    const [xSum, ySum] = points.reduce(
      ([accX, accY], [x, y]) => [accX + x, accY + y],
      [0, 0],
    );
    return { center: [ySum / points.length, xSum / points.length], area: 0 };
  }

  return {
    center: [centroidY / (3 * areaTwice), centroidX / (3 * areaTwice)],
    area: Math.abs(areaTwice / 2),
  };
}

export function centroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  // points are Leaflet [lat, lng]
  const projected = points.map(latLngPairToProjected).filter(Boolean);
  const result = projectedRingCentroid(projected);
  if (!result?.center) return null;
  const [y, x] = result.center;
  const lngLat = senegalProjectedToLngLat(x, y);
  return lngLat ? [lngLat[1], lngLat[0]] : null;
}

export function geometryCentroidProjected(geometry) {
  const polygons = geometryToProjectedPolygons(geometry);
  if (!polygons.length) return null;

  const weighted = polygons
    .map(([outerRing, ...holes]) => {
      const outer = projectedRingCentroid(outerRing);
      if (!outer) return null;

      const holeEntries = holes.map((ring) => projectedRingCentroid(ring)).filter(Boolean);
      const netArea = Math.max(outer.area - holeEntries.reduce((sum, item) => sum + item.area, 0), 0);
      if (netArea <= 0) return { center: outer.center, weight: Math.max(outer.area, 1) };

      const y = (outer.center[0] * outer.area - holeEntries.reduce((sum, item) => sum + item.center[0] * item.area, 0)) / netArea;
      const x = (outer.center[1] * outer.area - holeEntries.reduce((sum, item) => sum + item.center[1] * item.area, 0)) / netArea;
      return { center: [y, x], weight: netArea };
    })
    .filter(Boolean);

  if (!weighted.length) return null;

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const y = weighted.reduce((sum, item) => sum + item.center[0] * item.weight, 0) / totalWeight;
  const x = weighted.reduce((sum, item) => sum + item.center[1] * item.weight, 0) / totalWeight;
  return [y, x];
}

export function geometryCentroid(geometry) {
  const projected = geometryCentroidProjected(geometry);
  if (!projected) return null;
  const [y, x] = projected;
  const lngLat = senegalProjectedToLngLat(x, y);
  return lngLat ? [lngLat[1], lngLat[0]] : null;
}

export function getParcelCenter(parcel) {
  const y = Number(
    parcel?.centroid_northing ??
    parcel?.centroid_y ??
    parcel?.latitude,
  );
  const x = Number(
    parcel?.centroid_easting ??
    parcel?.centroid_x ??
    parcel?.longitude,
  );

  if (Number.isFinite(y) && Number.isFinite(x)) {
    const lngLat = senegalProjectedToLngLat(x, y);
    if (lngLat) return [lngLat[1], lngLat[0]];
  }

  // Ne jamais utiliser DEFAULT_MAP_CENTER comme position métier d'une parcelle.
  // Les composants carte peuvent choisir leur propre fallback de viewport,
  // mais les labels et badges doivent rester absents sans géométrie réelle.
  return geometryCentroid(parcel?.geometry) || null;
}

export function haversineDistance(a, b) {
  const projectedA = latLngPairToProjected(a);
  const projectedB = latLngPairToProjected(b);
  if (projectedA && projectedB) {
    return Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]);
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;

  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

export function computeDistanceBetweenPoints(a, b) {
  return haversineDistance(a, b);
}

export function computePerimeterFromPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;

  return points.reduce((total, point, index) => {
    const nextPoint = points[(index + 1) % points.length];
    return total + computeDistanceBetweenPoints(point, nextPoint);
  }, 0);
}

export function formatArea(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "—";

  return `${numericValue.toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  })} m²`;
}

export function formatDistance(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "—";

  return `${numericValue.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} m`;
}

export function buildVertexRows(points, options = {}) {
  const ringLabel = options.ringLabel;

  return points.map((point, index) => {
    const projected = latLngPairToProjected(point);
    const x = projected?.[0] ?? null;
    const y = projected?.[1] ?? null;

    return {
      id: `${ringLabel || "ring"}-${index}-${point[0]}-${point[1]}`,
      label: ringLabel ? `${ringLabel}.${index + 1}` : index + 1,
      x,
      y,
      easting: x,
      northing: y,
      latitude: point[0],
      longitude: point[1],
    };
  });
}
export function buildTimeline(parcel) {
  return (Array.isArray(parcel?.timeline_events) ? parcel.timeline_events : [])
    .map((event, index) => ({
      id: event.id || `${event.title || "event"}-${index}`,
      date: event.event_date || null,
      title: event.title || "Étape",
      description: event.description || "",
      progress: event.progress ?? null,
    }))
    .sort((a, b) => {
      const timeA = a?.date ? Date.parse(a.date) : Number.POSITIVE_INFINITY;
      const timeB = b?.date ? Date.parse(b.date) : Number.POSITIVE_INFINITY;
      return timeA - timeB;
    });
}

export function buildDocuments(parcel) {
  return Array.isArray(parcel?.documents) ? parcel.documents : [];
}

export function buildLookupFields(parcel) {
  return {
    q: parcel?.reference || "",
    client: parcel?.organization_code || parcel?.owner_client_code || parcel?.owner_name || "",
    commune: parcel?.commune || parcel?.location || "",
    title: parcel?.title_number || parcel?.parcel_number || "",
  };
}

export function getGeometrySupportMessage(geometry) {
  if (!geometry) return "";
  if (["Polygon", "MultiPolygon"].includes(geometry.type)) return "";

  return "Cette interface frontend affiche surtout les parcelles Polygon/MultiPolygon. Les autres géométries restent stockées côté PostGIS mais ne sont pas éditables dans cet écran.";
}
